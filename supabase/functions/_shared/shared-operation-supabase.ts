import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'
import { sharedOperation, sharedOperationKey, SharedOperationPending, type SharedOperationStore } from './shared-operation.ts'

export function sharedOperationStore(admin: SupabaseClient, restaurant: string): SharedOperationStore {
  return {
    async reserve(key, owner) {
      const {data,error} = await admin.rpc('reserve_scoped_shared_operation', {p_key:key,p_owner:owner,p_restaurant:restaurant})
      if (error) throw error
      return data
    },
    async complete(key, owner, result) {
      const {data,error} = await admin.rpc('finish_shared_operation', {p_key:key,p_owner:owner,p_result:result,p_unknown:false})
      if (error) throw error
      return data === true
    },
    async unknown(key, owner) {
      const {error} = await admin.rpc('finish_shared_operation', {p_key:key,p_owner:owner,p_result:null,p_unknown:true})
      if (error) throw error
    },
  }
}

/** Both switches are required. Off means the existing application path is unchanged. */
export async function sharedRestaurant(admin: SupabaseClient, establishment: string): Promise<string | null> {
  if (!sharedRuntimeRequested()) return null
  const {data,error} = await admin.rpc('shared_restaurant_for_establishment', {p_establishment:establishment})
  if (error) throw error
  return data
}

export const sharedRuntimeRequested = () => typeof Deno!=='undefined' && Deno.env.get('SHARED_RESTAURANTS_ENABLED') === 'true'

export async function sharedRpc<T>(admin: SupabaseClient, name: string, args: Record<string,unknown>): Promise<T> {
  const {data,error} = await admin.rpc(name,args)
  if (error) throw error
  return data as T
}

export class SharedAnalysisWaiting extends Error {
  key: string
  constructor(key:string) {super('SHARED_ANALYSIS_WAITING');this.key=key}
}
export async function sharedReviewAnalysis<T>(admin: SupabaseClient, input: {
  establishment: string; content: unknown; language: string; model: string; configuration: string; expectedKey?:string
}, call: () => Promise<T>): Promise<T> {
  const restaurant = await sharedRestaurant(admin, input.establishment)
  if (!restaurant) {
    if(input.expectedKey)throw Error('SHARED_CACHED_ANALYSIS_UNAVAILABLE')
    return call()
  }
  const key = await sharedOperationKey({kind:'review-analysis',restaurant,content:input.content,
    language:input.language,model:input.model,configuration:input.configuration})
  if(input.expectedKey && input.expectedKey!==key)throw Error('SHARED_CACHED_ANALYSIS_CHANGED')
  let called=false
  try {
    const result=await sharedOperation(sharedOperationStore(admin,restaurant),key,crypto.randomUUID(),async()=>{
      if(input.expectedKey)throw Error('SHARED_CACHED_ANALYSIS_UNAVAILABLE')
      called=true;return call()
    })
    return called ? result : {...result,usage:undefined,shared_reused:true}
  }catch(error){
    if(error instanceof SharedOperationPending && error.state==='waiting')throw new SharedAnalysisWaiting(key)
    throw error
  }
}
