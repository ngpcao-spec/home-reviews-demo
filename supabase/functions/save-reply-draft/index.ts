import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse

  try {
    const context = await requireUser(request)
    enforceRateLimit(`save-reply-draft:${context.user.id}`, 600, 3_600_000)
    const body = await request.json() as { review_id?: string; draft_text?: string }
    const reviewId = body.review_id?.trim() ?? ''
    const draftText = body.draft_text
    if (!reviewId) return json({ error: 'REVIEW_ID_REQUIRED' }, 400)
    if (typeof draftText !== 'string' || draftText.length > 4000) return json({ error: 'INVALID_DRAFT' }, 400)

    const [{ data: review, error: reviewError }, { data: profile, error: profileError }] = await Promise.all([
      context.client.from('reviews').select('id,organization_id').eq('id', reviewId).single(),
      context.client.from('profiles').select('preferred_language').eq('user_id', context.user.id).single(),
    ])
    if (reviewError || !review) return json({ error: 'REVIEW_NOT_FOUND' }, 404)
    await assertMembership(context.client, context.user.id, review.organization_id, ['owner', 'admin', 'manager'])
    if (profileError || !profile || !['fr', 'vi'].includes(profile.preferred_language)) {
      return json({ error: 'PREFERRED_LANGUAGE_REQUIRED' }, 400)
    }

    const { data: localized, error: localizedError } = await context.client
      .from('review_reply_drafts')
      .select('id,draft_version')
      .eq('review_id', reviewId)
      .eq('language', profile.preferred_language)
      .single()
    if (localizedError || !localized) return json({ error: 'LOCALIZED_DRAFT_REQUIRED' }, 409)

    const currentVersion = Number(localized.draft_version ?? 0)
    const updatedAt = new Date().toISOString()
    const { data: saved, error: saveError } = await context.admin
      .from('review_reply_drafts')
      .update({
        draft_text: draftText,
        draft_updated_at: updatedAt,
        draft_version: currentVersion + 1,
        updated_at: updatedAt,
      })
      .eq('id', localized.id)
      .eq('draft_version', currentVersion)
      .select('draft_text,draft_updated_at,draft_version,language')
      .maybeSingle()
    if (saveError) throw saveError
    if (!saved) return json({ error: 'DRAFT_VERSION_CONFLICT' }, 409)
    return json({
      reply_draft_text: saved.draft_text,
      reply_draft_language: saved.language,
      reply_draft_updated_at: saved.draft_updated_at,
      reply_draft_version: saved.draft_version,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 500) : 'DRAFT_SAVE_FAILED'
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'RATE_LIMITED' ? 429 : 500
    return json({ error: code }, status)
  }
})
