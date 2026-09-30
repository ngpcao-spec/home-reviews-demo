import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import {
  generateHistoricalSummary,
  historicalDataComplete,
  type HistoricalReportLanguage,
} from '../_shared/historical-report.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'

type MetricsRow = {
  stored_reviews_count: number | string
  negative_reviews_count: number | string
  negative_rate: number | string
  ready_replies_count: number | string
  rating_1_count: number | string
  rating_2_count: number | string
  rating_3_count: number | string
  rating_4_count: number | string
  rating_5_count: number | string
  source_latest_published_at: string | null
}

type ReviewRow = { rating: number; original_text: string | null; text: string | null }

Deno.serve(async (request) => {
  const preflightResponse = preflight(request)
  if (preflightResponse) return preflightResponse
  let claimedReportId: string | null = null
  let adminForFailure: Awaited<ReturnType<typeof requireUser>>['admin'] | null = null

  try {
    const context = await requireUser(request)
    adminForFailure = context.admin
    enforceRateLimit(`historical-report:${context.user.id}`, 12, 3_600_000)
    const body = await request.json() as { establishment_id?: string }
    const establishmentId = body.establishment_id?.trim() ?? ''
    if (!establishmentId) return json({ error: 'ESTABLISHMENT_ID_REQUIRED' }, 400)

    const [{ data: establishment, error: establishmentError }, { data: profile, error: profileError }] = await Promise.all([
      context.client.from('establishments')
        .select('id,organization_id,name,photo_url,rating,total_reviews,active,created_at,reporting_started_at')
        .eq('id', establishmentId)
        .single(),
      context.client.from('profiles').select('preferred_language').eq('user_id', context.user.id).single(),
    ])
    if (establishmentError || !establishment) return json({ error: 'ESTABLISHMENT_NOT_FOUND' }, 404)
    await assertMembership(context.client, context.user.id, establishment.organization_id, ['owner', 'admin', 'manager'])
    if (profileError || !profile || !['fr', 'vi'].includes(profile.preferred_language)) {
      return json({ error: 'PREFERRED_LANGUAGE_REQUIRED' }, 400)
    }
    const language = profile.preferred_language as HistoricalReportLanguage
    const now = new Date().toISOString()

    const { data: oldestReview, error: oldestError } = await context.admin
      .from('reviews')
      .select('published_at')
      .eq('organization_id', establishment.organization_id)
      .eq('establishment_id', establishmentId)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (oldestError) throw oldestError
    const periodStart = oldestReview?.published_at
      ?? establishment.reporting_started_at
      ?? establishment.created_at
      ?? now
    const dataComplete = establishment.active === true
      && historicalDataComplete(establishment.reporting_started_at, periodStart)

    const { data: metricsData, error: metricsError } = await context.admin.rpc('get_historical_report_metrics', {
      p_organization_id: establishment.organization_id,
      p_establishment_id: establishmentId,
      p_period_start: periodStart,
      p_period_end: now,
      p_language: language,
    }).single()
    if (metricsError || !metricsData) throw metricsError ?? new Error('HISTORICAL_METRICS_MISSING')
    const metrics = metricsData as MetricsRow
    const counts = {
      stored_reviews_count: Number(metrics.stored_reviews_count),
      negative_reviews_count: Number(metrics.negative_reviews_count),
      negative_rate: Number(metrics.negative_rate),
      ready_replies_count: Number(metrics.ready_replies_count),
      rating_1_count: Number(metrics.rating_1_count),
      rating_2_count: Number(metrics.rating_2_count),
      rating_3_count: Number(metrics.rating_3_count),
      rating_4_count: Number(metrics.rating_4_count),
      rating_5_count: Number(metrics.rating_5_count),
    }

    const { data: existing, error: existingError } = await context.client
      .from('historical_establishment_reports')
      .select('*')
      .eq('establishment_id', establishmentId)
      .eq('preferred_language', language)
      .maybeSingle()
    if (existingError) throw existingError

    const sourceUnchanged = Boolean(existing
      && Number(existing.stored_reviews_count) === counts.stored_reviews_count
      && existing.source_latest_published_at === metrics.source_latest_published_at)
    const baseRow = {
      organization_id: establishment.organization_id,
      establishment_id: establishmentId,
      preferred_language: language,
      period_start: periodStart,
      period_end: now,
      google_rating: establishment.rating ?? null,
      google_total_reviews: establishment.total_reviews ?? null,
      ...counts,
      data_complete: dataComplete,
      source_latest_published_at: metrics.source_latest_published_at,
      updated_at: now,
    }

    if (existing && sourceUnchanged && existing.ai_status === 'completed') {
      const { data: refreshed, error: refreshError } = await context.admin
        .from('historical_establishment_reports')
        .update(baseRow)
        .eq('id', existing.id)
        .select('*')
        .single()
      if (refreshError) throw refreshError
      return json({ report: refreshed })
    }
    if (existing && sourceUnchanged && (existing.ai_status === 'generating' || existing.ai_status === 'failed')) {
      return json({ report: existing }, existing.ai_status === 'generating' ? 202 : 200)
    }

    if (existing) {
      const { data: claimed, error: claimError } = await context.admin
        .from('historical_establishment_reports')
        .update({ ...baseRow, ai_historical_summary: null, ai_status: 'generating', ai_error: null })
        .eq('id', existing.id)
        .eq('updated_at', existing.updated_at)
        .select('id')
        .maybeSingle()
      if (claimError) throw claimError
      if (!claimed) {
        const { data: raced } = await context.client.from('historical_establishment_reports').select('*').eq('id', existing.id).single()
        return json({ report: raced }, 202)
      }
      claimedReportId = claimed.id
    } else {
      const { data: inserted, error: insertError } = await context.admin
        .from('historical_establishment_reports')
        .insert({ ...baseRow, ai_status: 'generating', ai_error: null })
        .select('id')
        .single()
      if (insertError) {
        if (insertError.code === '23505') {
          const { data: raced } = await context.client
            .from('historical_establishment_reports')
            .select('*')
            .eq('establishment_id', establishmentId)
            .eq('preferred_language', language)
            .single()
          return json({ report: raced }, 202)
        }
        throw insertError
      }
      claimedReportId = inserted.id
    }

    const { data: negativeData, error: negativeError } = await context.admin
      .from('reviews')
      .select('rating,original_text,text')
      .eq('organization_id', establishment.organization_id)
      .eq('establishment_id', establishmentId)
      .gte('published_at', periodStart)
      .lt('published_at', now)
      .gte('rating', 1)
      .lte('rating', 3)
      .order('published_at', { ascending: true })
    if (negativeError) throw negativeError
    const negativeReviews = (negativeData ?? []) as ReviewRow[]
    const summaryResult = await generateHistoricalSummary(negativeReviews.map((review) => ({
      rating: review.rating,
      originalText: review.original_text?.trim() || review.text?.trim() || '',
    })), language)
    const generatedAt = new Date().toISOString()
    const { data: completed, error: completionError } = await context.admin
      .from('historical_establishment_reports')
      .update({
        ...baseRow,
        period_end: generatedAt,
        ai_historical_summary: summaryResult.summary,
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
    const code = error instanceof Error ? error.message.slice(0, 500) : 'HISTORICAL_REPORT_FAILED'
    if (claimedReportId && adminForFailure) {
      await adminForFailure.from('historical_establishment_reports').update({
        ai_status: 'failed',
        ai_error: code,
        updated_at: new Date().toISOString(),
      }).eq('id', claimedReportId)
    }
    const status = code === 'UNAUTHORIZED' ? 401
      : code === 'FORBIDDEN' ? 403
      : code === 'RATE_LIMITED' ? 429
      : 500
    return json({ error: code }, status)
  }
})
