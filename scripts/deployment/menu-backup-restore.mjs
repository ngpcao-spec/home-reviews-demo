// One deployment backup. Production is accessed only by a read-only snapshot
// and pg_dump. Restore and migration rehearsals target a network-isolated DB.
import {mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash, randomBytes, publicEncrypt, createCipheriv, createDecipheriv} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root = process.env.RUNNER_TEMP;
assert(root && root.startsWith('/home/runner/'), 'GITHUB_EPHEMERAL_RUNNER_REQUIRED');
const dir = join(root, 'menu-database-backup');
const delivery = join(root, 'menu-backup-delivery');
mkdirSync(dir,{recursive:true,mode:0o700});
mkdirSync(delivery,{recursive:true,mode:0o700});
const receiptPath=join(dir,'receipt.json');
const receipt=existsSync(receiptPath)?JSON.parse(readFileSync(receiptPath,'utf8')):{project:'ihuztjkblywzjdruusdj',commit:process.env.GITHUB_SHA,created_at:new Date().toISOString(),production_writes:false,paid_provider_calls:0};
const save=()=>writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const hash=b=>createHash('sha256').update(b).digest('hex');
function run(cmd,args,options={},logName='command'){
 const r=spawnSync(cmd,args,{encoding:'utf8',timeout:600000,maxBuffer:32*1024*1024,...options});
 if(r.status!==0){writeFileSync(join(dir,logName+'.private.log'),String(r.stderr??'')+'\n'+String(r.stdout??''));throw Error(logName+'_FAILED_'+(r.status??r.error?.code));}
 return r.stdout;
}
const tablesSql=`select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not like 'pg_%' and n.nspname <> 'information_schema' and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.refclassid='pg_extension'::regclass and d.deptype='e') order by 1,2`;
const fingerprint=t=>`select json_build_object('schema',${literal(t.schema)},'name',${literal(t.name)},'rows',count(*),'md5',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))) value from ${quote(t.schema)}.${quote(t.name)} t`;
const menuFingerprint=`select jsonb_build_object('jobs',(select jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg(md5(jsonb_build_object('id',id,'establishment_id',establishment_id,'place_id',place_id,'request_id',request_id,'run_id',run_id,'raw',raw,'result',result,'created_at',created_at)::text),'' order by id),''))) from public.rainminer_menu_jobs),'shared',(select jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(v)::text),'' order by restaurant_id,run_id),''))) from private.shared_restaurant_menu_versions v)) value`;
async function backup(){
 const config=JSON.parse(process.env.MENU_BACKUP_DB||'{}');
 for(const key of ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE'])assert(typeof config[key]==='string'&&config[key], 'BACKUP_CONNECTION_MISSING');
 assert(config.PGHOST.endsWith('.supabase.com')||config.PGHOST.endsWith('.supabase.co'),'HOST_RESTRICTED');
 assert(config.PGDATABASE==='postgres'&&config.PGUSER.includes('cli_login_postgres'),'TEMPORARY_CLI_LOGIN_REQUIRED');
 const require=createRequire(join(root,'backup-tools/package.json'));
 const {Client}=require('pg');
 const ca=readFileSync('scripts/deployment/supabase-root.crt','utf8');
 writeFileSync(join(dir,'supabase-root.crt'),ca);
 const db=new Client({host:config.PGHOST,port:Number(config.PGPORT),user:config.PGUSER,password:config.PGPASSWORD,database:config.PGDATABASE,ssl:{ca,rejectUnauthorized:true},options:'-c default_transaction_read_only=on',connectionTimeoutMillis:20000});
 await db.connect();
 try{
  await db.query('begin isolation level repeatable read read only');
  await db.query('set local role postgres');
  const state=(await db.query("select current_setting('transaction_read_only') readonly,current_setting('server_version') version,pg_export_snapshot() snapshot")).rows[0];
  assert.equal(state.readonly,'on');assert(state.version.startsWith('17.'));
  receipt.snapshot_at=new Date().toISOString();receipt.database_version=state.version;
  const pre=(await db.query("select count(*) filter(where status in ('queued','starting','running','unknown'))::int active,count(*)::int total from public.rainminer_menu_jobs")).rows[0];
  assert.equal(pre.active,0,'ACTIVE_MENU_RUN');
  assert.equal((await db.query("select active from cron.job where jobname='home-reviews-rainminer-menu'")).rows[0].active,false,'MENU_CRON_NOT_PAUSED');
  const env={...process.env,...config,PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'20',PGOPTIONS:'-c default_transaction_read_only=on'};
  const envArgs=Object.keys(config).map(k=>['-e',k]).flat();
  // Supabase's official CA, with full certificate AND hostname verification.
  env.PGSSLROOTCERT='/backup/supabase-root.crt';
  run('docker',['run','--rm','--network=host',...envArgs,'-e','PGSSLMODE','-e','PGSSLROOTCERT','-e','PGCONNECT_TIMEOUT','-e','PGOPTIONS','-v',dir+':/backup','postgres:17','pg_dump','--format=custom','--role=postgres','--lock-wait-timeout=5s','--snapshot='+state.snapshot,'--file=/backup/database.dump'],{env},'pg_dump');
  const tables=(await db.query(tablesSql)).rows;
  const fingerprints=[];
  for(const t of tables)fingerprints.push((await db.query(fingerprint(t))).rows[0].value);
  const roles=(await db.query("select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname not like 'pg_%' order by rolname")).rows;
  const memberships=(await db.query('select r.rolname role,m.rolname member,a.admin_option from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member order by 1,2')).rows;
  writeFileSync(join(dir,'roles-without-passwords.json'),JSON.stringify({roles,memberships},null,2));
  writeFileSync(join(dir,'table-fingerprints.json'),JSON.stringify(fingerprints,null,2));
  writeFileSync(join(dir,'menu-fingerprint.json'),JSON.stringify((await db.query(menuFingerprint)).rows[0].value));
  await db.query('commit');
  run('docker',['run','--rm','--network=none','-v',dir+':/backup','postgres:17','pg_restore','--list','/backup/database.dump'],{},'archive_list');
  receipt.backup={format:'PostgreSQL custom full database; database role passwords excluded',bytes:statSync(join(dir,'database.dump')).size,sha256:hash(readFileSync(join(dir,'database.dump'))),tables_verified:tables.length,rows:fingerprints.reduce((s,t)=>s+Number(t.rows),0),menu_jobs:pre.total};
  save();console.log('READ_ONLY_DATABASE_BACKUP_COMPLETED');
 }finally{await db.end();}
}
function restore(){
 const container='supabase_db_menu-restore-isolated';
 const inspect=JSON.parse(run('docker',['inspect',container]))[0];
 assert.equal(Object.keys(inspect.NetworkSettings.Networks).length,0,'RESTORE_NETWORK_MUST_BE_DISCONNECTED');
 const psql=(sql,db='menu_restore',name='restore_sql')=>run('docker',['exec','-i',container,'psql','-X','-q','-t','-A','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'],{input:sql},name).trim();
 assert.equal(psql("select current_setting('cron.launch_active_jobs')",'postgres'),'off');
 assert.equal(psql("select current_setting('cron.database_name')",'postgres'),'menu_restore');
 assert.equal(psql("select count(*) from pg_database where datname='menu_restore'",'postgres'),'0');
 psql('create database menu_restore template template0;','postgres','create_isolated_database');
 const {roles}=JSON.parse(readFileSync(join(dir,'roles-without-passwords.json')));
 const existing=JSON.parse(psql('select json_agg(rolname) from pg_roles','postgres'));
 for(const role of roles)if(!existing.includes(role.rolname))psql('create role '+quote(role.rolname)+' nologin;','postgres','create_isolated_owner_role');
 run('docker',['cp',join(dir,'database.dump'),container+':/tmp/menu-database.dump']);
 run('docker',['exec',container,'pg_restore','--exit-on-error','--no-tablespaces','-U','supabase_admin','-d','menu_restore','/tmp/menu-database.dump'],{},'pg_restore');
 const expected=JSON.parse(readFileSync(join(dir,'table-fingerprints.json')));
 for(const t of expected){const actual=JSON.parse(psql(fingerprint(t)));assert.deepEqual(actual,t,'TABLE_RESTORE_MISMATCH_'+t.schema+'.'+t.name);}
 const menuBefore=JSON.parse(readFileSync(join(dir,'menu-fingerprint.json')));
 assert.deepEqual(JSON.parse(psql(menuFingerprint)),menuBefore);
 receipt.restore={verified:true,network_disconnected:true,cron_launch_active_jobs:'off',tables_verified:expected.length,completed_at:new Date().toISOString()};save();
 for(const file of ['20261124030622_automatic_rainminer_menu_queue.sql','20261124035425_rainminer_menu_five_dollar_release_guard.sql'])psql(readFileSync('supabase/migrations/'+file,'utf8'),'menu_restore','migration_'+file.slice(0,14));
 assert.deepEqual(JSON.parse(psql(menuFingerprint)),menuBefore,'MENU_DATA_CHANGED');
 const changed=[];
 for(const t of expected){if(t.schema==='cron'||(t.schema==='public'&&t.name==='rainminer_menu_jobs'))continue;const a=JSON.parse(psql(fingerprint(t)));if(a.rows!==t.rows||a.md5!==t.md5)changed.push(t.schema+'.'+t.name);}
 assert.deepEqual(changed,[],'UNRELATED_DATA_CHANGED');
 const config=JSON.parse(psql("select jsonb_build_object('automatic_enabled',automatic_enabled,'launches_enabled',launches_enabled,'budget_limit_usd',budget_limit_usd,'per_run_limit_usd',per_run_limit_usd,'configured_at',configured_at,'billing_ceiling_evidence',billing_ceiling_evidence,'first_test_job_id',first_test_job_id) from private.rainminer_menu_config where singleton"));
 assert.deepEqual(config,{automatic_enabled:false,launches_enabled:false,budget_limit_usd:5,per_run_limit_usd:0.5,configured_at:null,billing_ceiling_evidence:null,first_test_job_id:null});
 receipt.rehearsal={migrations:['20261124030622','20261124035425'],config,unrelated_tables_unchanged:true,menu_raw_and_shared_versions_unchanged:true};save();console.log('BACKUP_RESTORED_AND_TWO_MIGRATIONS_VERIFIED');
}
function encrypt(){
 save();
 if(!existsSync(join(dir,'database.dump')))throw Error('NO_DATABASE_BACKUP_TO_SAVE');
 const archive=join(root,'menu-backup.tar');run('tar',['-cf',archive,'-C',dir,'.']);
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(readFileSync(archive)),cipher.final()]);
 const sealed=publicEncrypt({key:readFileSync('scripts/deployment/menu-backup-public.pem'),oaepHash:'sha256'},key);
 writeFileSync(join(delivery,'supabase-before-menu-deploy.enc'),Buffer.concat([Buffer.from('HRB1'),iv,cipher.getAuthTag(),Buffer.from([sealed.length>>8,sealed.length&255]),sealed,encrypted]));
 writeFileSync(join(delivery,'receipt.json'),JSON.stringify({...receipt,encrypted_backup_sha256:hash(readFileSync(join(delivery,'supabase-before-menu-deploy.enc')))},null,2));
 console.log('ENCRYPTED_BACKUP_READY');
}
function unpack(){
 const source=join(root,'source-encrypted-backup');
 const previous=JSON.parse(readFileSync(join(source,'receipt.json'),'utf8'));
 assert.equal(previous.project,'ihuztjkblywzjdruusdj');
 const data=readFileSync(join(source,'supabase-before-menu-deploy.enc'));
 assert.equal(hash(data),previous.encrypted_backup_sha256);
 assert.equal(data.subarray(0,4).toString(),'HRB1');
 const key=Buffer.from(process.env.MENU_RESTORE_KEY||'','base64');assert.equal(key.length,32,'RESTORE_KEY_MISSING');
 const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(4,16));decipher.setAuthTag(data.subarray(16,32));
 const tar=Buffer.concat([decipher.update(data.subarray(34+data.readUInt16BE(32))),decipher.final()]);
 run('tar',['-xf','-','-C',dir],{input:tar},'unpack_backup');
 assert.equal(hash(readFileSync(join(dir,'database.dump'))),previous.backup.sha256);
 Object.assign(receipt,previous,{source_backup_run:45340614932,restore_commit:process.env.GITHUB_SHA});delete receipt.failure;
 save();console.log('EXISTING_BACKUP_AUTHENTICATED_AND_DECRYPTED_NO_PRODUCTION_ACCESS');
}
try{
 const mode=process.argv[2];if(mode==='backup')await backup();else if(mode==='restore')restore();else if(mode==='encrypt')encrypt();else if(mode==='unpack')unpack();else throw Error('MODE_REQUIRED');
}catch(e){receipt.failure={stage:process.argv[2],code:e.code??e.name};save();console.error('BACKUP_GATE_FAILED',process.argv[2],e.code??e.name,String(e.message).replace(/postgres(?:ql)?:\/\/\S+/gi,'[CONNECTION_REDACTED]').slice(0,300));process.exitCode=1;}
