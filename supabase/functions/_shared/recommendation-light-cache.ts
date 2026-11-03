import type {AuthContext} from './auth.ts';
import type {LightSheetCacheEntry,LightSheetCachePort} from './recommendation-light.ts';

/** Called only after the API has authenticated and read the authorized catalogue.
 * Caller RLS scopes reads; only the existing server admin can write derived data. */
export function recommendationLightCache(context:{client:AuthContext['client'];admin?:AuthContext['admin']},organization:string):LightSheetCachePort{
 return {
  load:async(org,language)=>{
   if(org!==organization)throw Error('LIGHT_CACHE_SCOPE_MISMATCH');
   const {data,error}=await context.client.from('recommendation_light_sheet_cache')
    .select('organization_id,establishment_id,language,format_version,source_sha256,sheet').eq('organization_id',organization).eq('language',language);
   if(error)throw Error('LIGHT_CACHE_READ_FAILED');return (data??[]) as LightSheetCacheEntry[];
  },
  save:async entries=>{
   if(!context.admin||entries.some(e=>e.organization_id!==organization))throw Error('LIGHT_CACHE_SCOPE_MISMATCH');
   const {error}=await context.admin.from('recommendation_light_sheet_cache').upsert(entries,{onConflict:'organization_id,language,establishment_id,format_version'});
   if(error)throw Error('LIGHT_CACHE_SAVE_FAILED');
  },
 };
}
