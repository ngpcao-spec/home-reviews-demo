import type {AuthContext} from './auth.ts';
import {assertMembership} from './auth.ts';
import {recommendRestaurants, type Request, type SheetRow} from './restaurant-recommendation-engine-v1.ts';

// Internal service interface for a future authenticated caller. No HTTP handler,
// service-role query, RPC, new grant, deployment entry point or HOME AI wiring.
export const RECOMMENDATION_SELECT = 'establishment_id,organization_id,language,report_id,source_run_id,report_generated_at,calculation_version,stale,stale_reason,corpus,metadata,report_sections,calculation_text:calculation::text,publication:current_report_publications!inner(report_id,source_run_id,organization_id,establishment_id,language,scope,stale,stale_reason,generated_at,derived:document->derived_report)';
export async function readRestaurantRecommendations(c: {client: AuthContext['client']; user: Pick<AuthContext['user'],'id'>}, organizationId: string, request: Request) {
  // c must come from requireUser(request), not from caller-supplied IDs/claims.
  await assertMembership(c.client,c.user.id,organizationId,['owner','admin','manager']);
  const profile = await c.client.from('profiles').select('preferred_language').eq('user_id',c.user.id).single();
  if (profile.error || !['fr','vi'].includes(profile.data?.preferred_language)) throw Error('PREFERRED_LANGUAGE_REQUIRED');
  const language = profile.data.preferred_language;
  const rows: SheetRow[] = [], pageSize = 200;
  for (let offset=0;;offset+=pageSize) {
    // The joined publication and sheet are read in ONE SELECT, under both RLS policies.
    // Casting JSON to text prevents JS from rounding PostgreSQL numeric fractions.
    const {data,error} = await c.client.from('restaurant_recommendation_sheets').select(RECOMMENDATION_SELECT)
      .eq('organization_id',organizationId).eq('language',language).order('establishment_id').range(offset,offset+pageSize-1);
    if (error || !data) throw Error('RECOMMENDATION_READ_FAILED');
    rows.push(...data as unknown as SheetRow[]);
    if (data.length < pageSize) break;
  }
  const result = recommendRestaurants(rows,organizationId,language,request);
  const present = new Set(rows.map(r => r.establishment_id));
  for (let offset=0;;offset+=pageSize) {
    const {data,error} = await c.client.from('establishments').select('id,name,organization_id').eq('organization_id',organizationId).eq('active',true)
      .order('id').range(offset,offset+pageSize-1);
    if (error || !data) throw Error('RECOMMENDATION_ESTABLISHMENT_READ_FAILED');
    for (const e of data) if (e.organization_id === organizationId && !present.has(e.id)) result.excluded.push({establishment_id:e.id,name:e.name,report_id:'',reasons:['NO_REPORT_SHEET_IN_ACCOUNT_LANGUAGE']});
    if (data.length < pageSize) break;
  }
  result.excluded.sort((a,b) => a.establishment_id < b.establishment_id ? -1 : a.establishment_id > b.establishment_id ? 1 : 0);
  return result;
}
