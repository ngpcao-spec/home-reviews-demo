// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ rpc: vi.fn(), push: vi.fn() }))
vi.mock('npm:@supabase/supabase-js@2.117.2', () => ({ createClient: () => ({ rpc: mock.rpc }) }))
vi.mock('../../supabase/functions/_shared/push.ts', () => ({ sendPushToUser: mock.push }))
let handler: (request: Request) => Promise<Response>
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: (h: typeof handler) => { handler = h }, env: { get: () => 'synthetic-test-only' } })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('NETWORK_FORBIDDEN') }))
  await import('../../supabase/functions/process-review-notifications/index.ts')
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => { mock.rpc.mockReset(); mock.push.mockReset() })
const request = (headers: Record<string, string> = {}, method = 'POST') => handler(new Request('https://fixture.invalid', { method, headers }))
it('rejects a direct unauthenticated call before touching the database', async () => {
  expect((await request()).status).toBe(401)
  expect(mock.rpc).not.toHaveBeenCalled()
  expect(mock.push).not.toHaveBeenCalled()
})
it('rejects a user bearer token and a wrong scheduler secret without a claim', async () => {
  expect((await request({ Authorization: 'Bearer user-session' })).status).toBe(401)
  mock.rpc.mockResolvedValueOnce({ data: false, error: null })
  expect((await request({ 'x-home-reviews-scheduler': 'wrong-test-only' })).status).toBe(401)
  expect(mock.rpc.mock.calls.map(c => c[0])).toEqual(['verify_review_scheduler_token'])
  expect(mock.push).not.toHaveBeenCalled()
})
it('returns an empty authenticated drain without any push or provider call', async () => {
  mock.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: null })
  const response = await request({ 'x-home-reviews-scheduler': 'valid-test-only' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ version: 'review-notifications-v1', processed: 0 })
  expect(mock.push).not.toHaveBeenCalled()
})
it('sends only the reserved recipient and review then persists the provider receipt', async () => {
  const n = { id: 'notification', user_id: 'user-a', review_id: 'review-a', title: 'Nouvel avis', body: 'À consulter' }
  mock.rpc.mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: n }).mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: null })
  mock.push.mockResolvedValue({ sent: 1, failed: 0, skipped: false })
  expect((await request({ 'x-home-reviews-scheduler': 'valid-test-only' })).status).toBe(200)
  expect(mock.push).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'user-a', { title: n.title, body: n.body, url: '#/avis/review-a', tag: 'review-review-a' })
  expect(mock.rpc.mock.calls.map(c => c[0])).toEqual(['verify_review_scheduler_token', 'claim_review_notification_delivery', 'finish_review_notification_delivery', 'claim_review_notification_delivery'])
})
it('rejects GET and fails closed on database authentication errors', async () => {
  expect((await request({}, 'GET')).status).toBe(405)
  mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } })
  expect((await request({ 'x-home-reviews-scheduler': 'valid-test-only' })).status).toBe(401)
  expect(mock.push).not.toHaveBeenCalled()
})
