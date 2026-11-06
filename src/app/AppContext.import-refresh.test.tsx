import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, useApp } from './AppContext'

const { tables, from } = vi.hoisted(() => ({ tables: [] as string[], from: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from,
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel() {},
  },
}))

describe('independent initial import refresh', () => {
  afterEach(cleanup)
  it('receives a terminal status even when every dashboard request fails', async () => {
    const job = { id: 'job', user_id: 'user', organization_id: 'org', query: 'link', expected_google_id: 'place',
      status: 'failed', reviews_target: 150, reviews_fetched: 150, reviews_inserted: 0,
      error_code: 'ESTABLISHMENT_MISMATCH', candidate_snapshot: {}, created_at: '', updated_at: '' }
    from.mockImplementation((table: string) => {
      tables.push(table)
      const result = table === 'initial_import_jobs' ? { data: [job], error: null } : { data: null, error: { message: 'unavailable' } }
      const builder: Record<string, unknown> = {}
      const proxy = new Proxy(builder, { get: (_, key) => key === 'then'
        ? (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
        : () => proxy })
      return proxy
    })
    const { result } = renderHook(() => useApp(), { wrapper: AppProvider })
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true))
    // Allow the initial dashboard load to fail first.
    await act(async () => { await result.current.retryData() })
    tables.length = 0
    await act(async () => { await result.current.refreshInitialImports() })
    expect(tables).toEqual(['initial_import_jobs'])
    expect(result.current.initialImportJobs[0]).toMatchObject({ status: 'failed', reviewsFetched: 150, reviewsInserted: 0, errorCode: 'ESTABLISHMENT_MISMATCH' })
  })
})
