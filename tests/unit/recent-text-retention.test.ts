// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,describe} from 'vitest';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {analysisTextForReview} from '../../supabase/functions/_shared/analysis-text';
import {prepareNativeLanguage} from '../fixtures/prepare-native-language';
import {prepareIncrementalResult} from '../../supabase/functions/_shared/incremental-review-sync';
import {reviewIngestionBundle} from '../../supabase/functions/_shared/sync-service';
const fixture=JSON.parse(readFileSync('tests/fixtures/retention-production-definitions.json','utf8'));
let db:PGlite;
const org='10000000-0000-4000-8000-000000000001',est='20000000-0000-4000-8000-000000000001',user='30000000-0000-4000-8000-000000000001';
beforeAll(async()=>{
 db=new PGlite({extensions:{pgcrypto}});await db.waitReady;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create schema private;create schema extensions;create extension pgcrypto with schema extensions;create schema cron;create table cron.job(jobid bigint,jobname text,active boolean);create function cron.alter_job(bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;`);
 await db.exec("set search_path=public,extensions;set timezone='UTC'");
 const tables=new Map<string,typeof fixture.columns>();
 for(const c of fixture.columns){const key=c.schema+'.'+c.table;if(!tables.has(key))tables.set(key,[]);tables.get(key)!.push(c);}
 for(const [key,cols] of tables)await db.exec('create table '+key+'('+cols.map((c:{column:string,type:string,default:string|null})=>'"'+c.column+'" '+c.type+(c.default?' default '+c.default:'')).join(',')+')');
 for(const c of fixture.constraints){const key=c.table.includes('.')?c.table:'public.'+c.table;if(tables.has(key)&&/^(PRIMARY KEY|UNIQUE)/.test(c.definition))await db.exec('alter table '+key+' add constraint "'+c.name+'" '+c.definition);}
 // Parent identities remain outside the purge scope in production.
 await db.exec('create table if not exists public.organizations(id uuid primary key);grant usage on schema private,extensions to service_role;grant all on all tables in schema public,private to service_role;grant select on public.organization_members to authenticated;');
 for(const f of fixture.functions.filter((f:{proname:string})=>['enqueue_current_report','jev_batch_claim','jev_batch_claim_sol'].includes(f.proname)))await db.exec(f.definition);
 const guards=JSON.parse(readFileSync('tests/fixtures/retention-delete-guards.json','utf8'));
 for(const f of new Map(guards.map((g:{schema:string;proname:string;definition:string})=>[g.schema+'.'+g.proname,g.definition])).values())await db.exec(f as string);
 for(const t of guards)await db.exec(t.trigger_definition);
 await db.exec("create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values(999,$1,true);return 999;end $$");
 for(const suffix of ['_recent_text_retention_transition.sql','_recent_text_retention_policy.sql','_recent_text_retention_safety.sql','_recent_text_source_guard.sql','_recent_text_rebuild_barrier.sql','_recent_text_ingestion_dedup.sql','_recent_text_native_usage.sql','_recent_text_superseded_cleanup.sql'])await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith(suffix)),'utf8'));
 for(const [file,name] of [['20261010080134_jev_economy_preparation.sql','jev_economy_canonical'],['20261014160258_jls_restaurant_delegated_preparation.sql','jls_restaurant_hash']]){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');await db.exec(sql.slice(sql.indexOf('create function public.'+name),sql.indexOf('$$;',sql.indexOf('create function public.'+name))+3));
 }
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_recover_compact_saved_references.sql')),'utf8'));
 const finishSql=readFileSync('supabase/migrations/20261024080230_current_jev_batch_transport.sql','utf8'),finishStart=finishSql.indexOf('create or replace function public.jev_batch_finish(');
 await db.exec(finishSql.slice(finishStart,finishSql.indexOf('$$;',finishStart)+3));
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_current_report_publications.sql')),'utf8'));
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_finalize_report_publication_safety.sql')),'utf8'));
 await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_report_metadata_staleness.sql')),'utf8'));
 await db.exec(`update public.review_corpus_policy set enabled=true,paused=false,ingestions_paused=false;insert into public.organizations values('${org}');insert into public.establishments(id,organization_id,name,google_id,google_maps_url) values('${est}','${org}','Fixture','fixture','fixture');insert into public.organization_members(organization_id,user_id,role) values('${org}','${user}','owner');insert into public.report_pipeline_settings(id,engine,jev_transport) values(true,'jev_sol_v2','batch_initial_v1') on conflict(id) do update set engine=excluded.engine,jev_transport=excluded.jev_transport;`);
},60000);
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));afterAll(()=>db.close());
const insert=(id:string,date:string,text='Text',rating=5)=>db.query(`insert into public.reviews(organization_id,establishment_id,external_review_id,author_name,rating,text,original_text,published_at) values($1,$2,$3,'Fixture',$4,$5,$5,$6) returning id`,[org,est,id,rating,text,date]);
it('uses six calendar months including month ends, never 180 days',async()=>{expect((await db.query("select public.recent_review_cutoff('2026-08-31 15:00+07')::text v")).rows).toEqual([{v:'2026-02-28 08:00:00+00'}]);});
it('keeps exactly the newest 100, independently of stars, with stable equal-date ties',async()=>{
 const date=new Date(Date.now()-86400000).toISOString();for(let i=104;i>=0;i--)await insert('r'+String(i).padStart(3,'0'),date,'Text',i%5+1);
 const rows=(await db.query('select external_review_id,rating from public.reviews order by external_review_id')).rows;
 expect(rows).toHaveLength(100);expect(rows.at(-1)?.external_review_id).toBe('r099');expect(new Set(rows.map(r=>r.rating)).size).toBe(5);
});
it('deduplicates observations and aggregates textless reviews without retaining them',async()=>{
 await insert('no-text',new Date().toISOString(),'   ',1);await insert('no-text',new Date().toISOString(),'   ',1);
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);
 expect((await db.query('select observed_textless_reviews::int n from public.review_observation_totals')).rows[0].n).toBe(1);
});
it('never admits undated, future or old reviews and never launders publication with reimport',async()=>{
 await insert('old','2020-01-01');await insert('old',new Date().toISOString());await insert('future','2099-01-01');
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);
});
it('expires without a new ingestion and removes review-scoped translations and raws',async()=>{
 const r=await insert('expires',new Date(Date.now()-86400000).toISOString());const rid=r.rows[0].id;
 await db.query("insert into public.review_translations(review_id,language,translated_text) values($1,'en','Text')",[rid]);
 await db.query("select public.apply_recent_review_retention($1,now()+interval '7 months')",[est]);
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);expect((await db.query('select count(*)::int n from public.review_translations')).rows[0].n).toBe(0);
});
it('freezes one consistent corpus at enqueue and preserves request idempotency',async()=>{
 await insert('one',new Date(Date.now()-86400000).toISOString());await db.exec('set local role service_role');
 const args=[est,org,user,'vi','40000000-0000-4000-8000-000000000001','gpt-6.1-sol',8];
 const a=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',args)).rows[0];
 const b=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',args)).rows[0];
 expect(a.id).toBe(b.id);expect((a.snapshot as {retention:{review_count:number}}).retention.review_count).toBe(1);
 expect((await db.query('select count(*)::int n from public.report_corpus_scopes')).rows[0].n).toBe(1);
});
it('serializes ingestion and freezing on the same establishment lock and guards both native claims',async()=>{
 const rows=(await db.query("select proname,pg_get_functiondef(oid) d from pg_proc where proname in('ingest_recent_reviews','freeze_recent_review_source','jev_batch_claim','jev_batch_claim_sol','retention_review_admission')")).rows;
 for(const name of ['ingest_recent_reviews','freeze_recent_review_source','retention_review_admission'])expect(rows.find(r=>r.proname===name)?.d).toContain('recent-text-corpus:');
 for(const name of ['jev_batch_claim','jev_batch_claim_sol'])expect(rows.find(r=>r.proname===name)?.d).toContain('retention_batch_allowed');
});
it('does not overwrite a known receipt with a later unknown state and keeps the ledger text-free',async()=>{
 const task={id:'40000000-0000-4000-8000-000000000002',request_count:1,status:'unknown',receipt:null,request_wire:'Secret review text',original_text:'Secret review text'};
 await db.query("select private.record_retention_attempt('fixture', $1)",[JSON.stringify(task)]);
 expect((await db.query('select outcome,input_tokens from private.provider_attempt_ledger')).rows).toEqual([{outcome:'unknown',input_tokens:null}]);
 await db.query("select private.record_retention_attempt('fixture', $1)",[JSON.stringify({...task,status:'completed',receipt:{usage:{input_tokens:12,output_tokens:3}}})]);
 await db.query("select private.record_retention_attempt('fixture', $1)",[JSON.stringify(task)]);
 const rows=(await db.query('select to_jsonb(l)::text v from private.provider_attempt_ledger l')).rows;
 expect(rows[0].v).not.toContain('Secret review text');expect(JSON.parse(rows[0].v as string)).toMatchObject({outcome:'completed',input_tokens:12,output_tokens:3});
});
it('preserves publication on edits and removes an edited review that loses all usable text',async()=>{
 const r=await insert('edited',new Date(Date.now()-86400000).toISOString());
 await db.query("update public.reviews set published_at=now(),original_text='Updated',text='Updated' where id=$1",[r.rows[0].id]);
 expect((await db.query("select published_at<now()-interval '12 hours' old_date from public.reviews")).rows[0].old_date).toBe(true);
 await db.query("update public.reviews set original_text='',text='' where id=$1",[r.rows[0].id]);
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);
});
it('refuses legacy unfrozen sources before any worker and blocks unrelated requests during reconstruction',async()=>{
 await expect(db.query("insert into public.historical_report_runs(organization_id,establishment_id,language,status,snapshot) values($1,$2,'vi','queued','{}')",[org,est])).rejects.toThrow('FROZEN_RECENT_CORPUS_REQUIRED');
});
it('keeps retained statistics tenant-scoped and prevents authenticated maintenance/private reads',async()=>{
 await insert('scoped',new Date(Date.now()-86400000).toISOString());await db.exec('set local role authenticated');
 expect((await db.query('select * from public.review_corpus_states')).rows).toEqual([]);
 await expect(db.query('select * from private.review_seen_keys')).rejects.toThrow();
});
it('deduplicates a real ingestion bundle before counting, preserving usable text and earliest publication',async()=>{
 const date=new Date(Date.now()-86400000).toISOString(),base={organization_id:org,establishment_id:est,external_review_id:'duplicate',rating:2,author_name:'Fixture',published_at:date,source_provider:'apify',historical_import:true,requires_attention:false,requires_ai_analysis:false,status:'ignored'};
 await db.exec('set local role service_role');
 const payload=[{row:{...base,text:'Actual review',original_text:'Actual review'}},{row:{...base,text:' ',original_text:''}}];
 await db.query("select public.ingest_recent_reviews($1,$2,$3,'apify')",[est,org,JSON.stringify(payload)]);
 expect((await db.query('select count(*)::int n,min(original_text) t from public.reviews')).rows).toEqual([{n:1,t:'Actual review'}]);
 expect((await db.query('select observed_reviews::int n from public.review_observation_totals')).rows[0].n).toBe(1);
});
it('reads Sol tokens and both cache counters from the real saved HTTP body even if run usage exists',async()=>{
 const native={model:'gpt-6.1-sol',usage:{input_tokens:100,output_tokens:40,input_tokens_details:{cached_tokens:20,cache_write_tokens:80}}};
 await db.query("select private.record_retention_attempt('fixture_sol',$1)",[JSON.stringify({id:'native-sol',sol_request_count:1,status:'completed',usage:{sol:{}},sol_receipt:{raw_response_text:JSON.stringify(native)}})]);
 expect((await db.query('select model,input_tokens::int i,output_tokens::int o,cache_read_tokens::int r,cache_write_tokens::int w from private.provider_attempt_ledger')).rows).toEqual([{model:'gpt-6.1-sol',i:100,o:40,r:20,w:80}]);
});
it('removes a superseded failed frozen source and keeps its request tombstone without deleting the newer report',async()=>{
 await insert('one',new Date(Date.now()-86400000).toISOString());await db.exec('set local role service_role');
 const args=[est,org,user,'vi','50000000-0000-4000-8000-000000000001','gpt-6.1-sol',8];
 const old=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',args)).rows[0];
 await db.query("update public.historical_report_runs set status='failed',created_at=now()-interval '1 hour' where id=$1",[old.id]);
 args[4]='50000000-0000-4000-8000-000000000002';const fresh=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',args)).rows[0];
 await db.query("insert into public.analysis_parallel_reports(id,organization_id,establishment_id,current_source_run_id,language,state,generated_at) values(gen_random_uuid(),$1,$2,$3,'vi','completed',now())",[org,est,fresh.id]);
 await db.exec('select public.maintain_recent_review_corpora()');
 expect((await db.query('select id from public.historical_report_runs')).rows).toEqual([{id:fresh.id}]);
 expect((await db.query('select request_id from private.retired_generation_keys')).rows).toEqual([{request_id:'50000000-0000-4000-8000-000000000001'}]);
});
it('purges the disposable expired source without table DDL while preserving its last scope tombstone',async()=>{
 await insert('one',new Date(Date.now()-86400000).toISOString());await db.exec('set local role service_role');
 const fresh=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',[est,org,user,'vi','60000000-0000-4000-8000-000000000001','gpt-6.1-sol',8])).rows[0];
 await db.query("insert into public.analysis_parallel_reports(id,organization_id,establishment_id,current_source_run_id,language,state,generated_at) values(gen_random_uuid(),$1,$2,$3,'vi','completed',now())",[org,est,fresh.id]);
 await db.query("select public.apply_recent_review_retention($1,now()+interval '7 months')",[est]);
 expect((await db.query('select count(*)::int n from public.analysis_parallel_reports')).rows[0].n).toBe(0);
 expect((await db.query('select review_count,reason from private.retired_report_scopes')).rows).toEqual([{review_count:1,reason:'CORPUS_REVIEW_REMOVED'}]);
 expect((await db.query("select pg_get_functiondef('private.retention_retire_source(uuid,text)'::regprocedure) d")).rows[0].d).not.toContain('alter table');
});

// Synthetic saved receipt: the production history and corpus guards run here.
// Native responses are replayed separately without committing customer texts.
async function savedCompactReceipt(){
 await insert('recovery',new Date(Date.now()-86400000).toISOString(),'Good food, but cold.');await db.exec('set local role service_role');
 const source=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',[est,org,user,'vi',crypto.randomUUID(),'gpt-6.1-sol',8])).rows[0];
 const sourceId=source.id,run=crypto.randomUUID(),reportId=crypto.randomUUID(),reviewId=(await db.query('select id from public.reviews')).rows[0].id;
 const evidence=['negative','positive'].map((polarity,i)=>({evidence_id:'evidence-'+i,review_id:reviewId,category:'quality',polarity,quote:'Good food, but cold.',context:'Good food, but cold.',quote_start:0,quote_end:20,context_start:0,context_end:20,quote_sha256:'same',analysis_text_sha256:'same'}));
 const compact={report:{negative_aspects:[{category:'quality',text:'Food reported cold.',refs:['e1','e2']}]}},statistics={total_reviews:1};
 const raw={model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:30,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(compact)}]}]};
 const envelope={evidence,statistics,statistics_sha256:await directHash(statistics),request_sha256:'request-hash'};
 const receipt={request_sha256:'request-hash',http_status:200,raw_response_text:JSON.stringify(raw),raw_response_sha256:await analysisTextSha256(JSON.stringify(raw))};
 const original={statistics_sha256:envelope.statistics_sha256,report:{negative_aspects:[{category:'quality',text:'Food reported cold.',evidence_ids:evidence.map(e=>e.evidence_id)}]}};
 const derived=structuredClone(original);derived.report.negative_aspects[0].evidence_ids=['evidence-0'];
 const result={response:raw,original_report:original,derived_report:derived,corrections:{changes:[{path:'negative_aspects[0]',reason:'extra_incompatible_polarity_same_review_and_identical_text',before:['evidence-0','evidence-1'],after:['evidence-0']}]},controls:{technical_checks_passed:true,validator_version:'jls-direct4-reference-links-v1',compact_response:compact,evidence,server_statistics:statistics,section_issues:[]}};
 await db.query("insert into public.analysis_parallel_reports(id,organization_id,establishment_id,current_source_run_id,language,state,error_code,raw_response,statistics,usage,source_reviews,generated_at) values($1,$2,$3,$4,'vi','invalid_output','COMPACT_SOL_UNKNOWN_OR_INCOMPATIBLE_REFERENCE',$5,$6,$7,$8,'2026-10-25 00:00Z')",[reportId,org,est,sourceId,raw,statistics,raw.usage,[{id:reviewId,original_text:'Good food, but cold.',analysis_text:'Good food, but cold.'}]]);
 await db.query("insert into public.analysis_jev_batch_runs(id,organization_id,establishment_id,current_source_run_id,report_id,status,stage,error_code,armed,sol_request_count,envelope,envelope_sha256,sol_receipt,sol_receipt_sha256,completed_at) values($1,$2,$3,$4,$5,'invalid_output','validate_sol','COMPACT_SOL_UNKNOWN_OR_INCOMPATIBLE_REFERENCE',false,1,$6,$7,$8,$9,'2026-10-25 00:00Z')",[run,org,est,sourceId,reportId,envelope,await directHash(envelope),receipt,await directHash(receipt)]);
 await db.query("insert into public.analysis_jev_batch_tasks(run_id,status,request_count,receipt) values($1,'completed',1,'{}')",[run]);
 await db.query("update public.historical_report_runs set status='failed',completed_at='2026-10-25 00:00Z' where id=$1",[sourceId]);
 await db.query('update public.report_generation_requests set comparison_id=$1 where source_run_id=$2',[reportId,sourceId]);
 const publish=async(value:unknown=result)=>db.query('select private.publish_revalidated_compact_sol($1,$2,$3,$4,$5) r',[run,await directHash(envelope),await directHash(receipt),value,await directHash(value)]);
 return {run,sourceId,reportId,result,publish};
}
it('publishes only a known saved receipt, preserving native content, usage, attempts and original times; repeated publication is inert',async()=>{
 const f=await savedCompactReceipt();const before=(await db.query('select to_jsonb(b) b,to_jsonb(p) p from public.analysis_jev_batch_runs b join public.analysis_parallel_reports p on p.id=b.report_id')).rows[0];
 expect((await f.publish()).rows[0].r).toMatchObject({report_id:f.reportId,provider_calls:0});
 const after=(await db.query('select to_jsonb(b) b,to_jsonb(p) p from public.analysis_jev_batch_runs b join public.analysis_parallel_reports p on p.id=b.report_id')).rows[0];
 const strip=(v:Record<string,unknown>,keys:string[])=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
 expect(strip(after.b as never,['status','error_code'])).toEqual(strip(before.b as never,['status','error_code']));
 expect(strip(after.p as never,['state','error_code','original_report','derived_report','corrections','controls'])).toEqual(strip(before.p as never,['state','error_code','original_report','derived_report','corrections','controls']));
 expect((await f.publish()).rows[0].r).toMatchObject({already_published:true,provider_calls:0});
 expect((await db.query("select tgenabled from pg_trigger where tgname='parallel_history_immutable'")).rows[0].tgenabled).toBe('O');
 await expect(db.query('update public.analysis_parallel_reports set raw_response=null where id=$1',[f.reportId])).rejects.toThrow('IMMUTABLE_HISTORY');
});
it.each(['prose','native','missing_controls','unrelated_alias','stale','unknown','armed'])('refuses %s recovery without publishing or consuming a new attempt',async kind=>{
 const f=await savedCompactReceipt(),r=structuredClone(f.result);
 if(kind==='prose')r.derived_report.report.negative_aspects[0].text='Different meaning';
 if(kind==='native')r.response.model='other-model';
 if(kind==='missing_controls')delete (r as {controls?:unknown}).controls;
 if(kind==='unrelated_alias')r.corrections.changes[0].reason='guess_a_reference';
 if(kind==='stale')await db.query('update public.report_corpus_scopes set stale=true where source_run_id=$1',[f.sourceId]);
 if(kind==='unknown')await db.query("update public.analysis_jev_batch_runs set status='billing_uncertain' where id=$1",[f.run]);
 if(kind==='armed')await db.query('update public.analysis_jev_batch_runs set armed=true where id=$1',[f.run]);
 await db.exec('savepoint rejected');await expect(f.publish(r)).rejects.toThrow('RECOVERY_');await db.exec('rollback to savepoint rejected');
 expect((await db.query('select state from public.analysis_parallel_reports where id=$1',[f.reportId])).rows[0].state).toBe('invalid_output');
 expect((await db.query('select sol_request_count from public.analysis_jev_batch_runs where id=$1',[f.run])).rows[0].sol_request_count).toBe(1);
});
it('rolls back publication and restores the immutable guard if any remaining publication guard fails',async()=>{
 const f=await savedCompactReceipt();await db.exec("reset role;create function public.fixture_reject_recovery() returns trigger language plpgsql as $$begin if new.state='completed' then raise exception 'FIXTURE_PUBLICATION_REJECTED';end if;return new;end$$;create trigger z_fixture_reject before update on public.analysis_parallel_reports for each row execute function public.fixture_reject_recovery();set local role service_role");
 await db.exec('savepoint rejected');await expect(f.publish()).rejects.toThrow('FIXTURE_PUBLICATION_REJECTED');await db.exec('rollback to savepoint rejected');
 expect((await db.query("select tgenabled from pg_trigger where tgname='parallel_history_immutable'")).rows[0].tgenabled).toBe('O');
 expect((await db.query('select state from public.analysis_parallel_reports where id=$1',[f.reportId])).rows[0].state).toBe('invalid_output');
});
it('does not expose saved-receipt publication to authenticated clients',async()=>{
 const f=await savedCompactReceipt();await db.exec('set local role authenticated');await expect(f.publish()).rejects.toThrow('permission denied');
});

async function datedPublication(ago='1 hour',language='vi'){
 if(!(await db.query('select id from public.reviews limit 1')).rows.length)await insert('dated',new Date(Date.now()-86400000).toISOString(),'SYNTHETIC full review to remove');
 await db.exec('set local role service_role');
 const s=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',[est,org,user,language,crypto.randomUUID(),'gpt-6.1-sol',8])).rows[0];
 await db.query("update public.historical_report_runs set status='completed',created_at=clock_timestamp()-$2::interval where id=$1",[s.id,ago]);
 const reviews=(await db.query('select id,rating,published_at,original_text from public.reviews order by id')).rows.map(r=>({...r,analysis_text:r.original_text,analysis_language:'en'}));
 const ids=reviews.map(r=>r.id),first=reviews[0],reportId=crypto.randomUUID();
 const report={categories:['service','price','quality','ambiance'].map(category=>({category,text:'SYNTHETIC dated synthesis',evidence_ids:[]})),positive_aspects:[],negative_aspects:[],conclusion:{text:'SYNTHETIC dated conclusion',evidence_ids:[]},recommendations:[{title:'SYNTHETIC recommendation',category:'quality',evidence_ids:['e1'],observations:[{text:'SYNTHETIC generated observation',evidence_id:'e1',quote:first.original_text,quote_sha256:'hash'}],proposed_action:'Check',priority_reason:'Isolated'}]};
 const statistics={scope:{source_reviews:ids.length,analysed_text_reviews:ids.length,textless_statistics_only:0},counts:{categories:{quality:{negative_including_mixed:ids.length,positive_including_mixed:0,negative_review_ids:ids,positive_review_ids:[]}}}};
 const controls={technical_checks_passed:true,evidence:[{evidence_id:'e1',review_id:first.id,category:'quality',polarity:'negative',quote:first.original_text,context:first.original_text,quote_sha256:await analysisTextSha256(first.original_text as string)}]};
 await db.query("insert into public.analysis_parallel_reports(id,organization_id,establishment_id,current_source_run_id,language,state,derived_report,controls,statistics,source_reviews,generated_at) values($1,$2,$3,$4,$9,'completed',$5,$6,$7,$8,clock_timestamp())",[reportId,org,est,s.id,{report},controls,statistics,reviews,language]);
 return {id:reportId,source:s.id,reviews,report};
}
const readDated=async()=>(await db.query('select public.read_current_report_publication($1,$2) p',[est,'vi'])).rows[0].p as {scope:{stale:boolean;review_count:number};row:{id:string;source_reviews:{id:string}[];statistics:{scope:{source_reviews:number}};controls:{evidence:{quote:string|null;available:boolean}[]}}};
it('keeps the dated report when a new review replaces the 100th, with original counters and an unavailable reference',async()=>{
 for(let i=0;i<100;i++)await insert('dated-'+i,new Date(Date.now()-(i+1)*86400000).toISOString(),'SYNTHETIC full review '+i);
 const p=await datedPublication();await insert('newest',new Date(Date.now()-10000).toISOString(),'SYNTHETIC newest');
 const view=await readDated();expect(view.row.id).toBe(p.id);expect(view.scope.stale).toBe(true);expect(view.scope.review_count).toBe(100);expect(view.row.statistics.scope.source_reviews).toBe(100);expect(view.row.source_reviews).toHaveLength(99);
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(100);
 expect((await db.query('select count(*)::int n from public.historical_report_runs')).rows[0].n).toBe(0);
 const stored=(await db.query('select to_jsonb(p)::text body from public.current_report_publications p')).rows[0].body as string;
 expect(stored).not.toContain('SYNTHETIC full review');expect(stored).toContain('SYNTHETIC dated synthesis');
 expect((await db.query('select count(*)::int n from public.current_report_publications')).rows[0].n).toBe(1);
},30000);
it('keeps a dated report after all reviews expire without an ingestion, with no retained source quotation',async()=>{
 const p=await datedPublication();await db.query("select public.apply_recent_review_retention($1,now()+interval '7 months')",[est]);
 const view=await readDated();expect(view.row.id).toBe(p.id);expect(view.scope.stale).toBe(true);expect(view.row.source_reviews).toHaveLength(0);expect(view.row.controls.evidence[0]).toMatchObject({quote:null,available:false});
 expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);
 expect((await db.query('select count(*)::int n from public.analysis_parallel_reports')).rows[0].n).toBe(0);
});
it('keeps the last report on regeneration failure and replaces it only on compatible success, without accumulating publications',async()=>{
 const old=await datedPublication();await insert('addition',new Date(Date.now()-10000).toISOString(),'SYNTHETIC extra');
 const failed=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',[est,org,user,'vi',crypto.randomUUID(),'gpt-6.1-sol',8])).rows[0];
 await db.query("update public.historical_report_runs set status='failed' where id=$1",[failed.id]);
 expect((await readDated()).row.id).toBe(old.id);expect((await readDated()).scope.stale).toBe(true);
 const fresh=await datedPublication('0 seconds');expect((await readDated()).row.id).toBe(fresh.id);expect((await readDated()).scope.stale).toBe(false);
 expect((await db.query('select count(*)::int n from public.current_report_publications')).rows[0].n).toBe(1);
});
it('blocks a consumed generation when its text changes, preserves the dated report and never reclassifies the new text',async()=>{
 const old=await datedPublication(),req=crypto.randomUUID();
 const s=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',[est,org,user,'vi',req,'gpt-6.1-sol',8])).rows[0],run=crypto.randomUUID(),report=crypto.randomUUID();
 await db.query("insert into public.analysis_parallel_reports(id,organization_id,establishment_id,current_source_run_id,language,state,configuration_version) values($1,$2,$3,$4,'vi','queued','jev-multi-review-initial-v1')",[report,org,est,s.id]);
 await db.query("insert into public.analysis_jev_batch_runs(id,organization_id,establishment_id,current_source_run_id,report_id,status,stage,armed,sol_request_count,sol_receipt) values($1,$2,$3,$4,$5,'running','validate_sol',true,1,'{\"saved\":true}')",[run,org,est,s.id,report]);
 await db.query("insert into public.analysis_jev_batch_tasks(run_id,status,request_count,lease_until) values($1,'reserved',1,now()+interval '1 hour')",[run]);
 await db.query("update public.reviews set original_text='SYNTHETIC modified after reservation',text='SYNTHETIC modified after reservation' where id=$1",[old.reviews[0].id]);
 expect((await readDated()).scope.stale).toBe(true);expect((await readDated()).row.source_reviews).toHaveLength(0);
 expect((await db.query('select armed from public.analysis_jev_batch_runs where id=$1',[run])).rows[0].armed).toBe(false);
 await db.query("select public.jev_batch_finish($1,'completed',$2,'{}',null)",[run,{response:{saved:true},derived_report:{report:old.report},controls:{technical_checks_passed:true}}]);
 expect((await db.query('select state from public.analysis_parallel_reports where id=$1',[report])).rows[0].state).toBe('blocked');
 expect((await db.query('select status,sol_request_count,sol_receipt from public.analysis_jev_batch_runs where id=$1',[run])).rows[0]).toMatchObject({status:'blocked',sol_request_count:1,sol_receipt:{saved:true}});
 expect((await readDated()).row.id).toBe(old.id);
 await db.query("update public.analysis_jev_batch_tasks set lease_until=now()-interval '1 second' where run_id=$1",[run]);await db.exec('select public.maintain_recent_review_corpora()');
 expect((await db.query('select count(*)::int n from public.analysis_jev_batch_runs where id=$1',[run])).rows[0].n).toBe(0);
 expect((await db.query("select outcome from private.provider_attempt_ledger where phase='sol'")).rows.length).toBeGreaterThan(0);
 await expect(db.query('select public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)',[est,org,user,'vi',req,'gpt-6.1-sol',8])).rejects.toThrow('REPORT_REQUEST_RETIRED');
});
it('keeps publications tenant scoped and the live source projection unavailable to clients',async()=>{
 await datedPublication();await db.exec('set local role authenticated');expect((await db.query('select * from public.current_report_publications')).rows).toEqual([]);
 await expect(db.query('select public.read_current_report_publication($1,$2)',[est,'vi'])).rejects.toThrow('permission denied');
});
it('uses the same establishment lock for publication and cleanup, without a global lock inversion',async()=>{
 const d=(await db.query("select pg_get_functiondef('private.retention_retire_source(uuid,text)'::regprocedure) d")).rows[0].d as string;
 expect(d).toContain('recent-text-corpus:');expect(d).not.toContain('retention-source-cleanup');
 const f=(await db.query("select pg_get_functiondef('public.jev_batch_finish(uuid,text,jsonb,jsonb,text)'::regprocedure) d")).rows[0].d as string;
 expect(f.indexOf('recent-text-corpus:')).toBeLessThan(f.indexOf('where id=p_run for update'));
});
it('atomically replaces a success on the same corpus and retires its previous full operational copy',async()=>{
 const old=await datedPublication(),fresh=await datedPublication('0 seconds');expect((await readDated()).row.id).toBe(fresh.id);
 expect((await db.query('select id from public.analysis_parallel_reports')).rows).toEqual([{id:fresh.id}]);
 expect((await db.query('select count(*)::int n from public.historical_report_runs where id=$1',[old.source])).rows[0].n).toBe(0);
 expect((await db.query('select count(*)::int n from public.current_report_publications')).rows[0].n).toBe(1);
});
it('keeps exactly one publication independently for each report language',async()=>{
 const vi=await datedPublication(),fr=await datedPublication('0 seconds','fr');expect((await readDated()).row.id).toBe(vi.id);
 expect((await db.query("select report_id from public.current_report_publications where language='fr'")).rows).toEqual([{report_id:fr.id}]);
 expect((await db.query('select count(*)::int n from public.current_report_publications')).rows[0].n).toBe(2);
});
it('marks rating and subrating edits stale during a deferred ingestion without changing the original fingerprint',async()=>{
 const p=await datedPublication();const fp=(await db.query('select scope->>\'fingerprint\' f from public.current_report_publications')).rows[0].f;
 await db.exec("select set_config('home.retention_ingest','on',true)");
 await db.query("update public.reviews set rating=1,review_detailed_rating='{\"Food\":1}' where id=$1",[p.reviews[0].id]);
 expect((await readDated()).scope.stale).toBe(true);
 await db.exec("select set_config('home.retention_ingest','',true)");await db.query('select public.apply_recent_review_retention($1)',[est]);
 expect((await db.query('select scope->>\'fingerprint\' f from public.current_report_publications')).rows[0].f).toBe(fp);
 expect((await db.query('select count(*)::int n from public.historical_report_runs')).rows[0].n).toBe(0);
 expect((await readDated()).row.id).toBe(p.id);
});


describe('latest 150 review corpus',()=>{
 beforeEach(async()=>{await db.exec('create or replace function private.enqueue_review_ai() returns trigger language plpgsql as $$begin return new;end$$');for(const suffix of ['_latest_150_review_policy.sql','_normalize_textless_frozen_sources.sql'])await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith(suffix)),'utf8'));});
 it('keeps the newest 150 unique published reviews including textless and old ones, all stars and stable equal dates',async()=>{
  for(let i=154;i>=0;i--)await insert('r'+String(i).padStart(3,'0'),'2020-01-01',i%2?'':'Text',i%5+1);
  const rows=(await db.query('select external_review_id,rating from public.reviews order by external_review_id')).rows;
  expect(rows).toHaveLength(150);expect(rows.at(-1)?.external_review_id).toBe('r149');expect(new Set(rows.map(r=>r.rating)).size).toBe(5);
  expect((await db.query('select count(*)::int n from public.reviews where text=\'\'')).rows[0].n).toBe(75);
  await db.query('select public.apply_recent_review_retention($1,now()+interval \'20 years\')',[est]);expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(150);
 });
 it('replaces review 150, removes translations and raws, and keeps the previous dated report stale',async()=>{
  const f=await savedCompactReceipt();await f.publish();await db.exec('reset role');
  const oldest=(await db.query('select id from public.reviews')).rows[0].id;
  await db.query('insert into public.review_translations(review_id,language,translated_text) values($1,\'fr\',\'Text\')',[oldest]);
  for(let i=0;i<150;i++)await insert('new-'+i,new Date(Date.now()-3600000).toISOString(),i%2?'':'New');
  expect((await db.query('select count(*)::int n from public.reviews where id=$1',[oldest])).rows[0].n).toBe(0);
  expect((await db.query('select count(*)::int n from public.review_translations where review_id=$1',[oldest])).rows[0].n).toBe(0);
  expect((await db.query('select report_id,stale from public.current_report_publications')).rows).toEqual([{report_id:f.reportId,stale:true}]);
 });
 it('freezes ratings from all retained reviews while only real text can become JEV input',async()=>{
  await insert('text','2020-01-01','Original',5);await insert('stars','2020-01-02','',1);await db.exec('set local role service_role');
  const frozen=(await db.query('select public.freeze_recent_review_source($1,$2,\'vi\',now()) j',[est,org])).rows[0].j as {retention:{review_count:number;cutoff:null};retention_frozen_rows:{original_text:string}[];retention_establishment:{total_reviews:number;rating:number}};
  expect(frozen.retention.review_count).toBe(2);expect(frozen.retention.cutoff).toBeNull();expect(frozen.retention_establishment.total_reviews).toBe(2);expect(Number(frozen.retention_establishment.rating)).toBe(3);expect(frozen.retention_frozen_rows.filter(x=>x.original_text?.trim())).toHaveLength(1);
 });
 it('keeps invisible-only reviews in statistics and out of textual AI without changing real comments',async()=>{
  await insert('invisible','2020-01-01','\u200b',1);await insert('actual','2020-01-02',' Original text ',5);await db.exec('set local role service_role');
  const f=(await db.query("select public.freeze_recent_review_source($1,$2,'vi',now()) j",[est,org])).rows[0].j as {retention_frozen_rows:{original_text:string|null;text:string|null}[]};
  expect(f.retention_frozen_rows.map(r=>analysisTextForReview(r).analysis_text).filter(Boolean)).toEqual([' Original text ']);
  expect(f.retention_frozen_rows).toHaveLength(2);
 });
 it('does not replace the available publication after a failed regeneration or publish a modified in-flight corpus',async()=>{
  const f=await savedCompactReceipt();await f.publish();
  const fresh=(await db.query('select (public.enqueue_current_report($1,$2,$3,\'vi\',$4,\'gpt-6.1-sol\',8)).*',[est,org,user,crypto.randomUUID()])).rows[0];
  await db.query('update public.reviews set rating=1,original_text=\'Changed\',text=\'Changed\'');
  await db.query('update public.historical_report_runs set status=\'failed\' where id=$1',[fresh.id]);
  expect((await db.query('select report_id,stale from public.current_report_publications')).rows).toEqual([{report_id:f.reportId,stale:true}]);
  expect((await db.query('select count(*)::int n from public.analysis_parallel_reports where current_source_run_id=$1 and state=\'completed\'',[fresh.id])).rows[0].n).toBe(0);
 });
 it('neutralizes old import IDs and requires a fresh claimed job for service restaurant creation',async()=>{
  await db.exec('reset role');await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_reset_restaurant_barrier.sql')),'utf8'));
  await db.exec('update public.review_corpus_policy set paused=false,ingestions_paused=false;set local role service_role');
  await db.exec('savepoint denied');await expect(db.query('insert into public.establishments(id,organization_id,name,google_id,google_maps_url) values($1,$2,\'Late\',\'late\',\'late\')',[crypto.randomUUID(),org])).rejects.toThrow('FRESH_IMPORT_JOB_REQUIRED');await db.exec('rollback to savepoint denied');
  await db.exec('reset role');const job=crypto.randomUUID();
  await db.query('insert into public.initial_import_jobs(id,organization_id,user_id,query,expected_google_id,preferred_language,status,created_at,lease_until) values($1,$2,$3,\'New\',\'new\',\'vi\',\'running\',now()+interval \'1 second\',now()+interval \'1 hour\')',[job,org,user]);
  await db.exec('set local role service_role');await db.query('insert into public.establishments(id,organization_id,name,google_id,google_maps_url,initial_import_job_id) values($1,$2,\'New\',\'new\',\'new\',$3)',[crypto.randomUUID(),org,job]);
  expect((await db.query('select count(*)::int n from public.establishments')).rows[0].n).toBe(2);
 });
 it('purges the reviewed content tables while retaining access and content-free consumed-attempt fences',async()=>{
  await datedPublication();await db.exec('reset role');
  await db.exec(readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_reset_restaurant_barrier.sql')),'utf8'));
  const access=(await db.query('select * from public.organization_members')).rows;
  const sql=readFileSync('supabase/maintenance/reset-restaurants.sql','utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
  await db.exec(sql);
  expect((await db.query('select count(*)::int n from public.establishments')).rows[0].n).toBe(0);
  expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(0);
  expect((await db.query('select count(*)::int n from public.current_report_publications')).rows[0].n).toBe(0);
  expect((await db.query('select * from public.organization_members')).rows).toEqual(access);
  expect((await db.query('select count(*)::int n from private.retired_generation_keys')).rows[0].n).toBeGreaterThan(0);
  expect((await db.query('select count(*)::int n from private.provider_attempt_ledger where establishment_id is not null or organization_id is not null')).rows[0].n).toBe(0);
 });
});


describe('native account language after complete reset',()=>{
 beforeEach(()=>prepareNativeLanguage(db,user));
 const google=async(id:unknown,language:string,text:string)=>{await db.exec("select set_config('home.retention_ingest','on',true)");await db.query('insert into public.review_translations(review_id,language,translated_text) values($1,$2,$3)',[id,language,text]);};
 const display=async(id:unknown,prepare=true)=>(await db.query('select public.read_review_display($1,$2) r',[[id],prepare])).rows[0].r as {status:string;language:string;translated_text:string|null}[];
 it('reads FR/VI Google versions without enqueueing a translator, including older clients',async()=>{
  const id=(await insert('native','2020-01-01','Original russe')).rows[0].id;await google(id,'vi','Bản Google Việt');await google(id,'fr','Version Google française');
  expect(await display(id)).toMatchObject([{status:'translated',language:'vi',translated_text:'Bản Google Việt'}]);
  await db.query("update public.profiles set preferred_language='fr' where user_id=$1",[user]);expect(await display(id)).toMatchObject([{status:'translated',language:'fr',translated_text:'Version Google française'}]);
  expect((await db.query('select enabled from private.review_display_runtime')).rows[0].enabled).toBe(false);expect((await db.query("select * from public.claim_review_display('worker')")).rows).toHaveLength(0);
 });
 it('never substitutes English or another target; matching originals and textless reviews need no translation',async()=>{
  const id=(await insert('native','2020-01-01','English original')).rows[0].id;await google(id,'en','Wrong English version');await google(id,'fr','Version française');expect(await display(id)).toMatchObject([{status:'missing',translated_text:null}]);
  await db.query("update public.reviews set original_language='vi' where id=$1",[id]);expect(await display(id)).toMatchObject([{status:'original',translated_text:null}]);
  const empty=(await insert('empty','2020-01-01','')).rows[0].id;expect(await display(empty)).toMatchObject([{status:'original'}]);
 });
 it('binds exact Unicode source hashes and removes translations after modification',async()=>{
  const id=(await insert('native','2020-01-01','Đồ ăn rất ngon.')).rows[0].id;await google(id,'fr','Très bon repas.');
  expect((await db.query('select source_text_sha256 h from public.review_translations')).rows[0].h).toBe(await analysisTextSha256('Đồ ăn rất ngon.'));
  await db.query('update public.reviews set original_text=$2,text=$2 where id=$1',[id,'Original modifié']);expect((await db.query('select count(*)::int n from public.review_translations')).rows[0].n).toBe(0);
 });
 it('freezes collection language in a durable import, establishment and subsequent automatic sync',async()=>{
  const j=crypto.randomUUID(),e=crypto.randomUUID();await db.query("insert into public.initial_import_jobs(id,organization_id,user_id,query,expected_google_id,preferred_language,status) values($1,$2,$3,'offline','fresh','vi','running')",[j,org,user]);
  await db.query("insert into public.establishments(id,organization_id,name,google_id,initial_import_job_id) values($1,$2,'Offline fixture','fresh',$3)",[e,org,j]);expect((await db.query('select collection_language from public.establishments where id=$1',[e])).rows[0].collection_language).toBe('vi');
  await db.query("update public.profiles set preferred_language='fr' where user_id=$1",[user]);await db.query('insert into public.review_sync_jobs(establishment_id,organization_id,scheduled_for) values($1,$2,now())',[e,org]);expect((await db.query('select collection_language from public.review_sync_jobs')).rows[0].collection_language).toBe('vi');
  await db.exec('savepoint frozen');await expect(db.query("update public.initial_import_jobs set preferred_language='fr' where id=$1",[j])).rejects.toThrow('FROZEN_COLLECTION_LANGUAGE');await db.exec('rollback to savepoint frozen');
 });
 it('does not reissue an unknown sync start, including through a freshly scheduled job',async()=>{
  const j=crypto.randomUUID();await db.query("insert into public.review_sync_jobs(id,establishment_id,organization_id,status,locked_by,lease_until) values($1,$2,$3,'running','worker',now()+interval '2 minutes')",[j,est,org]);const reserve=()=>db.query("select public.reserve_review_sync_start($1,'worker') ok",[j]);
  expect((await reserve()).rows[0].ok).toBe(true);expect((await reserve()).rows[0].ok).toBe(false);await db.exec("update public.review_sync_jobs set lease_until=now()-interval '1 second'");expect((await db.query("select * from public.claim_review_sync_jobs('cron')")).rows).toHaveLength(0);
  expect((await db.query('select status,error_code from public.review_sync_jobs')).rows[0]).toEqual({status:'dead',error_code:'APIFY_START_OUTCOME_UNKNOWN'});await db.query('insert into public.review_sync_jobs(establishment_id,organization_id) values($1,$2)',[est,org]);expect((await db.query('select count(*)::int n from public.review_sync_jobs')).rows[0].n).toBe(1);
 });
 it('resumes only the known Apify run after a lost worker, with the original language',async()=>{
  const j=crypto.randomUUID();await db.query("insert into public.review_sync_jobs(id,establishment_id,organization_id,status,locked_by,lease_until,pagination_cursor) values($1,$2,$3,'running','old',now()-interval '1 second',$4)",[j,est,org,JSON.stringify({provider:'apify',runId:'known',datasetId:'dataset',language:'fr'})]);expect((await db.query("select * from public.claim_review_sync_jobs('new')")).rows).toHaveLength(1);
  expect((await db.query('select apify_run_id,collection_language from public.review_sync_jobs')).rows[0]).toEqual({apify_run_id:'known',collection_language:'fr'});expect((await db.query("select public.reserve_review_sync_start($1,'new') ok",[j])).rows[0].ok).toBe(false);
 });
 it('keeps an unknown start beyond job retention and still blocks automatic re-collection',async()=>{
  await db.query("insert into public.review_sync_jobs(establishment_id,organization_id,status,finished_at) values($1,$2,'completed',now()-interval '60 days')",[est,org]);
  const j=crypto.randomUUID();await db.query("insert into public.review_sync_jobs(id,establishment_id,organization_id,status,provider_start_attempted_at,finished_at) values($1,$2,$3,'dead',now()-interval '60 days',now()-interval '60 days')",[j,est,org]);
  expect((await db.query('select public.cleanup_review_sync_jobs() r')).rows[0].r).toMatchObject({deleted:1});
  expect((await db.query('select id from public.review_sync_jobs')).rows).toEqual([{id:j}]);
  await db.query('insert into public.review_sync_jobs(establishment_id,organization_id) values($1,$2)',[est,org]);expect((await db.query('select count(*)::int n from public.review_sync_jobs')).rows[0].n).toBe(1);
  expect((await db.query("select * from public.claim_review_sync_jobs('later-worker')")).rows).toHaveLength(0);
 });
 it('preserves latest-150 retention without age/text bias, replacement and manual report lifecycle',async()=>{
  for(let n=0;n<152;n++)await insert('native'+String(n).padStart(3,'0'),'2020-01-01',n%2?'Texte':'',n%5+1);expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(150);
  const old=await datedPublication();await db.exec('reset role');await insert('newest',new Date(Date.now()-10000).toISOString(),'Nouveau');expect((await readDated()).scope.stale).toBe(true);expect((await readDated()).row.id).toBe(old.id);
  const fresh=await datedPublication('0 seconds');expect((await readDated()).row.id).toBe(fresh.id);expect((await db.query('select count(*)::int n from public.current_report_publications')).rows[0].n).toBe(1);
 });
 it('freezes Google target language and source hash, without reading English overrides',async()=>{
  expect((await db.query("select pg_get_functiondef('public.read_current_report_publication(uuid,text)'::regprocedure) d")).rows[0].d).not.toContain('english');
  const id=(await insert('native','2020-01-01','Original русский')).rows[0].id;await google(id,'vi','Bản Google Việt');await google(id,'en','Unused English');await db.exec('set local role service_role');
  const s=(await db.query("select public.freeze_recent_review_source($1,$2,'vi',now()) s",[est,org])).rows[0].s as {analysis_text_policy:string;retention_frozen_rows:{review_translations:{language:string;source_text_sha256:string}[]}[]};expect(s.analysis_text_policy).toBe('account_google_or_original_v1');expect(s).not.toHaveProperty('retention_english_overrides');expect(s.retention_frozen_rows[0].review_translations.find(t=>t.language==='vi')?.source_text_sha256).toBe(await analysisTextSha256('Original русский'));
 });
});

describe('atomic incremental sync with the retained native corpus',()=>{
 const at='2026-10-28T12:00:00Z';
 const item=(id:string,date=at)=>({cid:'fixture',reviewId:id,stars:5,text:'Original '+id,originalLanguage:'en',textTranslated:'Traduction '+id,translatedLanguage:'fr',publishedAtDate:date,language:'fr',scrapedAt:new Date().toISOString()});
 const cp={google_id:'fixture',google_maps_url:'https://www.google.com/maps?cid=123',checkpoint_review_id:'known',checkpoint_review_at:at};
 beforeEach(async()=>{
  await prepareNativeLanguage(db,user);
  await db.exec(`alter table public.establishments add column if not exists place_id text,add column if not exists review_reload_barrier_at timestamptz;
   alter table public.organizations add column if not exists monitoring_interval_hours integer default 12;
   create function public.review_sync_spread_offset(uuid,integer) returns interval language sql as $$select interval '0 seconds'$$;
   create unique index if not exists offline_snapshot_source on public.establishment_snapshots(establishment_id,provider,source_run_id);`);
  await db.exec(readFileSync('tests/fixtures/incremental-sync-completion.sql','utf8'));
  // The test already owns a transaction; keep the migration body inside it.
  await db.exec(readFileSync('supabase/migrations/20261029004621_incremental_review_sync.sql','utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,''));
 });
 async function seed(n=1){
  await db.exec("select set_config('home.retention_ingest','on',true)");
  for(let i=1;i<n;i++)await insert('old-'+String(i).padStart(3,'0'),new Date(Date.parse(at)-i*86400000).toISOString(),'Stored '+i,i%5+1);
  const rid=(await insert('known',at,'Stored original',5)).rows[0].id;
  await db.query("insert into public.review_translations(review_id,language,translated_text) values($1,'fr','Stored translation')",[rid]);
  await db.exec("select set_config('home.retention_ingest','',true)");
  await db.query('select public.apply_recent_review_retention($1)',[est]);
  await db.query('update public.establishments set last_review_id=$2,last_review_at=$3,initialized_at=now(),active=true where id=$1',[est,'known',at]);
 }
 async function job(){
  const id=crypto.randomUUID();await db.query("insert into public.review_sync_jobs(id,organization_id,establishment_id,status,locked_by,lease_until,checkpoint_review_id,checkpoint_review_at,started_at) values($1,$2,$3,'running','worker',now()+interval '5 minutes','known',$4,now())",[id,org,est,at]);
  await db.exec('set local role service_role');return id;
 }
 const requestInput={startUrls:[{url:cp.google_maps_url}],reviewsSort:'newest',reviewsOrigin:'google',language:'fr',maxReviews:150,reviewsStartDate:'2026-10-28T11:59:55.000Z'};
 const reserve=(id:string,worker='worker')=>db.query('select public.reserve_incremental_review_sync($1,$2,$3,$4) ok',[id,worker,requestInput,'0.0.541']);
 async function bind(id:string){
  await db.query("update public.review_sync_jobs set pagination_cursor=$2 where id=$1",[id,JSON.stringify({provider:'apify',runId:'run',datasetId:'data',language:'fr'})]);
 }
 async function finish(id:string,items:Record<string,unknown>[],worker='worker'){
  const run={runId:'run',datasetId:'data',status:'SUCCEEDED'},receipt={id:'run',actId:'Xb8osYTtOjlsgI6k9',buildId:'Wck4NsSOTMrHCVoAk',status:'SUCCEEDED'};
  await db.query('select public.observe_incremental_review_sync($1,$2,$3,$4,$5)',[id,worker,'run',receipt,items.length]);
  const p=prepareIncrementalResult(items,cp,run);
  const bundle=reviewIngestionBundle({id:est,organization_id:org},p.reviews,false,'apify');
  return (await db.query('select public.commit_incremental_review_sync($1,$2,$3,$4) r',[id,worker,bundle,{run_id:'run',dataset_id:'data',since:p.since,received:p.received,unique:p.unique,external_ids:p.external_ids,outside_window:p.outside_window,head_id:p.head.id,head_at:p.head.at,empty:p.empty,legacy_reused:false,place:p.page.establishment}])).rows[0].r as Record<string,unknown>;
 }
 const protectedRows=async()=> (await db.query("select jsonb_build_object('reviews',(select jsonb_agg(to_jsonb(r) order by id) from public.reviews r),'translations',(select jsonb_agg(to_jsonb(t) order by id) from public.review_translations t),'reports',(select jsonb_agg(to_jsonb(p) order by report_id) from public.current_report_publications p),'states',(select jsonb_agg(to_jsonb(s)) from public.review_corpus_states s),'snapshots',(select jsonb_agg(to_jsonb(s)) from public.establishment_snapshots s)) r")).rows[0].r;
 it('zero novelty preserves originals/translations/report freshness and does not run retention or rewrite a snapshot',async()=>{
  await seed();await datedPublication();const before=await protectedRows();const id=await job();expect((await reserve(id)).rows[0].ok).toBe(true);await bind(id);
  expect(await finish(id,[{...item('known','2026-10-28T15:00:00Z'),text:'Supplier edited existing text',textTranslated:'Changed translation'}])).toMatchObject({received:1,unique:1,already_known:1,added:0,removed:0,head_at:'2026-10-28T12:00:00+00:00'});expect(await protectedRows()).toEqual(before);
  expect((await db.query('select last_review_id,last_review_at::text,last_sync_at is not null checked from public.establishments')).rows[0]).toMatchObject({last_review_id:'known',checked:true});
 });
 it('a successful empty response advances verification only, never the publication checkpoint',async()=>{
  await seed();const before=await protectedRows();const id=await job();await reserve(id);await bind(id);expect(await finish(id,[])).toMatchObject({received:0,added:0,removed:0,empty:true});expect(await protectedRows()).toEqual(before);
 });
 it('adds four new IDs, removes the four oldest out of 150, and keeps the retained known original/translation unchanged',async()=>{
  await seed(150);const original=(await db.query("select to_jsonb(r) r from public.reviews r where external_review_id='known'")).rows[0].r;
  const translation=(await db.query('select to_jsonb(t) r from public.review_translations t')).rows[0].r;
  const id=await job();await reserve(id);await bind(id);const additions=Array.from({length:4},(_,i)=>item('new-'+i,new Date(Date.parse(at)+(i+1)*60000).toISOString()));
  expect(await finish(id,[...additions,item('known')])).toMatchObject({received:5,unique:5,already_known:1,added:4,removed:4,retained:150});
  expect((await db.query("select to_jsonb(r) r from public.reviews r where external_review_id='known'")).rows[0].r).toEqual(original);
  expect((await db.query('select to_jsonb(t) r from public.review_translations t where id=$1',[translation.id])).rows[0].r).toEqual(translation);
  expect((await db.query('select last_review_id from public.establishments')).rows[0].last_review_id).toBe('new-3');
 },30000);
 it('keeps same-timestamp unknown IDs, collapses duplicates and makes duplicate completion a read of its existing receipt',async()=>{
  await seed();const id=await job();await reserve(id);await bind(id);const items=[item('known'),item('same-time'),item('same-time')];
  const result=await finish(id,items);expect(result).toMatchObject({received:3,unique:2,already_known:1,added:1,removed:0,head_id:'known'});
  const before=await protectedRows();expect(await finish(id,items)).toEqual(result);expect(await protectedRows()).toEqual(before);
 });
 it('reserves once, rejects another worker and resumes a known run without another provider reservation',async()=>{
  await seed();const id=await job();expect((await reserve(id,'other')).rows[0].ok).toBe(false);expect((await reserve(id)).rows[0].ok).toBe(true);expect((await reserve(id)).rows[0].ok).toBe(false);await bind(id);
  await db.query("update public.review_sync_jobs set lease_until=now()-interval '1 second' where id=$1",[id]);await db.query("select * from public.claim_review_sync_jobs('resumed')");
  expect((await reserve(id,'resumed')).rows[0].ok).toBe(false);expect(await finish(id,[item('known'),item('same-time')],'resumed')).toMatchObject({added:1});
 });
 it('rolls insertion and checkpoint back when saving a dependent snapshot fails; its paid run stays bound',async()=>{
  await seed();const id=await job();await reserve(id);await bind(id);await db.exec("reset role;create function public.reject_incremental_snapshot() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_SAVE_FAILURE';end$$;create trigger reject_incremental_snapshot before insert on public.establishment_snapshots for each row execute function public.reject_incremental_snapshot();set local role service_role;");
  await db.exec('savepoint failed');await expect(finish(id,[item('known'),item('new','2026-10-28T13:00:00Z')])).rejects.toThrow('SYNTHETIC_SAVE_FAILURE');await db.exec('rollback to failed');
  expect((await db.query('select last_review_id from public.establishments')).rows[0].last_review_id).toBe('known');expect((await db.query("select count(*)::int n from public.reviews where external_review_id='new'")).rows[0].n).toBe(0);expect((await db.query('select apify_run_id,provider_requests,incremental_result from public.review_sync_jobs')).rows[0]).toMatchObject({apify_run_id:'run',provider_requests:1,incremental_result:null});
 });
 it('blocks missing checkpoints and late results after a reload, without republishing or resetting any report status',async()=>{
  await seed();const id=await job();await db.query('update public.review_sync_jobs set checkpoint_review_at=null where id=$1',[id]);await db.exec('savepoint missing');await expect(reserve(id)).rejects.toThrow('SYNC_INCREMENTAL_CHECKPOINT_MISSING');await db.exec('rollback to missing');expect((await db.query('select provider_start_attempted_at from public.review_sync_jobs')).rows[0].provider_start_attempted_at).toBeNull();
  await db.query('update public.review_sync_jobs set checkpoint_review_at=$2 where id=$1',[id,at]);await reserve(id);await bind(id);await db.query('update public.establishments set review_reload_barrier_at=clock_timestamp() where id=$1',[est]);
  await db.exec('savepoint late');await expect(finish(id,[item('known')])).rejects.toThrow('SYNC_INCREMENTAL_OBSOLETE');await db.exec('rollback to late');
 });
 it('denies all new queue RPCs to end users',async()=>{
  for(const role of ['anon','authenticated'])for(const signature of ['reserve_incremental_review_sync(uuid,text,jsonb,text)','observe_incremental_review_sync(uuid,text,text,jsonb,integer)','commit_incremental_review_sync(uuid,text,jsonb,jsonb)'])expect((await db.query("select has_function_privilege($1,'public.'||$2,'execute') allowed",[role,signature])).rows[0].allowed).toBe(false);
 });
});
