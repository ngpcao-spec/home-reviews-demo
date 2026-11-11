import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import type {InitializationFetchResult} from './sync-service.ts'
import {sharedRpc,sharedRuntimeRequested} from './shared-operation-supabase.ts'

export const SHARED_INITIAL_CONFIGURATION='initial-latest-150-v1'
export async function sharedInitialReservation(admin:SupabaseClient,job:{id:string;request_kind?:string}) {
  if (!sharedRuntimeRequested() || job.request_kind==='reload') return {state:'legacy' as const}
  return sharedRpc<{state:'owner'|'waiting'|'blocked'|'completed'|'legacy';result?:InitializationFetchResult}>(admin,
    'reserve_shared_initial_import',{p_job:job.id,p_configuration:SHARED_INITIAL_CONFIGURATION})
}
export async function saveSharedInitialResult(admin:SupabaseClient,job:{id:string;request_kind?:string},result:InitializationFetchResult) {
  if (!sharedRuntimeRequested() || job.request_kind==='reload') return
  await sharedRpc(admin,'complete_shared_initial_import',{p_job:job.id,p_configuration:SHARED_INITIAL_CONFIGURATION,p_result:result})
}

/** An exact identifier only. A name in the link is never an identity. */
export function placeIdFromMapsLink(link:string):string|null {
  const url=new URL(link)
  const value=url.searchParams.get('query_place_id') ?? url.searchParams.get('q')?.replace(/^place_id:/,'')
  return value && /^ChIJ[\w-]+$/.test(value) ? value : null
}
