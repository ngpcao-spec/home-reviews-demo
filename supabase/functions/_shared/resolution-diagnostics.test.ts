import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResolutionDiagnostics, safeResolutionError } from './resolution-diagnostics'

afterEach(() => vi.restoreAllMocks())
describe('safe resolution diagnostics', () => {
  it.each(['APIFY_RUN_FAILED', 'APIFY_HTTP_503', 'APIFY_DATASET_HTTP_502', 'GOOGLE_MAPS_LINK_RESOLUTION_FAILED'])('retains precise known code %s', code => {
    expect(safeResolutionError(new Error(code))).toBe(code)
  })
  it('discards arbitrary messages, payloads and secrets', () => {
    for (const error of [new Error('token=SECRET https://maps.google.com?q=PERSON'), {code:'SECRET', message:'PERSON'}, new Error('APIFY_RUN_SECRET')]) {
      expect(safeResolutionError(error)).toBe('INTERNAL_ERROR')
    }
  })
  it('correlates stages and errors without logging the error object', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const diagnostic = createResolutionDiagnostics()
    diagnostic.step('run_wait')
    diagnostic.failed(Object.assign(new Error('APIFY_RUN_FAILED'), { token: 'SECRET', payload: 'PERSON' }))
    const entries = log.mock.calls.map(([line]) => JSON.parse(line))
    expect(entries[1]).toMatchObject({stage:'run_wait',error_code:'APIFY_RUN_FAILED',diagnostic_id:entries[0].diagnostic_id})
    expect(Object.keys(entries[1]).sort()).toEqual(['diagnostic_id','elapsed_ms','error_code','event','stage'])
    expect(JSON.stringify(entries)).not.toMatch(/SECRET|PERSON|stack|payload/)
  })
})
