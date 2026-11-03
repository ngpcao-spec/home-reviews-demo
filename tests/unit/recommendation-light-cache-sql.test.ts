// @vitest-environment node
import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
it('isolates persistent light sheets by tenant, restricts writes to server, and leaves business/attempt/grant data untouched',async()=>{
 const db=new PGlite();await db.waitReady;
 const org='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',est='00000000-0000-4000-8000-000000000003',user='00000000-0000-4000-8000-000000000004';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create function auth.uid() returns uuid language sql stable as $$select '${user}'::uuid$$;
   grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
   create table organizations(id uuid primary key);create table establishments(id uuid primary key,organization_id uuid);
   create table organization_members(organization_id uuid,user_id uuid,role text);
   grant select on establishments,organization_members to authenticated;
   insert into organizations values('${org}'),('${other}');insert into establishments values('${est}','${org}');
   insert into organization_members values('${org}','${user}','manager');`);
  const migration=readFileSync('supabase/migrations/20261103003249_recommendation_light_sheets_cache.sql','utf8');
  expect(migration).not.toMatch(/update public\.(restaurant_recommendation_sheets|current_report_publications)|recommendation_ai_attempts|diagnostic_trials|cron\./);
  await db.exec(migration);
  const insert=`insert into recommendation_light_sheet_cache values('${org}','${est}','fr','recommendation-light-v1','${'a'.repeat(64)}','{"id":"${est}"}')`;
  await db.exec('set role service_role');await db.exec(insert);await db.exec('reset role');
  await db.exec('set role authenticated');expect((await db.query('select * from recommendation_light_sheet_cache')).rows).toHaveLength(1);
  await expect(db.exec(`update recommendation_light_sheet_cache set source_sha256='${'b'.repeat(64)}'`)).rejects.toThrow(/permission denied/);
  await expect(db.exec(insert)).rejects.toThrow(/permission denied/);await db.exec('reset role');
  await db.exec(`update organization_members set role='viewer'`);await db.exec('set role authenticated');expect((await db.query('select * from recommendation_light_sheet_cache')).rows).toHaveLength(0);await db.exec('reset role');
  await db.exec(`update organization_members set role='manager',organization_id='${other}'`);await db.exec('set role authenticated');expect((await db.query('select * from recommendation_light_sheet_cache')).rows).toHaveLength(0);await db.exec('reset role');
  await db.exec('set role anon');await expect(db.query('select * from recommendation_light_sheet_cache')).rejects.toThrow(/permission denied/);await db.exec('reset role');
  await db.exec(`delete from establishments where id='${est}'`);expect((await db.query('select * from recommendation_light_sheet_cache')).rows).toHaveLength(0);
 }finally{await db.close();}
},30000);
