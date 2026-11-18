// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apifyActorInput, apifyPlaceInput, fetchApifyPlace } from '../../supabase/functions/_shared/apify'
import { resolveEstablishmentCandidate } from '../../supabase/functions/_shared/sync-service'
import { placeIdFromMapsLink } from '../../supabase/functions/_shared/shared-initial-import'
import Ajv from 'ajv'
import contract from '../fixtures/apify-place-contract-20261118.json'

const placeId = 'ChIJTQBISo9ncDERyPcP3aY9kI4'
const url = 'https://www.google.com/maps?query_place_id=' + placeId
const item = { placeId, cid: '10272775617500184520', title: 'K.HOUSE', address: 'Nha Trang',
  totalScore: 4.6, reviewsCount: 950, url, imageUrl: 'https://example.invalid/cover.jpg' }
const run = (status = 'SUCCEEDED') => Response.json({ data: { id: 'test-run', defaultDatasetId: 'test-dataset', status } })
let http: ReturnType<typeof vi.fn>
beforeEach(() => {
  http = vi.fn(async () => { throw Error('UNEXPECTED_NETWORK') })
  vi.stubGlobal('fetch', http)
  vi.stubGlobal('Deno', { env: { get: (key: string) => ({ REVIEW_PROVIDER: 'apify', APIFY_API_TOKEN: 'synthetic-only' }[key]) } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it.each(['fr', 'vi'] as const)('requests only one place in %s, with no reviews, details or extra images', async language => {
  http.mockResolvedValueOnce(run()).mockResolvedValueOnce(Response.json([item]))
  const result = await fetchApifyPlace('synthetic-only', { placeUrl: url, language })
  expect(http.mock.calls[0][0]).toBe('https://api.apify.com/v2/acts/compass~crawler-google-places/runs?maxTotalChargeUsd=0.5')
  expect(JSON.parse(http.mock.calls[0][1].body)).toEqual({
    startUrls: [{ url }], language, maxCrawledPlacesPerSearch: 1, maxReviews: 0, maxImages: 0, scrapePlaceDetailPage: false,
  })
  expect(result.establishment).toMatchObject({ name: 'K.HOUSE', placeId, googleId: item.cid, rating: 4.6, totalReviews: 950, photo: item.imageUrl })
  expect(result).not.toHaveProperty('reviews')
  expect(http.mock.calls[1][0]).toContain('/datasets/test-dataset/items?')
})

it('wires the actual resolution service to the place actor, not the review actor', async () => {
  http.mockResolvedValueOnce(run()).mockResolvedValueOnce(Response.json([item]))
  await resolveEstablishmentCandidate(url, 'vi')
  expect(http.mock.calls[0][0]).toContain('/acts/compass~crawler-google-places/runs')
})

it.each(['fr', 'vi'] as const)('reproduces the rejected old ceiling and accepts the real provider contract in %s', async language => {
  const validate = new Ajv().compile(contract.inputSchema)
  const providerStart = (endpoint: string, body: unknown) => {
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true)
    const ceiling = Number(new URL(endpoint).searchParams.get('maxTotalChargeUsd'))
    return ceiling < contract.pricing.minimalMaxTotalChargeUsd
      ? Response.json({ error: { type: 'max-total-charge-usd-below-minimum' } }, { status: 400 })
      : run()
  }
  // The former value deterministically violates the saved public pricing metadata.
  expect(providerStart('https://api.apify.com/v2/acts/test/runs?maxTotalChargeUsd=0.1',
    apifyPlaceInput(url, language)).status).toBe(400)
  http.mockImplementationOnce(async (endpoint: string, init: RequestInit) =>
    providerStart(endpoint, JSON.parse(String(init.body))))
    .mockResolvedValueOnce(Response.json([item]))
  expect((await fetchApifyPlace('synthetic-only', { placeUrl: url, language })).establishment.placeId).toBe(placeId)
  expect(http.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1)
  expect(Number(new URL(http.mock.calls[0][0]).searchParams.get('maxTotalChargeUsd')))
    .toBe(contract.pricing.minimalMaxTotalChargeUsd)
})

it('expands a short link once and preserves the exact large CID from the iOS ftid', async () => {
  const expanded = 'https://www.google.com/maps?ftid=0x317067a3002ce2c1:0x49158083af30d8d5'
  http.mockResolvedValueOnce({ ok: true, url: expanded }).mockResolvedValueOnce(run()).mockResolvedValueOnce(Response.json([item]))
  await fetchApifyPlace('synthetic-only', { placeUrl: 'https://maps.app.goo.gl/example', language: 'fr' })
  expect(JSON.parse(http.mock.calls[1][1].body).startUrls).toEqual([{ url: 'https://www.google.com/maps?cid=5266256642347948245' }])
  expect(http).toHaveBeenCalledTimes(3)
})

it.each([[], [{ error: 'not found' }], [{ title: 'No identity' }], [item, item]].map(items => [items]))('rejects empty/error/ambiguous datasets without falling back to a second paid run: %j', async items => {
  http.mockResolvedValueOnce(run()).mockResolvedValueOnce(Response.json(items))
  await expect(fetchApifyPlace('synthetic-only', { placeUrl: url, language: 'vi' })).rejects.toThrow()
  expect(http.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1)
})

it.each([401, 402, 429, 503])('does not retry a failed start (%s)', async status => {
  http.mockResolvedValueOnce(new Response('', { status }))
  await expect(fetchApifyPlace('synthetic-only', { placeUrl: url, language: 'fr' })).rejects.toThrow()
  expect(http).toHaveBeenCalledTimes(1)
})

it('does not retry when the start response is lost', async () => {
  http.mockRejectedValueOnce(new DOMException('lost', 'AbortError'))
  await expect(fetchApifyPlace('synthetic-only', { placeUrl: url, language: 'fr' })).rejects.toThrow('APIFY_TIMEOUT')
  expect(http).toHaveBeenCalledTimes(1)
})

it('polls the same running actor and never starts another one', async () => {
  vi.useFakeTimers()
  http.mockResolvedValueOnce(run('RUNNING')).mockResolvedValueOnce(run()).mockResolvedValueOnce(Response.json([item]))
  const result = fetchApifyPlace('synthetic-only', { placeUrl: url, language: 'vi' })
  await vi.advanceTimersByTimeAsync(2_000)
  await result
  expect(http.mock.calls[1][0]).toBe('https://api.apify.com/v2/actor-runs/test-run')
  expect(http.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1)
})

it('accepts an establishment with no reviews and leaves the initial review input unchanged', async () => {
  http.mockResolvedValueOnce(run()).mockResolvedValueOnce(Response.json([{ ...item, reviewsCount: 0 }]))
  expect((await fetchApifyPlace('synthetic-only', { placeUrl: url, language: 'fr' })).establishment.totalReviews).toBe(0)
  expect(apifyActorInput({ placeUrl: url, language: 'vi', sort: 'newest', limit: 150 })).toMatchObject({
    maxReviews: 150, reviewsOrigin: 'google', reviewsSort: 'newest', personalData: true,
  })
  expect(() => apifyPlaceInput('https://attacker.invalid/maps', 'fr')).toThrow()
})

it('recognizes exact IDs in expanded Google URLs, never a restaurant name or CID as Place ID', () => {
  expect(placeIdFromMapsLink(url)).toBe(placeId)
  expect(placeIdFromMapsLink('https://www.google.com/maps/place/K.HOUSE/data=!4m2!1s' + placeId + '!8m2')).toBe(placeId)
  expect(placeIdFromMapsLink('https://www.google.com/maps/place/K.HOUSE/data=!19s' + placeId)).toBe(placeId)
  expect(placeIdFromMapsLink('https://www.google.com/maps?q=K.HOUSE')).toBeNull()
  expect(placeIdFromMapsLink('https://www.google.com/maps?cid=123')).toBeNull()
})
