// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
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

async function datedPublication(ago='1 hour'){
 if(!(await db.query('select id from public.reviews limit 1')).rows.length)await insert('dated',new Date(Date.now()-86400000).toISOString(),'SYNTHETIC full review to remove');
 await db.exec('set local role service_role');
 const s=(await db.query('select (public.enqueue_current_report($1,$2,$3,$4,$5,$6,$7)).*',[est,org,user,'vi',crypto.randomUUID(),'gpt-6.1-sol',8])).rows[0];
 await db.query("update public.historical_report_runs set status='completed',created_at=clock_timestamp()-$2::interval where id=$1",[s.id,ago]);
 const reviews=(await db.query('select id,rating,published_at,original_text from public.reviews order by id')).rows.map(r=>({...r,analysis_text:r.original_text,analysis_language:'en'}));
 const ids=reviews.map(r=>r.id),first=reviews[0],reportId=crypto.randomUUID();
 const report={categories:['service','price','quality','ambiance'].map(category=>({category,text:'SYNTHETIC dated synthesis',evidence_ids:[]})),positive_aspects:[],negative_aspects:[],conclusion:{text:'SYNTHETIC dated conclusion',evidence_ids:[]},recommendations:[{title:'SYNTHETIC recommendation',category:'quality',evidence_ids:['e1'],observations:[{text:'SYNTHETIC generated observation',evidence_id:'e1',quote:first.original_text,quote_sha256:'hash'}],proposed_action:'Check',priority_reason:'Isolated'}]};
 const statistics={scope:{source_reviews:ids.length,analysed_text_reviews:ids.length,textless_statistics_only:0},counts:{categories:{quality:{negative_including_mixed:ids.length,positive_including_mixed:0,negative_review_ids:ids,positive_review_ids:[]}}}};
 const controls={technical_checks_passed:true,evidence:[{evidence_id:'e1',review_id:first.id,category:'quality',polarity:'negative',quote:first.original_text,context:first.original_text,quote_sha256:await analysisTextSha256(first.original_text as string)}]};
 await db.query("insert into public.analysis_parallel_reports(id,organization_id,establishment_id,current_source_run_id,language,state,derived_report,controls,statistics,source_reviews,generated_at) values($1,$2,$3,$4,'vi','completed',$5,$6,$7,$8,clock_timestamp())",[reportId,org,est,s.id,{report},controls,statistics,reviews]);
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
