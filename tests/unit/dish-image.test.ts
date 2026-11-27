// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {dishDatabase,ORG,ORG2} from '../fixtures/dish-associations-database';
import {DISH_IMAGE_MODEL,generateDishImage,processDishImage,type DishImageJob} from '../../supabase/functions/_shared/dish-image';

let db:PGlite;
const migration=(file:string)=>readFileSync('supabase/migrations/'+file,'utf8');
const query=async<T>(sql:string,args:unknown[]=[]) => (await db.query<{value:T}>(sql,args)).rows[0]?.value;
const claim=async()=>(await db.query<DishImageJob>('select * from public.claim_dish_image()')).rows[0]??null;
const finish=(job:DishImageJob,error:string|null=null,receipt:unknown=null)=>query<boolean>('select public.finish_dish_image($1,$2,$3,$4) value',[job.dish_id,job.generation_id,error,receipt]);
const row=(id:string)=>query<Record<string,unknown>>('select to_jsonb(i) value from private.dish_images i where dish_id=$1',[id]);
const allow=async(ids:string[],cap=ids.length)=>db.query("update private.dish_image_settings set launches_enabled=true,project_url='https://fixture.supabase.co',allowed_dish_ids=$1,remaining_launches=$2",[ids,cap]);
const stored=async(path:string)=>db.query("insert into storage.objects(bucket_id,name) values('dish-images',$1)",[path]);

beforeAll(async()=>{
 db=await dishDatabase();
 await db.exec(`create schema cron;
 create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text references storage.buckets(id),name text,primary key(bucket_id,name));
 alter table storage.objects enable row level security;`);
 await db.exec(migration('20261125141350_classify_saved_menus_with_ai.sql'));
 await db.exec(migration('20261127132010_shared_main_dish_images.sql'));
 await db.exec(migration('20261127134409_automate_main_dish_images.sql'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>db.exec(`begin;
 select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);`));
afterEach(async()=>db.exec('rollback'));

async function publish(main:string|null,type:string,org=ORG){
 const est=crypto.randomUUID(), run=crypto.randomUUID(), place=crypto.randomUUID(), scope='establishment:'+est;
 const names=main?[main,'Gỏi cuốn']:['Gỏi cuốn'];
 const result={specialty:main?{name:main,rows:[1]}:null,restaurant_type:{value:type},
  items:names.map((name,i)=>({name,row:i+1,kind:'dish'}))};
 await db.query('insert into public.establishments(id,name,organization_id,place_id) values($1,$2,$3,$4)',[est,'Fixture',org,place]);
 await db.query(`insert into private.menu_dish_ai_runs(id,place_id,fingerprint,model,contract,packet,status,result)
  values($1,$2,'fixture','mock','menu-dish-ai-v10','{}','succeeded',$3)`,[run,place,result]);
 await db.query(`insert into private.menu_dish_ai_targets(scope,establishment_id,source_run,source_raw,run_id)
  values($1,$2,$3,$4,$5)`,[scope,est,'source-'+run,JSON.stringify(names.map(name=>({name,placeId:place}))),run]);
 await db.query('select private.publish_menu_dish_ai($1)',[scope]);
 return query<string>('select specialty_id value from private.restaurant_dish_profiles where scope=$1',[scope]);
}

it('deduplicates successful publications across restaurants and rejects variants, other types and secondary-only dishes',async()=>{
 const primary=await publish('Bún bò','street_food');
 expect(await publish('Bun Bo','street_food',ORG2)).toBe(primary);
 await publish('Phở bò','street_food');
 await publish('Bánh căn','family_dining');
 await publish(null,'street_food');
 expect((await db.query('select dish_id,image_status from private.dish_images')).rows).toEqual([{dish_id:primary,image_status:'pending'}]);
 expect(await claim()).toBeNull();
});

it('serializes workers, consumes one authorization per attempt, and rechecks eligibility',async()=>{
 const first=await publish('Bún bò','street_food'), second=await publish('Bánh căn','street_food');
 await allow([first,second],1);
 const jobs=(await Promise.all([claim(),claim()])).filter(job=>job!==null);
 expect(jobs).toHaveLength(1);
 await stored(jobs[0].storage_path);
 expect(await finish(jobs[0])).toBe(true);
 expect(await claim()).toBeNull();
 const other=jobs[0].dish_id===first?second:first;
 await db.query('update private.restaurant_dishes set enabled=false where dish_id=$1',[other]);
 await allow([other]);
 expect(await claim()).toBeNull();
 expect(await row(other)).toMatchObject({image_status:'pending',started_at:null});
});

it('passes one simulated image through the worker for two restaurants with the same main dish',async()=>{
 const id=await publish('Bún bò','street_food');
 await publish('Bún bò','street_food',ORG2);
 await allow([id]);
 const webp=Buffer.from('UklGRiIAAABXRUJQVlA4TBYAAAAvAAAAEAcQ/Y/+ByKi/7YBAPwAoJZR','base64');
 const usage={input_tokens:120,output_tokens:823};
 const network=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[{b64_json:webp.toString('base64')}],usage}));
 const work=()=>processDishImage({claim,generate:name=>generateDishImage(name,'mock-key',network),
  upload:async(path,bytes)=>{expect(Buffer.from(bytes)).toEqual(webp);await stored(path);},finish});
 expect(await work()).toEqual({claimed:1,recorded:true});
 expect(await work()).toEqual({claimed:0});
 expect(network).toHaveBeenCalledTimes(1);
 const [url,options]=network.mock.calls[0];
 expect(url).toBe('https://api.openai.com/v1/images/generations');
 expect(JSON.parse(String(options?.body))).toMatchObject({model:DISH_IMAGE_MODEL,n:1,size:'1024x1024',quality:'low',output_format:'webp',prompt:expect.stringContaining('Bún bò')});
 const image=await row(id);
 expect(image).toMatchObject({image_status:'ready',image_source:'ai_generated',prompt_version:'dish-image-v1',
  generation_receipt:{prompt:expect.stringContaining('matte charcoal background'),model:DISH_IMAGE_MODEL,usage,
   quality:'low',webp_bytes:webp.length,generation_ms:expect.any(Number)},
  image_url:expect.stringMatching(/^https:\/\/fixture[.]supabase[.]co\/storage\/v1\/object\/public\/dish-images\//)});
});

it('reconciles an uploaded file after a crash without another generation, including when paused',async()=>{
 const id=await publish('Bánh căn','street_food');
 await allow([id]);
 const job=(await claim())!;
 await stored(job.storage_path);
 await db.exec("update private.dish_images set lease_until=now()-interval '1 second'; update private.dish_image_settings set launches_enabled=false;");
 expect(await claim()).toBeNull();
 expect(await row(id)).toMatchObject({image_status:'ready',image_storage_path:job.storage_path});
});

it('keeps the old picture while regenerating and never repeats an uncertain attempt',async()=>{
 const id=await publish('Bánh căn','street_food');
 await allow([id],2);
 const original=(await claim())!;
 await stored(original.storage_path);
 await finish(original);
 const regenerate=()=>query<boolean>('select private.regenerate_dish_image($1,$2) value',[id,original.generation_id]);
 expect(await regenerate()).toBe(true);
 expect(await regenerate()).toBe(false);
 expect(await row(id)).toMatchObject({image_status:'pending',image_storage_path:original.storage_path});
 const replacement=(await claim())!;
 expect(replacement.generation_id).not.toBe(original.generation_id);
 expect(await finish(original)).toBe(false);
 await db.exec("update private.dish_images set lease_until=now()-interval '1 second'");
 await allow([id]);
 expect(await claim()).toBeNull();
 expect(await row(id)).toMatchObject({image_status:'failed',last_error:'DISH_IMAGE_OUTCOME_UNKNOWN',image_storage_path:original.storage_path});
 expect(await query('select private.regenerate_dish_image($1,$2) value',[id,replacement.generation_id])).toBe(false);
});

it('automatically handles newly published street-food specialties and never requeues a ready dish',async()=>{
 await db.exec("update private.dish_image_settings set automatic_enabled=true, launches_enabled=true, project_url='https://fixture.supabase.co'");
 const id=await publish('Bún bò','street_food');
 expect(await publish('Bun Bo','street_food',ORG2)).toBe(id);
 await publish('Bánh căn','family_dining');
 const jobs=(await Promise.all([claim(),claim()])).filter(job=>job!==null);
 expect(jobs.map(job=>job.dish_id)).toEqual([id]);
 await stored(jobs[0].storage_path);
 await finish(jobs[0]);
 const saved=await row(id);
 expect(await publish('Bún bò','street_food',ORG2)).toBe(id);
 expect(await row(id)).toEqual(saved);
 expect(await claim()).toBeNull();
 await db.exec('update private.dish_image_settings set launches_enabled=false');
 const queued=await publish('Bún thịt nướng','street_food');
 expect(await claim()).toBeNull();
 await db.exec('update private.dish_image_settings set launches_enabled=true');
 expect((await claim())?.dish_id).toBe(queued);
});

it('retains the measured cost and original receipt through explicit regeneration and records uncertain attempts',async()=>{
 await db.exec("update private.dish_image_settings set automatic_enabled=true, launches_enabled=true, project_url='https://fixture.supabase.co'");
 const id=await publish('Bún bò','street_food');
 const job=(await claim())!;
 const receipt={model:DISH_IMAGE_MODEL,quality:'low',generation_ms:12123,webp_bytes:149698,
  usage:{input_tokens_details:{text_tokens:150,image_tokens:0},output_tokens_details:{image_tokens:824,text_tokens:0}}};
 await stored(job.storage_path);
 expect(await finish(job,null,receipt)).toBe(true);
 expect(await query('select private.regenerate_dish_image($1,$2) value',[id,job.generation_id])).toBe(true);
 const replacement=(await claim())!;
 expect(await finish(replacement,'DISH_IMAGE_OUTCOME_UNKNOWN')).toBe(true);
 const history=(await db.query(`select generation_id,status,model,generation_ms,webp_bytes,usage,estimated_usd,error_code
  from private.dish_image_attempts where dish_id=$1`,[id])).rows;
 expect(history).toHaveLength(2);
 const published=history.find(a=>a.generation_id===job.generation_id)!;
 expect(published).toMatchObject({status:'ready',model:DISH_IMAGE_MODEL,generation_ms:12123,webp_bytes:149698,usage:receipt.usage});
 expect(Number(published.estimated_usd)).toBeCloseTo(0.02547,10);
 expect(history.find(a=>a.generation_id===replacement.generation_id)).toMatchObject({status:'failed',estimated_usd:null,error_code:'DISH_IMAGE_OUTCOME_UNKNOWN'});
 expect(await claim()).toBeNull();
 expect(await row(id)).toMatchObject({image_storage_path:job.storage_path});
 expect(await query('select count(*)::int value from private.menu_dish_ai_targets where published_id is not null')).toBe(1);
});

it('leaves bucket writes and worker RPCs unavailable to application roles',async()=>{
 for(const role of ['anon','authenticated']){
  expect(await query("select has_function_privilege($1,'public.claim_dish_image()','EXECUTE') value",[role])).toBe(false);
  expect(await query("select has_table_privilege($1,'private.dish_images','SELECT') value",[role])).toBe(false);
  expect(await query("select has_table_privilege($1,'private.dish_image_attempts','SELECT') value",[role])).toBe(false);
 }
 expect(await query("select count(*)::int value from pg_policies where schemaname='storage' and policyname like 'dish_images_server_%' and permissive='RESTRICTIVE'")).toBe(3);
});
