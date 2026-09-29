import { translateReplyWithOpenAI } from '../_shared/ai.ts'
import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'

const languageAliases: Record<string, string> = {
  english: 'en', french: 'fr', vietnamese: 'vi', russian: 'ru', korean: 'ko',
  japanese: 'ja', chinese: 'zh', spanish: 'es', german: 'de', italian: 'it',
  portuguese: 'pt', thai: 'th', arabic: 'ar', hebrew: 'he', ukrainian: 'uk',
}

function normalizeLanguage(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return null
  return languageAliases[normalized] ?? normalized.split(/[-_]/)[0]
}

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse

  try {
    const context = await requireUser(request)
    enforceRateLimit(`translate-reply:${context.user.id}`, 20, 3_600_000)
    const body = await request.json() as { review_id?: string; draft_version?: number }
    const reviewId = body.review_id?.trim() ?? ''
    if (!reviewId) return json({ error: 'REVIEW_ID_REQUIRED' }, 400)

    const [{ data: review, error: reviewError }, { data: profile, error: profileError }] = await Promise.all([
      context.client.from('reviews').select('id,organization_id,original_language,ai_detected_language,language').eq('id', reviewId).single(),
      context.client.from('profiles').select('preferred_language').eq('user_id', context.user.id).single(),
    ])
    if (reviewError || !review) return json({ error: 'REVIEW_NOT_FOUND' }, 404)
    await assertMembership(context.client, context.user.id, review.organization_id, ['owner', 'admin', 'manager'])
    if (profileError || !profile || !['fr', 'vi'].includes(profile.preferred_language)) {
      return json({ error: 'PREFERRED_LANGUAGE_REQUIRED' }, 400)
    }

    const { data: localized, error: localizedError } = await context.client
      .from('review_reply_drafts')
      .select('id,language,draft_text,draft_updated_at,draft_version')
      .eq('review_id', reviewId)
      .eq('language', profile.preferred_language)
      .single()
    if (localizedError || !localized) return json({ error: 'LOCALIZED_DRAFT_REQUIRED' }, 409)

    const draft = localized.draft_text?.trim() ?? ''
    const draftVersion = Number(localized.draft_version ?? 0)
    if (!draft) return json({ error: 'REPLY_DRAFT_REQUIRED' }, 400)
    if (body.draft_version !== undefined && body.draft_version !== draftVersion) {
      return json({ error: 'DRAFT_VERSION_CONFLICT' }, 409)
    }

    const sourceLanguage = normalizeLanguage(localized.language)
    const targetLanguage = normalizeLanguage(review.original_language ?? review.ai_detected_language ?? review.language)
    if (!sourceLanguage) return json({ error: 'DRAFT_LANGUAGE_UNKNOWN' }, 400)
    if (!targetLanguage) return json({ error: 'ORIGINAL_LANGUAGE_UNKNOWN' }, 400)
    if (sourceLanguage === targetLanguage) {
      return json({
        translation_required: false,
        reply_draft_text: draft,
        reply_draft_language: sourceLanguage,
        reply_draft_version: draftVersion,
      })
    }

    const result = await translateReplyWithOpenAI(draft, sourceLanguage, targetLanguage)
    const translatedAt = new Date().toISOString()
    const { data: saved, error: saveError } = await context.admin
      .from('review_reply_drafts')
      .update({
        translated_reply_text: result.translated_reply_text,
        translated_reply_language: targetLanguage,
        translated_from_draft_version: draftVersion,
        translated_at: translatedAt,
        updated_at: translatedAt,
      })
      .eq('id', localized.id)
      .eq('draft_version', draftVersion)
      .select('translated_reply_text,translated_reply_language,translated_from_draft_version,translated_at')
      .maybeSingle()
    if (saveError) throw saveError
    if (!saved) return json({ error: 'DRAFT_VERSION_CONFLICT' }, 409)

    return json({
      translation_required: true,
      translated_reply_text: saved.translated_reply_text,
      translated_reply_language: saved.translated_reply_language,
      translated_from_draft_updated_at: localized.draft_updated_at,
      translated_from_draft_version: saved.translated_from_draft_version,
      translated_reply_at: saved.translated_at,
      model: result.model,
      usage: result.usage,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 500) : 'REPLY_TRANSLATION_FAILED'
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'RATE_LIMITED' ? 429 : 500
    return json({ error: code }, status)
  }
})
