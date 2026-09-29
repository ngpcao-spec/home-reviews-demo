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
      context.client.from('reviews').select('id,organization_id,reply_draft_version').eq('id', reviewId).single(),
      context.client.from('profiles').select('preferred_language').eq('user_id', context.user.id).single(),
    ])
    if (reviewError || !review) return json({ error: 'REVIEW_NOT_FOUND' }, 404)
    await assertMembership(context.client, context.user.id, review.organization_id, ['owner', 'admin', 'manager'])
    if (profileError || !profile || !['fr', 'vi'].includes(profile.preferred_language)) {
      return json({ error: 'PREFERRED_LANGUAGE_REQUIRED' }, 400)
    }

    const currentVersion = Number(review.reply_draft_version ?? 0)
    const updatedAt = new Date().toISOString()
    const { data: saved, error: saveError } = await context.admin
      .from('reviews')
      .update({
        reply_draft_text: draftText,
        reply_draft_language: profile.preferred_language,
        reply_draft_updated_at: updatedAt,
        reply_draft_version: currentVersion + 1,
      })
      .eq('id', reviewId)
      .eq('reply_draft_version', currentVersion)
      .select('reply_draft_text,reply_draft_language,reply_draft_updated_at,reply_draft_version')
      .maybeSingle()
    if (saveError) throw saveError
    if (!saved) return json({ error: 'DRAFT_VERSION_CONFLICT' }, 409)
    return json(saved)
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 500) : 'DRAFT_SAVE_FAILED'
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'RATE_LIMITED' ? 429 : 500
    return json({ error: code }, status)
  }
})
