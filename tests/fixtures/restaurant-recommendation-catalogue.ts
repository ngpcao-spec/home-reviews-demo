import type {SheetRow, Category} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
export function recommendationSheet(id: string, options: {score?: string; latitude?: number; longitude?: number; level?: number; stale?: boolean; cuisines?: string[]; positive?: string; reservation?: string; category?: Category} = {}): SheetRow {
  const org = 'org-a', report = 'report-' + id, value = options.score ?? '5', category = options.category ?? 'quality';
  const fraction = (v: string) => {const parts=v.split('.'),d=10**(parts[1]?.length ?? 0);return {score:v,score_numerator:BigInt(v.replace('.','')).toString(),score_denominator:String(d)};};
  const s = fraction(value);
  const positives = [{category,text:options.positive ?? 'The dishes are well prepared.',evidence_ids:['a'.repeat(64)]}];
  const reservations = options.reservation ? [{category,text:options.reservation,evidence_ids:['b'.repeat(64)]}] : [];
  return {establishment_id:id,organization_id:org,language:'vi',report_id:report,source_run_id:'source-'+id,report_generated_at:'2026-10-28T00:00:00Z',calculation_version:'internal-recommendation-v2',
    stale:options.stale ?? false,stale_reason:null,corpus:{fingerprint:'fingerprint-'+id,total_reviews:150},
    calculation_text:JSON.stringify({version:'internal-recommendation-v2',comparable:true,status:'ready',total_reviews:150,positive_weight:1,negative_weight:-4,
      categories:Object.fromEntries(['quality','service','ambiance'].map(c => [c,s])),global_score:s.score,global_score_numerator:s.score_numerator,global_score_denominator:s.score_denominator}),
    metadata:{identity:{establishment_id:id,organization_id:org,name:'Fixture '+id},google_metadata:{coordinates:{latitude:options.latitude ?? 12,longitude:options.longitude ?? 109},cuisine_types:options.cuisines ?? [],source:'google_maps_import'},
      budget:{establishment_price:{source:'google_maps_import',status:options.level === undefined?'not_provided':'provided',price_level:options.level ?? null,observed_at:'2026-10-28T00:00:00Z'},customer_spend_per_person:{source:'frozen_report_review_context',ranges:[]}}},
    report_sections:{report_id:report,positive_aspects:positives,reservations},
    publication:{establishment_id:id,organization_id:org,language:'vi',report_id:report,source_run_id:'source-'+id,generated_at:'2026-10-28T00:00:00Z',stale:options.stale ?? false,
      scope:{fingerprint:'fingerprint-'+id,review_count:150},derived:{format_version:'jls-direct-categories4-report-v1',statistics_sha256:'c'.repeat(64),report:{positive_aspects:positives,negative_aspects:reservations}}}};
}
