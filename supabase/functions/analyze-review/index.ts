import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { analyzeReviewWithOpenAI } from '../_shared/ai.ts'
import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'

interface ReviewRow {
  id: string
  organization_id: string
  rating: number
  text: string
  language: string | null
  ai_summary: string | null
  ai_suggested_reply: string | null
  ai_detected_language: string | null
  ai_analyzed_at: string | null
  ai_status: 'pending' | 'processing' | 'completed' | 'failed' | null
  ai_error: string | null
  ai_error_history: Array<{ error: string; at: string }> | null
  ai_attempt_count: number | null
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
      .select('id,organization_id,rating,text,language,ai_summary,ai_suggested_reply,ai_detected_language,ai_analyzed_at,ai_status,ai_error,ai_error_history,ai_attempt_count')
      .eq('id', reviewId)
      .single()
    if (error || !data) return json({ error: 'REVIEW_NOT_FOUND' }, 404)

    const review = data as ReviewRow
    if (review.rating > 3) return json({ error: 'ANALYSIS_NOT_REQUIRED' }, 400)
    if (review.ai_status === 'completed' && !body.regenerate) {
      return json({
        ai_summary: review.ai_summary,
        ai_suggested_reply: review.ai_suggested_reply,
        detected_language: review.ai_detected_language,
        ai_analyzed_at: review.ai_analyzed_at,
        ai_status: review.ai_status,
        reused: true,
      })
    }

    if (review.ai_status === 'processing' && !body.regenerate) {
      return json({ error: 'ANALYSIS_IN_PROGRESS' }, 409)
    }

    const errorHistory = Array.isArray(review.ai_error_history) ? [...review.ai_error_history] : []
    if (review.ai_error) errorHistory.push({ error: review.ai_error, at: new Date().toISOString() })
    const { error: pendingError } = await admin.from('reviews').update({
      ai_status: 'processing',
      ai_error: null,
      ai_error_history: errorHistory,
      ai_attempt_count: (review.ai_attempt_count ?? 0) + 1,
    }).eq('id', review.id)
    if (pendingError) throw pendingError

    const result = await analyzeReviewWithOpenAI(review.rating, review.text)
    const analyzedAt = new Date().toISOString()
    const { error: saveError } = await admin.from('reviews').update({
      ai_summary: result.ai_summary,
      ai_suggested_reply: result.ai_suggested_reply,
      ai_detected_language: result.detected_language,
      ai_analyzed_at: analyzedAt,
      ai_status: 'completed',
      ai_error: null,
      ai_model: result.model,
      ai_input_tokens: result.usage?.input_tokens ?? null,
      ai_output_tokens: result.usage?.output_tokens ?? null,
      ai_reasoning_tokens: result.usage?.output_tokens_details?.reasoning_tokens ?? null,
      ai_total_tokens: result.usage?.total_tokens ?? null,
    }).eq('id', review.id)
    if (saveError) throw saveError

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
      ai_analyzed_at: analyzedAt,
      ai_status: 'completed',
    })
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 500) : 'AI_ANALYSIS_FAILED'
    if (reviewId) {
      await admin.from('reviews').update({
        ai_status: 'failed',
        ai_error: code,
      }).eq('id', reviewId)
    }
    return json({ error: code }, code === 'UNAUTHORIZED' ? 401 : code === 'RATE_LIMITED' ? 429 : 500)
  }
})
