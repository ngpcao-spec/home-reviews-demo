import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareHistoricalDirect4,verifyHistoricalDirect4,FROZEN_CORPUS_DIRECT4,historicalDirect4Contract} from '../../supabase/functions/_shared/jls-direct4-historical';
import {rehearseHistoricalDirect4} from '../../supabase/functions/_shared/jls-direct4-historical-probe';
import {historicalSnapshotFingerprint,type FrozenHistorical} from '../../supabase/functions/_shared/jls-snapshot-v2';
import {directHash,directCanonical} from '../../supabase/functions/_shared/jev-direct-categories';
import {DIRECT_SYNTHESIS_VERSION} from '../../supabase/functions/_shared/jev-direct-report-preparation';
const code='a'.repeat(40);
async function fixture(texts=3,empty=1){
 const h={id:'10000000-0000-4000-8000-000000000001',generation_id:'10000000-0000-4000-8000-000000000002',
  organization_id:'10000000-0000-4000-8000-000000000003',establishment_id:'10000000-0000-4000-8000-000000000004',
  requested_by:'10000000-0000-4000-8000-000000000005',created_at:'2026-10-20T00:00:00Z',status:'completed',language:'vi',
  snapshot:{analysis_version:7,base:{google_total_reviews:120,google_rating:4.5},publication:{},reviews:Array.from({length:texts+empty},(_,n)=>{
   const samples=['The soup tasted fresh and pleasantly spicy.','A waiter brought us the missing spoon promptly.',
    'The bill listed an unexpected service charge.','The room was quiet with comfortable seats.',
    'Coffee arrived cold after a very long wait.','Portions were generous and the fish was tender.',
    'The manager explained the menu clearly.','Our outdoor table had a lovely garden view.',
    'Dinner cost more than similar meals elsewhere.','We enjoyed the dessert but the music was loud.'];
   const text=n<texts?samples[n%samples.length]+' '+n:'';
   return {id:'20000000-0000-4000-8000-'+String(n).padStart(12,'0'),rating:n%5+1,original_text:text,analysis_text:text,
    original_language:'en',analysis_language:text?'en':null,analysis_source:'original_en',published_at:null,review_context:null,review_detailed_rating:null};
  })}} as FrozenHistorical;
 h.snapshot.base.source_fingerprint=await historicalSnapshotFingerprint(h.snapshot);
 const published_report={id:'report',generation_id:h.generation_id,organization_id:h.organization_id,establishment_id:h.establishment_id,negative_rate:18};
 return {historical:h,published_report,published_report_canonical:directCanonical(published_report).replace('"negative_rate":18','"negative_rate":18.0'),
  record_sha256:await directHash(h),existing_direct_cache_rows:0,existing_direct4_protocols:0};
}
it('binds every identity, count, text, source and configuration to the protocol, without restaurant constants',async()=>{
 const p=await prepareHistoricalDirect4(await fixture(),code,FROZEN_CORPUS_DIRECT4);
 await expect(verifyHistoricalDirect4(p.body,p.sha256)).resolves.toBeUndefined();
 expect(p.body.denominators).toEqual({source_reviews:4,analytical_reviews:3,textless_statistics_only:1});
 expect(p.body.max_jev_calls).toBe(3);expect(p.body.max_luna_calls).toBe(32);expect(p.body.configuration.synthesis_version).toBe(DIRECT_SYNTHESIS_VERSION);
 expect(p.body.classification_configuration_sha256).toBe('e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69');
 expect(p.body.spending_authorization).toBeNull();expect(p.body.run_id).toBeNull();
});
it.each(['establishment','organization','review','text','rating','count','duplicates','jev_limit','luna_limit','sol_limit','config','original','canonical','source','synthesis'])('rejects %s tampering even when the outer hash is recomputed',async kind=>{
 const p=await prepareHistoricalDirect4(await fixture(),code,FROZEN_CORPUS_DIRECT4),b=structuredClone(p.body);
 switch(kind){
 case 'establishment':b.establishment_id='wrong';break;case 'organization':b.organization_id='wrong';break;
 case 'review':b.source_snapshot.reviews[0].id='wrong';break;case 'text':b.source_snapshot.reviews[0].analysis_text='changed';break;
 case 'rating':b.source_snapshot.reviews[0].rating=5;break;case 'count':b.denominators.analytical_reviews=2;break;
 case 'duplicates':b.pending[1]=b.pending[0];b.pending_sha256=await directHash(b.pending);break;
 case 'jev_limit':b.max_jev_calls++;break;case 'luna_limit':b.max_luna_calls++;break;case 'sol_limit':b.max_sol_calls++;break;
 case 'config':b.configuration.jev={...b.configuration.jev,id:'different'} as never;break;
 case 'original':b.source_snapshot.reviews[0].original_text='changed';break;
 case 'canonical':b.published_report_canonical='{}';break;case 'source':b.historical.record_sha256='0'.repeat(64);break;
 case 'synthesis':b.configuration.synthesis_version='different' as never;break;
 }
 await expect(verifyHistoricalDirect4(b,await directHash(b))).rejects.toThrow();
});
it('supports another corpus size and completes the existing JEV/Luna/Sol receipt path with explicit mocks only',async()=>{
 const network=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');});
 try{
  const p=await prepareHistoricalDirect4(await fixture(10,2),code,FROZEN_CORPUS_DIRECT4);
  const replay=await rehearseHistoricalDirect4({...p,id:'EXPLICIT_MOCK_PROTOCOL'});
  expect(replay.qualification.simulated_jev).toBe(10);expect(replay.qualification.simulated_sol).toBe(1);
  expect(replay.qualification.provider_calls).toBe(0);expect(replay.qualification.report_saved).toBe(true);
  expect(replay.qualification.zero_retries).toBe(true);expect(network).not.toHaveBeenCalled();
 }finally{network.mockRestore();}
},30000);
it('does not relax old protocols or allow the new experiment into current-report default reads',async()=>{
 await expect(prepareHistoricalDirect4(await fixture(),code)).rejects.toThrow('DIRECT4_HISTORICAL_SOURCE_CHANGED');
 const sql=readFileSync('supabase/migrations/20261019234453_direct4_protocol_corpus.sql','utf8');
 expect(sql).toContain('public.check_jls_direct4_frozen_sources(body)');expect(sql).toContain('request_count=1');
 expect(sql).toContain('from public,anon,authenticated');expect(sql).toContain('max_jev_calls');
 expect(sql).not.toMatch(/create table|insert into public.analysis_jls_restaurant_runs|select public.authorize_/i);
 const reader=readFileSync('supabase/functions/jls-restaurant/index.ts','utf8');
 expect(reader).toContain(".neq('body->>version','jls-direct4-frozen-corpus-v1')");
 expect(historicalDirect4Contract().frozenAnalysisSource).toBe(true);
});
