/** Durable single-flight operations. A failed/unknown call is never reclaimed here. */
export interface SharedOperationStore {
  reserve(key: string, owner: string): Promise<{state: 'owner' | 'waiting' | 'completed' | 'blocked'; result?: unknown}>
  complete(key: string, owner: string, result: unknown): Promise<boolean>
  unknown(key: string, owner: string): Promise<void>
}

export class SharedOperationPending extends Error {
  constructor(public readonly state: 'waiting' | 'blocked') { super('SHARED_OPERATION_' + state.toUpperCase()) }
}

export async function sharedOperation<T>(store: SharedOperationStore, key: string, owner: string, call: () => Promise<T>): Promise<T> {
  const reservation = await store.reserve(key, owner)
  if (reservation.state === 'completed') return reservation.result as T
  if (reservation.state !== 'owner') throw new SharedOperationPending(reservation.state)
  try {
    const result = await call()
    if (!await store.complete(key, owner, result)) throw Error('SHARED_OPERATION_COMMIT_LOST')
    return result
  } catch (error) {
    // Network errors and process interruption cannot prove that the provider did not bill.
    await store.unknown(key, owner)
    throw error
  }
}

export async function sharedOperationKey(value: unknown): Promise<string> {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
