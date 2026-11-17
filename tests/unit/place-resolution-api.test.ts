// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ auth: vi.fn(), language: vi.fn(), policy: vi.fn(), rate: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireUser: mock.auth }))
vi.mock('../../supabase/functions/_shared/recent-review-policy.ts', async original => ({
  ...await original<object>(), assertIngestionAllowed: mock.policy,
}))
vi.mock('../../supabase/functions/_shared/sync-service.ts', async original => ({
  ...await original<object>(), preferredLanguageForUser: mock.language,
}))
vi.mock('../../supabase/functions/_shared/rate-limit.ts', () => ({ enforceRateLimit: mock.rate }))

let handler: (request: Request) => Promise<Response>
const khouse = 'ChIJTQBISo9ncDERyPcP3aY9kI4'
const place = { name: 'K.HOUSE', placeId: khouse, googleId: '123', fullAddress: 'Nha Trang', rating: 4.6, totalReviews: 950 }
let pilot: boolean, duplicate: boolean, member: boolean
const http = vi.fn(), rpc = vi.fn(), filters: [string, unknown][] = []
const from = (table: string) => {
  const q = {
    select: () => q, order: () => q, limit: () => q,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
    single: async () => ({ data: table === 'organization_members' && member ? { organization_id: 'org-a' } : null }),
    maybeSingle: async () => ({ data: duplicate ? { id: 'already-added' } : null }),
  }
  return q
}
beforeAll(async () => {
  vi.stubGlobal('Deno', {
    serve: (h: typeof handler) => { handler = h },
    env: { get: (key: string) => key === 'SHARED_RESTAURANTS_ENABLED' ? String(pilot) :
      ({ REVIEW_PROVIDER: 'apify', APIFY_API_TOKEN: 'synthetic-only' }[key]) },
  })
  vi.stubGlobal('fetch', http)
  await import('../../supabase/functions/resolve-establishment/index.ts')
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  pilot = true; duplicate = false; member = true; filters.length = 0
  mock.auth.mockReset().mockResolvedValue({ user: { id: 'user-a' }, admin: { from, rpc } })
  mock.language.mockReset().mockResolvedValue('vi'); mock.policy.mockReset(); mock.rate.mockReset()
  http.mockReset().mockRejectedValue(Error('UNEXPECTED_NETWORK'))
  rpc.mockReset().mockImplementation(async (name, args) => ({
    // The existing SQL allowlist remains the authority; other places miss the cache.
    data: name === 'read_shared_restaurant_resolution' && args.p_place_id === khouse ? place : null, error: null,
  }))
})
const request = (input = 'https://maps.app.goo.gl/test') => handler(new Request('https://fixture.invalid', {
  method: 'POST', body: JSON.stringify({ input }),
}))
const expand = (id = khouse) => http.mockResolvedValueOnce({ ok: true, url: 'https://www.google.com/maps?query_place_id=' + id })
const provider = (id = khouse) => {
  http.mockResolvedValueOnce(Response.json({ data: { id: 'run', defaultDatasetId: 'dataset', status: 'SUCCEEDED' } }))
    .mockResolvedValueOnce(Response.json([{ placeId: id, cid: '123', title: 'K.HOUSE', reviewsCount: 950 }]))
}

it.each(['vi', 'fr'])('reuses the allowed exact identity after expanding the short link (%s), without Apify', async language => {
  mock.language.mockResolvedValue(language); expand()
  const r = await request()
  expect(r.status).toBe(200)
  expect((await r.json()).candidate).toMatchObject(place)
  expect(http).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith('read_shared_restaurant_resolution', { p_place_id: khouse })
  expect(filters).toContainEqual(['organization_id', 'org-a'])
})
it('honors disabled mutualization even when the exact K.HOUSE identity is known', async () => {
  pilot = false; expand(); provider()
  expect((await request()).status).toBe(200)
  expect(rpc).not.toHaveBeenCalled()
  expect(http.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1)
})
it('looks up a non-allowlisted restaurant using one place-only run', async () => {
  expand('ChIJ_OTHER'); provider('ChIJ_OTHER')
  expect((await request()).status).toBe(200)
  expect(http.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1)
  expect(http.mock.calls[1][0]).toContain('compass~crawler-google-places')
  expect(JSON.parse(http.mock.calls[1][1].body).language).toBe('vi')
})
it('keeps duplicate checks scoped to the current organization', async () => {
  duplicate = true; expand()
  expect((await request()).status).toBe(409)
  expect(filters).toContainEqual(['organization_id', 'org-a'])
  expect(filters).toContainEqual(['google_id', '123'])
  expect(http).toHaveBeenCalledTimes(1)
})
it('rejects direct anonymous, nonmember and invalid-link requests before any provider call', async () => {
  mock.auth.mockRejectedValueOnce(Error('UNAUTHORIZED'))
  expect((await request()).status).toBe(401)
  member = false
  expect((await request()).status).toBe(403)
  expect((await request('https://attacker.invalid/maps')).status).toBe(400)
  expect(http).not.toHaveBeenCalled()
})
it('rejects a short link redirected outside Google without an actor call', async () => {
  http.mockResolvedValueOnce({ ok: true, url: 'https://attacker.invalid/maps' })
  expect((await request()).status).toBe(400)
  expect(http).toHaveBeenCalledTimes(1)
  expect(rpc).not.toHaveBeenCalled()
})
