import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import {
  calculateWeeklyMetrics,
  currentVietnamPeriod,
  generateWeeklySummary,
  isReportingPeriodComplete,
  lastCompletedVietnamWeekStart,
  periodFromVietnamMonday,
  type WeeklyReportLanguage,
} from '../_shared/weekly-report.ts'

type ReviewRow = { id: string; rating: number; original_text: string | null; text: string | null }
type DraftRow = { review_id: string; draft_text: string | null; ai_suggested_reply: string | null }

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  let claimedReportId: string | null = null
  let adminForFailure: Awaited<ReturnType<typeof requireUser>>['admin'] | null = null

  try {
    const context = await requireUser(request)
    adminForFailure = context.admin
    enforceRateLimit(`weekly-report:${context.user.id}`, 30, 3_600_000)
    const body = await request.json() as { establishment_id?: string; period_start?: string; provisional?: boolean }
    const establishmentId = body.establishment_id?.trim() ?? ''
    if (!establishmentId) return json({ error: 'ESTABLISHMENT_ID_REQUIRED' }, 400)

    const provisional = body.provisional === true
    const period = provisional
      ? currentVietnamPeriod()
      : { ...periodFromVietnamMonday(body.period_start ?? lastCompletedVietnamWeekStart()), provisional: false as const }
    const currentWeek = periodFromVietnamMonday(lastCompletedVietnamWeekStart())
    if (!provisional && new Date(period.startAt).getTime() > new Date(currentWeek.startAt).getTime()) {
      return json({ error: 'PERIOD_NOT_COMPLETED' }, 400)
    }

    const [{ data: establishment, error: establishmentError }, { data: profile, error: profileError }] = await Promise.all([
      context.client.from('establishments').select('id,organization_id,name,photo_url,active,reporting_started_at').eq('id', establishmentId).single(),
      context.client.from('profiles').select('preferred_language').eq('user_id', context.user.id).single(),
    ])
    if (establishmentError || !establishment) return json({ error: 'ESTABLISHMENT_NOT_FOUND' }, 404)
    await assertMembership(context.client, context.user.id, establishment.organization_id, ['owner', 'admin', 'manager'])
    if (profileError || !profile || !['fr', 'vi'].includes(profile.preferred_language)) {
      return json({ error: 'PREFERRED_LANGUAGE_REQUIRED' }, 400)
    }
    const language = profile.preferred_language as WeeklyReportLanguage
    const dataComplete = establishment.active === true
      && isReportingPeriodComplete(establishment.reporting_started_at, period.startAt)

    const existing = provisional ? null : (await context.client
      .from('weekly_establishment_reports')
      .select('*')
      .eq('establishment_id', establishmentId)
      .eq('period_start', period.startAt)
      .eq('preferred_language', language)
      .maybeSingle()).data
    if (existing?.ai_status === 'completed' || existing?.ai_status === 'generating') {
      return json({ report: existing }, existing.ai_status === 'generating' ? 202 : 200)
    }

    const [{ data: reviewData, error: reviewError }, { data: snapshot, error: snapshotError }] = await Promise.all([
      context.admin
        .from('reviews')
        .select('id,rating,original_text,text')
        .eq('organization_id', establishment.organization_id)
        .eq('establishment_id', establishmentId)
        .gte('published_at', period.startAt)
        .lt('published_at', period.endAt)
        .order('published_at', { ascending: true }),
      context.admin
        .from('establishment_snapshots')
        .select('rating,total_reviews,captured_at')
        .eq('organization_id', establishment.organization_id)
        .eq('establishment_id', establishmentId)
        .lte('captured_at', period.endAt)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (reviewError) throw reviewError
    if (snapshotError) throw snapshotError
    const reviews = (reviewData ?? []) as ReviewRow[]
    const metrics = calculateWeeklyMetrics(reviews)
    const negativeReviews = reviews.filter((review) => review.rating >= 1 && review.rating <= 3)
    const negativeIds = negativeReviews.map((review) => review.id)
    let readyRepliesCount = 0
    if (negativeIds.length > 0) {
      const { data: drafts, error: draftsError } = await context.admin
        .from('review_reply_drafts')
        .select('review_id,draft_text,ai_suggested_reply')
        .in('review_id', negativeIds)
        .eq('language', language)
        .eq('ai_status', 'completed')
      if (draftsError) throw draftsError
      readyRepliesCount = new Set(((drafts ?? []) as DraftRow[])
        .filter((draft) => Boolean(draft.draft_text?.trim() || draft.ai_suggested_reply?.trim()))
        .map((draft) => draft.review_id)).size
    }

    const baseRow = {
      organization_id: establishment.organization_id,
      establishment_id: establishmentId,
      period_start: period.startAt,
      period_end: period.endAt,
      preferred_language: language,
      google_rating: snapshot?.rating ?? null,
      google_total_reviews: snapshot?.total_reviews ?? null,
      snapshot_captured_at: snapshot?.captured_at ?? null,
      new_reviews_count: metrics.newReviewsCount,
      negative_reviews_count: metrics.negativeReviewsCount,
      negative_rate: metrics.negativeRate,
      ready_replies_count: readyRepliesCount,
      data_complete: dataComplete,
      ai_status: dataComplete ? 'generating' : 'completed',
      ai_error: null,
      updated_at: new Date().toISOString(),
    }

    if (provisional) {
      const summaryResult = dataComplete
        ? await generateWeeklySummary(negativeReviews.map((review) => ({
          rating: review.rating,
          originalText: review.original_text?.trim() || review.text?.trim() || '',
        })), language)
        : null
      return json({ report: {
        id: `provisional-${establishmentId}-${period.periodStart}-${language}`,
        ...baseRow,
        ai_weekly_summary: summaryResult?.summary ?? null,
        ai_status: 'completed',
        ai_model: summaryResult?.model ?? null,
        ai_input_tokens: summaryResult?.usage?.input_tokens ?? null,
        ai_output_tokens: summaryResult?.usage?.output_tokens ?? null,
        ai_total_tokens: summaryResult?.usage?.total_tokens ?? null,
        generated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        provisional: true,
      } })
    }

    if (existing?.ai_status === 'failed') {
      const { data: claimed, error: claimError } = await context.admin
        .from('weekly_establishment_reports')
        .update(baseRow)
        .eq('id', existing.id)
        .eq('ai_status', 'failed')
        .select('id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) return json({ report: existing }, 202)
      claimedReportId = claimed.id
    } else {
      const { data: inserted, error: insertError } = await context.admin
        .from('weekly_establishment_reports')
        .insert(baseRow)
        .select('id')
        .single()
      if (insertError) {
        if (insertError.code === '23505') {
          const { data: raced } = await context.client
            .from('weekly_establishment_reports')
            .select('*')
            .eq('establishment_id', establishmentId)
            .eq('period_start', period.startAt)
            .eq('preferred_language', language)
            .single()
          return json({ report: raced }, raced?.ai_status === 'completed' ? 200 : 202)
        }
        throw insertError
      }
      claimedReportId = inserted.id
    }

    if (!dataComplete) {
      const { data: incomplete, error: incompleteError } = await context.admin
        .from('weekly_establishment_reports')
        .select('*')
        .eq('id', claimedReportId)
        .single()
      if (incompleteError) throw incompleteError
      return json({ report: incomplete })
    }

    const summaryResult = await generateWeeklySummary(
      negativeReviews.map((review) => ({
        rating: review.rating,
        originalText: review.original_text?.trim() || review.text?.trim() || '',
      })),
      language,
    )
    const generatedAt = new Date().toISOString()
    const { data: completed, error: completionError } = await context.admin
      .from('weekly_establishment_reports')
      .update({
        ai_weekly_summary: summaryResult.summary,
        ai_status: 'completed',
        ai_error: null,
        ai_model: summaryResult.model,
        ai_input_tokens: summaryResult.usage?.input_tokens ?? null,
        ai_output_tokens: summaryResult.usage?.output_tokens ?? null,
        ai_total_tokens: summaryResult.usage?.total_tokens ?? null,
        generated_at: generatedAt,
        updated_at: generatedAt,
      })
      .eq('id', claimedReportId)
      .select('*')
      .single()
    if (completionError) throw completionError
    return json({ report: completed })
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 500) : 'WEEKLY_REPORT_FAILED'
    if (claimedReportId && adminForFailure) {
      await adminForFailure.from('weekly_establishment_reports').update({
        ai_status: 'failed',
        ai_error: code,
        updated_at: new Date().toISOString(),
      }).eq('id', claimedReportId)
    }
    const status = code === 'UNAUTHORIZED' ? 401
      : code === 'FORBIDDEN' ? 403
      : code === 'RATE_LIMITED' ? 429
      : code === 'INVALID_PERIOD_START' ? 400
      : 500
    return json({ error: code }, status)
  }
})
