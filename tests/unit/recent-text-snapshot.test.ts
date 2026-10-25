// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {prepareHistoricalSnapshot,type HistoricalJob} from '../../supabase/functions/_shared/historical-report-worker';
it('uses only the atomic frozen source, including frozen translations, and removes redundant raw copies',async()=>{
 const row={id:'10000000-0000-4000-8000-000000000001',rating:3,original_text:'Original',original_language:'en',text:'Original',published_at:'2026-10-01T00:00:00Z',review_translations:[],review_reply_drafts:[]};
 const from=vi.fn(()=>{throw Error('LIVE_READ_FORBIDDEN')});
 const retention={epoch:'epoch',version:'recent_text_100_6m_v1',as_of:'2026-10-25T00:00:00Z',cutoff:'2026-04-25T00:00:00Z',review_count:1,period_start:row.published_at,period_end:row.published_at,review_ids:[row.id],fingerprint:'fingerprint'};
 const run={id:'source',establishment_id:'est',organization_id:'org',language:'vi',created_at:retention.as_of,snapshot:{analysis_version:8,english_translation_override_policy:'verified_english_translation_overrides_v1',retention,retention_frozen_rows:[row],retention_english_overrides:[],retention_establishment:{id:'est',organization_id:'org',name:'Fixture',rating:4,total_reviews:1000,created_at:'2020-01-01'}}} as unknown as HistoricalJob;
 const result=await prepareHistoricalSnapshot({from} as never,run);
 expect(from).not.toHaveBeenCalled();expect(result.snapshot.reviews[0].analysis_text).toBe('Original');expect(result.snapshot.base.period_end).toBe(row.published_at);expect(result.snapshot.retention).toEqual(retention);expect(result.snapshot).not.toHaveProperty('retention_frozen_rows');
});
