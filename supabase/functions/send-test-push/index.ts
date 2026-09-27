import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { sendPushToUser } from '../_shared/push.ts'

type TestType = 'simple' | 'deep_link'

const validKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request: Request) => {
  const options = preflight(request)
  if (options) return options
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  let deliveryId: string | null = null
  let admin: Awaited<ReturnType<typeof requireUser>>['admin'] | null = null

  try {
    const context = await requireUser(request)
    admin = context.admin
    const body = await request.json().catch(() => ({})) as {
      test_type?: TestType
      idempotency_key?: string
    }
    const testType = body.test_type
    const idempotencyKey = body.idempotency_key?.trim()

    if (!idempotencyKey || !validKey.test(idempotencyKey)) {
      return json({ error: 'INVALID_IDEMPOTENCY_KEY' }, 400)
    }
    if (testType !== 'simple' && testType !== 'deep_link') {
      return json({ error: 'INVALID_TEST_TYPE' }, 400)
    }

    const { data: previous, error: previousError } = await admin
      .from('push_test_deliveries')
      .select('status,test_type,push_attempted,provider_status')
      .eq('user_id', context.user.id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()
    if (previousError) throw previousError
    if (previous) {
      return json({
        ok: previous.status === 'sent',
        status: previous.status,
        test_type: previous.test_type,
        pushAttempted: previous.push_attempted,
        provider_status: previous.provider_status,
        reused: true,
      })
    }

    const { count, error: subscriptionError } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', context.user.id)
    if (subscriptionError) throw subscriptionError
    if (!count) return json({ error: 'PUSH_SUBSCRIPTION_NOT_FOUND' }, 409)

    let reviewId: string | null = null
    let payload = {
      title: 'HOME Reviews',
      body: 'Test notification HOME Reviews',
      url: '#/',
      tag: `home-reviews-test-simple-${idempotencyKey}`,
    }

    if (testType === 'deep_link') {
      const { data: simpleSuccess, error: simpleError } = await admin
        .from('push_test_deliveries')
        .select('id')
        .eq('user_id', context.user.id)
        .eq('test_type', 'simple')
        .eq('status', 'sent')
        .eq('push_attempted', true)
        .gte('provider_status', 200)
        .lt('provider_status', 300)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (simpleError) throw simpleError
      if (!simpleSuccess) return json({ error: 'SIMPLE_PUSH_SUCCESS_REQUIRED' }, 409)

      const { data: establishment, error: establishmentError } = await context.client
        .from('establishments')
        .select('id,name')
        .eq('name', 'Green Home Restaurant')
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      if (establishmentError) throw establishmentError
      if (!establishment) return json({ error: 'TEST_ESTABLISHMENT_NOT_FOUND' }, 404)

      const { data: review, error: reviewError } = await context.client
        .from('reviews')
        .select('id')
        .eq('establishment_id', establishment.id)
        .eq('rating', 2)
        .eq('ai_status', 'completed')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (reviewError) throw reviewError
      if (!review) return json({ error: 'TEST_REVIEW_NOT_FOUND' }, 404)

      reviewId = review.id
      payload = {
        title: 'HOME Reviews',
        body: '⭐ Nouvel avis 2★ — Green Home Restaurant\nRéponse prête à être vérifiée.',
        url: `#/avis/${review.id}`,
        tag: `home-reviews-test-review-${review.id}-${idempotencyKey}`,
      }
    }

    const { data: created, error: createError } = await admin
      .from('push_test_deliveries')
      .insert({
        user_id: context.user.id,
        idempotency_key: idempotencyKey,
        test_type: testType,
        review_id: reviewId,
        subscription_count: count,
      })
      .select('id')
      .single()

    if (createError) {
      if (createError.code === '23505') {
        return json({ ok: false, status: 'pending', test_type: testType, reused: true }, 409)
      }
      throw createError
    }
    deliveryId = created.id

    const result = await sendPushToUser(admin, context.user.id, payload)
    const providerStatus = result.providerStatusCodes[0] ?? null
    const delivered = result.sent > 0 && providerStatus !== null && providerStatus >= 200 && providerStatus < 300
    const pushAttempted = result.attempted > 0

    await admin
      .from('push_test_deliveries')
      .update({
        status: delivered ? 'sent' : 'failed',
        error: delivered ? null : 'PUSH_DELIVERY_FAILED',
        sent_at: delivered ? new Date().toISOString() : null,
        push_attempted: pushAttempted,
        provider_called: pushAttempted,
        provider_status: providerStatus,
        subscription_count: result.subscriptionCount,
        expired_subscriptions_removed: result.expiredRemoved,
      })
      .eq('id', deliveryId)

    const response = {
      ok: delivered,
      status: delivered ? 'sent' : 'failed',
      sent: result.sent,
      failed: result.failed,
      test_type: testType,
      pushAttempted,
      provider_status: providerStatus,
      expired_subscription_removed: result.expiredRemoved > 0,
      reused: false,
    }

    return delivered ? json(response) : json({ ...response, error: 'PUSH_DELIVERY_FAILED' }, 502)
  } catch (error) {
    if (admin && deliveryId) {
      await admin
        .from('push_test_deliveries')
        .update({ status: 'failed', error: 'PUSH_TEST_FAILED' })
        .eq('id', deliveryId)
    }
    const message = error instanceof Error ? error.message : 'PUSH_TEST_FAILED'
    if (message === 'UNAUTHORIZED') return json({ error: message }, 401)
    return json({ error: 'PUSH_TEST_FAILED' }, 500)
  }
})
