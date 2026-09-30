import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { analyzeFourStarReviewWithOpenAI, analyzeReviewWithOpenAI, ReviewAiValidationError } from '../_shared/ai.ts'
import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { sendPushToUser } from '../_shared/push.ts'
import { isDuplicateNotificationError, runNonBlockingNotification, shouldCreateReviewNotification } from '../_shared/notification-rules.ts'
import { shouldAutomaticallyAnalyzeReview } from '../_shared/ai-rules.ts'
import { preferredLanguageForOrganization, preferredLanguageForUser } from '../_shared/preferences.ts'

interface ReviewRow {
  id: string
  organization_id: string
  establishment_id: string
  historical_import: boolean
  rating: number
  text: string
  original_text: string
  language: string | null
  ai_summary: string | null
  ai_suggested_reply: string | null
  ai_suggested_reply_language: string | null
  ai_detected_language: string | null
  ai_analyzed_at: string | null
  ai_status: 'pending' | 'processing' | 'completed' | 'failed' | null
  ai_error: string | null
  ai_error_history: Array<{ error: string; at: string }> | null
  ai_attempt_count: number | null
  reply_draft_version: number | null
  review_context: unknown
  review_detailed_rating: unknown
  has_negative_feedback: boolean | null
  negative_feedback_summary: string | null
  negative_feedback_checked_at: string | null
  negative_feedback_model: string | null
  negative_feedback_status: 'processing' | 'completed' | 'failed' | null
}

interface LocalizedDraftRow {
  id: string
  language: 'fr' | 'vi'
  ai_summary: string | null
  ai_suggested_reply: string | null
  draft_text: string | null
  draft_updated_at: string | null
  draft_version: number
  ai_status: 'pending' | 'processing' | 'completed' | 'failed'
  ai_error: string | null
}

async function notifyNewReview(admin: SupabaseClient, review: ReviewRow, summary: string) {
  if (!shouldCreateReviewNotification(review)) return

  const [{ data: establishment }, { data: members }] = await Promise.all([
    admin.from('establishments').select('name').eq('id', review.establishment_id).single(),
    admin.from('organization_members').select('user_id').eq('organization_id', review.organization_id),
  ])
  if (!establishment?.name || !members?.length) return

  const shortSummary = summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}…` : summary
  const shortLegacyTitle = `⭐ Nouvel avis ${review.rating}★ — ${establishment.name}`

  for (const member of members as Array<{ user_id: string }>) {
    const language = review.rating === 4
      ? await preferredLanguageForUser(admin, member.user_id)
      : 'fr'
    const isFourStarWatch = review.rating === 4
    const title = isFourStarWatch
      ? language === 'vi' ? '⭐ Đánh giá 4★ — cần lưu ý' : '⭐ Avis 4★ — point à surveiller'
      : shortLegacyTitle
    const readyText = language === 'vi' ? 'Phản hồi đã sẵn sàng' : 'Réponse prête'
    const body = isFourStarWatch
      ? `${establishment.name}\n${shortSummary}\n${readyText}`
      : shortSummary
    const notificationType = isFourStarWatch ? 'four_star_attention' : 'new_negative_review'
    const inserted = await admin.from('notifications').insert({
      organization_id: review.organization_id,
      user_id: member.user_id,
      review_id: review.id,
      establishment_id: review.establishment_id,
      type: notificationType,
      title,
      body,
    }).select('id').maybeSingle()

    if (isDuplicateNotificationError(inserted.error?.code)) continue
    if (inserted.error || !inserted.data) continue

    try {
      const push = await sendPushToUser(admin, member.user_id, {
        title: isFourStarWatch ? title : 'HOME Reviews',
        body: isFourStarWatch ? body : `${title}\n“${shortSummary}”\nRéponse prête à être vérifiée.`,
        url: `#/avis/${review.id}`,
        tag: `review-${review.id}`,
      })
      const status = push.skipped ? 'skipped' : push.sent > 0 ? 'sent' : 'failed'
      await admin.from('notifications').update({
        push_status: status,
        push_error: push.failed > 0 ? 'PUSH_DELIVERY_PARTIAL_OR_FAILED' : null,
        pushed_at: push.sent > 0 ? new Date().toISOString() : null,
      }).eq('id', inserted.data.id)
    } catch {
      await admin.from('notifications').update({
        push_status: 'failed',
        push_error: 'PUSH_DELIVERY_FAILED',
      }).eq('id', inserted.data.id)
    }
  }
}

async function sameSecret(left: string, right: string) {
  const encoder = new TextEncoder()
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const leftBytes = new Uint8Array(leftHash)
  const rightBytes = new Uint8Array(rightHash)
  return leftBytes.every((value, index) => value === rightBytes[index])
}

async function webhookAuthorized(admin: SupabaseClient, provided: string | null) {
  if (!provided) return false
  const { data, error } = await admin.from('ai_webhook_config').select('secret').eq('singleton', true).single()
  if (error || !data?.secret) return false
  return sameSecret(provided, data.secret)
}

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  let reviewId = ''
  let workingLanguage: 'fr' | 'vi' | null = null
  let legacySuggestionExists = false
  let fourStarCheckClaimed = false

  try {
    const body = await request.json() as { review_id?: string; regenerate?: boolean }
    reviewId = body.review_id?.trim() ?? ''
    if (!reviewId) return json({ error: 'REVIEW_ID_REQUIRED' }, 400)

    const automatic = await webhookAuthorized(admin, request.headers.get('x-home-reviews-webhook'))
    let reader: SupabaseClient = admin
    let userId: string | null = null

    if (!automatic) {
      const context = await requireUser(request)
      enforceRateLimit(`analyze:${context.user.id}`, 10, 3_600_000)
      reader = context.client
      userId = context.user.id
    }

    const { data, error } = await reader
      .from('reviews')
      .select('id,organization_id,establishment_id,historical_import,rating,text,original_text,language,ai_summary,ai_suggested_reply,ai_suggested_reply_language,ai_detected_language,ai_analyzed_at,ai_status,ai_error,ai_error_history,ai_attempt_count,reply_draft_version,review_context,review_detailed_rating,has_negative_feedback,negative_feedback_summary,negative_feedback_checked_at,negative_feedback_model,negative_feedback_status')
      .eq('id', reviewId)
      .single()
    if (error || !data) return json({ error: 'REVIEW_NOT_FOUND' }, 404)

    const review = data as ReviewRow
    legacySuggestionExists = Boolean(review.ai_suggested_reply)
    if (automatic && !shouldAutomaticallyAnalyzeReview(review)) {
      return json({ ai_status: review.ai_status, skipped: true, reason: 'HISTORICAL_IMPORT' })
    }
    if (review.rating > 4) return json({ error: 'ANALYSIS_NOT_REQUIRED' }, 400)
    if (review.rating === 4 && !(review.original_text || review.text).trim()) {
      return json({ skipped: true, reason: 'FOUR_STAR_WITHOUT_TEXT' })
    }
    if (review.rating === 4 && review.negative_feedback_checked_at && review.has_negative_feedback !== true && !body.regenerate) {
      return json({ skipped: true, reason: 'NO_NEGATIVE_FEEDBACK', has_negative_feedback: false })
    }

    workingLanguage = userId
      ? await preferredLanguageForUser(admin, userId)
      : await preferredLanguageForOrganization(admin, review.organization_id)

    const { data: existingData, error: existingError } = await admin
      .from('review_reply_drafts')
      .select('id,language,ai_summary,ai_suggested_reply,draft_text,draft_updated_at,draft_version,ai_status,ai_error')
      .eq('review_id', review.id)
      .eq('language', workingLanguage)
      .maybeSingle()
    if (existingError) throw existingError
    let localized = existingData as LocalizedDraftRow | null

    if (localized?.ai_status === 'completed' && localized.draft_text && !body.regenerate) {
      return json({
        ai_summary: localized.ai_summary,
        ai_suggested_reply: localized.ai_suggested_reply,
        ai_suggested_reply_language: localized.language,
        reply_draft_text: localized.draft_text,
        reply_draft_language: localized.language,
        reply_draft_updated_at: localized.draft_updated_at,
        reply_draft_version: localized.draft_version,
        detected_language: review.ai_detected_language,
        ai_analyzed_at: review.ai_analyzed_at,
        ai_status: localized.ai_status,
        reused: true,
      })
    }
    if (localized?.ai_status === 'processing') {
      return json({ error: 'ANALYSIS_IN_PROGRESS' }, 409)
    }

    if (review.rating === 4 && !review.negative_feedback_checked_at) {
      const { data: claimed, error: claimError } = await admin
        .from('reviews')
        .update({ negative_feedback_status: 'processing', ai_error: null })
        .eq('id', review.id)
        .or('negative_feedback_status.is.null,negative_feedback_status.eq.failed')
        .select('id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) return json({ error: 'ANALYSIS_IN_PROGRESS' }, 409)
      fourStarCheckClaimed = true

      const result = await analyzeFourStarReviewWithOpenAI(
        review.original_text || review.text,
        workingLanguage,
        review.review_detailed_rating,
        review.review_context,
      )
      const analyzedAt = new Date().toISOString()
      const commonUpdate = {
        has_negative_feedback: result.has_negative_feedback,
        negative_feedback_summary: result.negative_feedback_summary,
        negative_feedback_checked_at: analyzedAt,
        negative_feedback_model: result.model,
        negative_feedback_status: 'completed',
        ai_detected_language: result.detected_language,
        ai_model: result.model,
        ai_input_tokens: result.usage?.input_tokens ?? null,
        ai_output_tokens: result.usage?.output_tokens ?? null,
        ai_reasoning_tokens: result.usage?.output_tokens_details?.reasoning_tokens ?? null,
        ai_total_tokens: result.usage?.total_tokens ?? null,
        ai_error: null,
      }

      if (!result.has_negative_feedback) {
        const { error: saveNoFeedbackError } = await admin.from('reviews').update({
          ...commonUpdate,
          requires_attention: false,
          requires_ai_analysis: false,
          status: 'ignored',
          ai_status: null,
        }).eq('id', review.id)
        if (saveNoFeedbackError) throw saveNoFeedbackError
        return json({ has_negative_feedback: false, ai_status: 'completed' })
      }

      const nextDraftVersion = 1
      const { error: draftError } = await admin.from('review_reply_drafts').upsert({
        review_id: review.id,
        language: workingLanguage,
        ai_summary: result.negative_feedback_summary,
        ai_suggested_reply: result.ai_suggested_reply,
        draft_text: result.ai_suggested_reply,
        draft_updated_at: analyzedAt,
        draft_version: nextDraftVersion,
        ai_status: 'completed',
        ai_error: null,
        updated_at: analyzedAt,
      }, { onConflict: 'review_id,language' })
      if (draftError) throw draftError

      const { error: saveFeedbackError } = await admin.from('reviews').update({
        ...commonUpdate,
        requires_attention: true,
        requires_ai_analysis: true,
        status: 'to_process',
        ai_summary: result.negative_feedback_summary,
        ai_suggested_reply: result.ai_suggested_reply,
        ai_suggested_reply_language: workingLanguage,
        reply_draft_text: result.ai_suggested_reply,
        reply_draft_language: workingLanguage,
        reply_draft_updated_at: analyzedAt,
        reply_draft_version: nextDraftVersion,
        ai_analyzed_at: analyzedAt,
        ai_status: 'completed',
      }).eq('id', review.id)
      if (saveFeedbackError) throw saveFeedbackError

      if (automatic) {
        await runNonBlockingNotification(() => notifyNewReview(
          admin,
          { ...review, has_negative_feedback: true },
          result.negative_feedback_summary!,
        ))
      }
      return json({
        ...result,
        ai_summary: result.negative_feedback_summary,
        ai_suggested_reply_language: workingLanguage,
        reply_draft_text: result.ai_suggested_reply,
        reply_draft_language: workingLanguage,
        reply_draft_updated_at: analyzedAt,
        reply_draft_version: nextDraftVersion,
        ai_analyzed_at: analyzedAt,
        ai_status: 'completed',
      })
    }

    if (localized) {
      const { data: claimed, error: claimError } = await admin
        .from('review_reply_drafts')
        .update({ ai_status: 'processing', ai_error: null, updated_at: new Date().toISOString() })
        .eq('id', localized.id)
        .neq('ai_status', 'processing')
        .select('id,language,ai_summary,ai_suggested_reply,draft_text,draft_updated_at,draft_version,ai_status,ai_error')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) return json({ error: 'ANALYSIS_IN_PROGRESS' }, 409)
      localized = claimed as LocalizedDraftRow
    } else {
      const inserted = await admin.from('review_reply_drafts').insert({
        review_id: review.id,
        language: workingLanguage,
        ai_status: 'processing',
      }).select('id,language,ai_summary,ai_suggested_reply,draft_text,draft_updated_at,draft_version,ai_status,ai_error').maybeSingle()
      if (inserted.error?.code === '23505') return json({ error: 'ANALYSIS_IN_PROGRESS' }, 409)
      if (inserted.error || !inserted.data) throw inserted.error ?? new Error('AI_DRAFT_CLAIM_FAILED')
      localized = inserted.data as LocalizedDraftRow
    }

    const errorHistory = Array.isArray(review.ai_error_history) ? [...review.ai_error_history] : []
    if (review.ai_error) errorHistory.push({ error: review.ai_error, at: new Date().toISOString() })
    const pendingReviewUpdate: Record<string, unknown> = {
      ai_error_history: errorHistory,
      ai_attempt_count: (review.ai_attempt_count ?? 0) + 1,
    }
    if (!review.ai_suggested_reply) {
      pendingReviewUpdate.ai_status = 'processing'
      pendingReviewUpdate.ai_error = null
    }
    const { error: pendingError } = await admin.from('reviews').update(pendingReviewUpdate).eq('id', review.id)
    if (pendingError) throw pendingError

    const result = await analyzeReviewWithOpenAI(review.rating, review.original_text || review.text, workingLanguage)
    const analyzedAt = new Date().toISOString()
    const currentDraftVersion = localized.draft_version ?? 0
    const nextDraftVersion = currentDraftVersion + 1
    const { error: localizedSaveError } = await admin.from('review_reply_drafts').update({
      ai_summary: result.ai_summary,
      ai_suggested_reply: result.ai_suggested_reply,
      draft_text: result.ai_suggested_reply,
      draft_updated_at: analyzedAt,
      draft_version: nextDraftVersion,
      ai_status: 'completed',
      ai_error: null,
      updated_at: analyzedAt,
    }).eq('id', localized.id).eq('ai_status', 'processing')
    if (localizedSaveError) throw localizedSaveError

    const reviewUpdate: Record<string, unknown> = {
      ai_detected_language: result.detected_language,
      ai_analyzed_at: analyzedAt,
      ai_status: 'completed',
      ai_error: null,
      ai_model: result.model,
      ai_input_tokens: result.usage?.input_tokens ?? null,
      ai_output_tokens: result.usage?.output_tokens ?? null,
      ai_reasoning_tokens: result.usage?.output_tokens_details?.reasoning_tokens ?? null,
      ai_total_tokens: result.usage?.total_tokens ?? null,
      ai_last_rejected_summary: null,
      ai_last_rejected_reply: null,
      ai_last_rejected_language: null,
      ai_validation_error: null,
    }
    if (!review.ai_suggested_reply) {
      Object.assign(reviewUpdate, {
        ai_summary: result.ai_summary,
        ai_suggested_reply: result.ai_suggested_reply,
        ai_suggested_reply_language: workingLanguage,
        reply_draft_text: result.ai_suggested_reply,
        reply_draft_language: workingLanguage,
        reply_draft_updated_at: analyzedAt,
        reply_draft_version: nextDraftVersion,
      })
    }
    const { error: saveError } = await admin.from('reviews').update(reviewUpdate).eq('id', review.id)
    if (saveError) throw saveError

    if (automatic) {
      // Notification and push failures must never fail review analysis or synchronization.
      await runNonBlockingNotification(() => notifyNewReview(admin, review, result.ai_summary))
    }

    if (userId) {
      await admin.from('review_actions').insert({
        review_id: review.id,
        organization_id: review.organization_id,
        user_id: userId,
        action_type: 'response_generated',
      })
    }

    return json({
      ...result,
      ai_suggested_reply_language: workingLanguage,
      reply_draft_text: result.ai_suggested_reply,
      reply_draft_language: workingLanguage,
      reply_draft_updated_at: analyzedAt,
      reply_draft_version: nextDraftVersion,
      ai_analyzed_at: analyzedAt,
      ai_status: 'completed',
    })
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 500) : 'AI_ANALYSIS_FAILED'
    const rejected = error instanceof ReviewAiValidationError ? error.result : null
    if (reviewId && fourStarCheckClaimed) {
      await admin.from('reviews').update({
        negative_feedback_status: 'failed',
        ai_status: 'failed',
        ai_error: code,
      }).eq('id', reviewId).eq('negative_feedback_status', 'processing')
    }
    if (reviewId && workingLanguage) {
      await admin.from('review_reply_drafts').update({
        ai_status: 'failed',
        ai_error: code,
        updated_at: new Date().toISOString(),
      }).eq('review_id', reviewId).eq('language', workingLanguage).eq('ai_status', 'processing')
    }
    if (reviewId) {
      const failedReviewUpdate: Record<string, unknown> = {
        ai_last_rejected_summary: rejected?.ai_summary ?? null,
        ai_last_rejected_reply: rejected?.ai_suggested_reply ?? null,
        ai_last_rejected_language: rejected?.detected_language ?? null,
        ai_validation_error: rejected ? code : null,
      }
      if (!legacySuggestionExists) {
        failedReviewUpdate.ai_status = 'failed'
        failedReviewUpdate.ai_error = code
      }
      await admin.from('reviews').update(failedReviewUpdate).eq('id', reviewId)
    }
    return json({ error: code }, code === 'UNAUTHORIZED' ? 401 : code === 'RATE_LIMITED' ? 429 : 500)
  }
})
