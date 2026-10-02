import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), assertMembership: vi.fn() }))
vi.mock('../_shared/auth.ts', () => mocks)
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

async function setup(mode: 'running' | 'locked' | 'expired' | 'completed' | 'failed' | 'none' | 'foreign' | 'unauthorized' | 'forbidden' = 'running') {
  const reads: { table: string; filters: Record<string, unknown> }[] = []
  class Query {
    filters: Record<string, unknown> = {}
    constructor(private table: string) {}
    select() { return this }
    order() { return this } limit() { return this }
    eq(key: string, value: unknown) { this.filters[key] = value; return this }
    async single() {
      reads.push({ table: this.table, filters: this.filters })
      return { error: null, data: this.table === 'establishments' ? mode === 'foreign' ? null : { id: 'est', organization_id: 'org' }
        : this.table === 'profiles' ? { preferred_language: 'vi' }
        : mode === 'none' ? null : { establishment_id: 'est', language: 'vi', generation_id: 'existing-id',
          status: ['completed', 'failed'].includes(mode) ? mode : 'running', cursor: 3, error_code: mode === 'failed' ? 'REPORT_FAILED' : null,
          locked_by: 'private-worker', lease_until: mode === 'locked' ? new Date(Date.now() + 60_000).toISOString() : mode === 'expired' ? new Date(0).toISOString() : null,
          snapshot: { reviews: Array.from({length: 80}, (_, i) => ({id: String(i),rating:5, original_text:'Private review text'})) } } }
    }
    maybeSingle() { return this.single() }
  }
  const database = { from: (table: string) => new Query(table) }
  mocks.requireUser.mockImplementation(async () => { if (mode === 'unauthorized') throw new Error('UNAUTHORIZED'); return { client: database, admin: database, user: {id:'user'} } })
  mocks.assertMembership.mockImplementation(async () => { if (mode === 'forbidden') throw new Error('FORBIDDEN') })
  let handler!: (request: Request) => Promise<Response>
  vi.stubGlobal('Deno', { serve: (fn: typeof handler) => { handler = fn } })
  vi.resetModules(); await import('./index.ts')
  return { reads, call: (language = 'vi') => handler(new Request('https://example.test', {method:'POST',body:JSON.stringify({establishment_id:'est',preferred_language:language})})) }
}
describe('read-only historical run status', () => {
  it('returns a bounded projection, scoped to organization and profile language, without snapshot or writes', async () => {
    const h = await setup()
    const response = await h.call()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.run).toEqual({establishment_id:'est',preferred_language:'vi',generation_id:'existing-id',status:'running',progress:3,total_steps:5,resumable:false,error_code:null})
    expect(JSON.stringify(body)).not.toContain('Private review text')
    expect(h.reads.at(-1)).toEqual({table:'historical_report_runs',filters:{organization_id:'org',establishment_id:'est',language:'vi'}})
    expect(mocks.assertMembership).toHaveBeenCalledWith(expect.anything(),'user','org',['owner','admin','manager'])
  })
  it.each([['locked',false],['expired',false],['completed',false],['failed',false]] as const)('reports %s without starting any step', async (mode, resumable) => {
    const h = await setup(mode)
    expect((await (await h.call()).json()).run.resumable).toBe(resumable)
  })
  it.each([['foreign',404],['unauthorized',401],['forbidden',403]] as const)('rejects %s before privileged run read', async (mode, status) => {
    const h = await setup(mode)
    expect((await h.call()).status).toBe(status)
    expect(h.reads.some(r => r.table === 'historical_report_runs')).toBe(false)
  })
  it('rejects stale frontend language instead of exposing or resuming the other language', async () => {
    const h = await setup()
    expect((await h.call('fr')).status).toBe(409)
    expect(h.reads.some(r => r.table === 'historical_report_runs')).toBe(false)
  })
  it('returns null if no run exists', async () => {
    expect(await (await (await setup('none')).call()).json()).toEqual({run:null})
  })
})
