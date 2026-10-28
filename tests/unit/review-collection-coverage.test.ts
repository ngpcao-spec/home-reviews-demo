// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { normalizeApifyDataset } from '../../supabase/functions/_shared/apify'
import { prepareInitialReviews } from '../../supabase/functions/_shared/initial-import'
import { advanceInitialApify } from '../../supabase/functions/_shared/initial-import-apify'

const fixture = JSON.parse(readFileSync('tests/fixtures/initial-import-functions.json', 'utf8'))
const migration = readFileSync('supabase/migrations/' + readdirSync('supabase/migrations').find(n => n.endsWith('_review_collection_coverage_and_manual_retry.sql')), 'utf8')
const continuation = readFileSync('supabase/migrations/' + readdirSync('supabase/migrations').find(n => n.endsWith('_initial_import_immediate_continuation.sql')), 'utf8')
const org = '10000000-0000-4000-8000-000000000001', user = '20000000-0000-4000-8000-000000000001'
let db: PGlite
let historical: { id: string; est: string }
let small: { id: string; est: string }
const nativeTotals = new Map<string, unknown>()

async function savedRun(unique: number, total: unknown, status = 'running') {
  const id = crypto.randomUUID(), est = crypto.randomUUID(), run = crypto.randomUUID()
  nativeTotals.set(id, total)
  await db.query(`insert into public.establishments(id,organization_id,google_id,initial_import_job_id,active)
    values($1,$2,$3,$4,true)`, [est, org, est, id])
  await db.query(`insert into public.initial_import_jobs(id,organization_id,user_id,query,expected_google_id,establishment_id,
    status,reviews_target,reviews_fetched,reviews_inserted,locked_by,lease_until,provider_run_id,provider_dataset_id,
    provider_start_attempted_at,provider_status,provider_finished_at,provider_finished_observed_at,result,candidate_snapshot,finished_at)
    values($1,$2,$3,'synthetic',$4::text,$4::uuid,$5,150,$6,$6,'worker',now()+interval '5 minutes',$7,'dataset',
    now()-interval '10 seconds','SUCCEEDED',now(),now(),'{"importStatus":"completed"}',$8,now())`,
    [id, org, user, est, status, unique, run, { reviewCount: typeof total === 'number' ? total : 0 }])
  await db.query(`insert into public.establishment_snapshots(establishment_id,source_run_id,captured_at,raw_place_payload,total_reviews)
    values($1,$2,now(),$3,$4)`, [est, `initial-job:${id}:${status === 'completed' ? 'direct' : run}`,
    total === undefined ? {} : { reviewsCount: total }, Number.isFinite(Number(total)) ? Math.max(0, Math.trunc(Number(total))) : 0])
  await db.query(`insert into public.reviews(establishment_id,external_review_id)
    select $1,'review-'||n from generate_series(1,$2::integer) n`, [est, unique])
  return { id, est }
}

const finalize = async (id: string, est: string, inserted = 0) => (await db.query(`select public.finalize_initial_import_job(
  $1,'worker',$2,'newest',now(),now(),$3) ok`, [id, est, { inserted, reportedGoogleTotal: nativeTotals.get(id) }])).rows[0].ok
const retry = async (id: string) => (await db.query('select (public.retry_initial_import_job($1)).*', [id])).rows[0]
const restaurant = async (id: string) => (await db.query('select * from public.establishments where id=$1', [id])).rows[0]
async function reject(sql: string, args: unknown[], message: string) {
  await db.exec('savepoint rejected')
  await expect(db.query(sql, args)).rejects.toThrow(message)
  await db.exec('rollback to savepoint rejected')
}

beforeAll(async () => {
  db = new PGlite(); await db.waitReady
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema auth; create schema net; create schema vault;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.organizations(id uuid primary key,monitoring_interval_hours integer default 12);
    create table public.organization_members(organization_id uuid,user_id uuid,role text);
    create table public.establishments(id uuid primary key,organization_id uuid,google_id text,initial_import_job_id uuid,
      active boolean,initialized_at timestamptz,last_review_id text,last_review_at timestamptz,reporting_started_at timestamptz,
      last_sync_at timestamptz,next_sync_at timestamptz,sync_status text,sync_error text,last_sync_status text,last_sync_error text,updated_at timestamptz);
    create unique index restaurant_identity on public.establishments(organization_id,google_id);
    create table public.establishment_snapshots(establishment_id uuid,source_run_id text,captured_at timestamptz,raw_place_payload jsonb,total_reviews integer);
    create function private.sanitize_snapshot() returns trigger language plpgsql as $$begin new.raw_place_payload:='{}'; return new;end$$;
    create trigger retention_sanitize before insert or update on public.establishment_snapshots for each row execute function private.sanitize_snapshot();
    create table public.reviews(establishment_id uuid,external_review_id text,primary key(establishment_id,external_review_id));
    create table public.review_sync_jobs(id uuid primary key default gen_random_uuid(),establishment_id uuid,status text default 'queued',provider_start_attempted_at timestamptz,apify_run_id text);
    create function public.review_sync_spread_offset(uuid,integer) returns interval language sql as $$select interval '0 seconds'$$;
    create function private.is_org_member(p uuid) returns boolean language sql security definer as $$select exists(select 1 from public.organization_members where organization_id=p and user_id=auth.uid())$$;
    create table public.review_corpus_policy(id boolean,enabled boolean default true,paused boolean default false,ingestions_paused boolean default false,retired_relations text[] default '{}');
    insert into public.review_corpus_policy(id) values(true);
    create table public.review_sync_runtime_config(singleton boolean,provider_slot_count integer); insert into public.review_sync_runtime_config values(true,5);
    create table private.fake_net_calls(id bigint generated always as identity,url text,body jsonb);
    create table vault.decrypted_secrets(name text,decrypted_secret text); insert into vault.decrypted_secrets values('home_reviews_scheduler_token','SYNTHETIC');
    create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000)
      returns bigint language plpgsql as $$declare rid bigint;begin insert into private.fake_net_calls(url,body) values(url,body) returning id into rid;return rid;end$$;
    create table private.notices(job_id uuid);
    create function private.notify_initial_import_completed() returns trigger language plpgsql security definer as $$begin insert into private.notices values(new.id);return new;end$$;
    insert into public.organizations(id) values('${org}'); insert into public.organization_members values('${org}','${user}','owner');`)
  await db.exec('create table public.initial_import_jobs(' + fixture.columns.map((c: {name: string; type: string; default: string | null}) => '"' + c.name + '" ' + c.type + (c.default ? ' default ' + c.default : '')).join(',') + ',primary key(id))')
  await db.exec("create unique index import_one_active on public.initial_import_jobs(organization_id,expected_google_id) where status in('queued','running','retry')")
  for (const f of fixture.functions) await db.exec(f.definition + ';')
  await db.exec(`create trigger initial_import_completion_notification after update of status on public.initial_import_jobs
    for each row when(new.status='completed' and old.status is distinct from 'completed') execute function private.notify_initial_import_completed();
    grant usage on schema auth,private to authenticated,service_role; grant select on public.establishments,public.initial_import_jobs to authenticated;
    alter table public.establishments enable row level security; alter table public.initial_import_jobs enable row level security;
    create policy org_read on public.establishments for select to authenticated using(private.is_org_member(organization_id));
    create policy job_read on public.initial_import_jobs for select to authenticated using(user_id=auth.uid() and private.is_org_member(organization_id));`)
  await db.exec(continuation)
  historical = await savedRun(5, 1717, 'completed')
  small = await savedRun(5, 5, 'completed')
  await db.exec(migration)
}, 30000)
beforeEach(async () => { await db.exec('begin'); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]) })
afterEach(() => db.exec('rollback'))
afterAll(() => db.close())

it('backfills the saved 5/150 case, leaves a real 5/5 complete, dispatches nothing and preserves reviews', async () => {
  expect(await restaurant(historical.est)).toMatchObject({ review_collection_status: 'partial', review_collection_expected: 150, review_collection_unique: 5, next_sync_at: null, active: true })
  expect(await restaurant(small.est)).toMatchObject({ review_collection_status: 'complete', review_collection_expected: 5, review_collection_unique: 5 })
  expect((await db.query('select count(*)::int n from private.fake_net_calls')).rows[0].n).toBe(0)
  expect((await db.query('select count(*)::int n from public.reviews')).rows[0].n).toBe(10)
})

it('a native SUCCEEDED run with duplicate rows is partial using unique collected IDs, regardless of stored/new INSERT counts', async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ reviewId: 'unique-' + i % 5, stars: 5, cid: 'synthetic', reviewsCount: 1717, publishedAtDate: '2026-01-01T00:00:00Z', text: i % 2 ? '' : 'Original' }))
  const normalized = normalizeApifyDataset(items, 'https://www.google.com/maps?cid=synthetic')
  const reviews = prepareInitialReviews(normalized.reviews)
  expect(reviews).toHaveLength(5)
  let starts = 0
  const result = await advanceInitialApify({ provider_run_id: 'known-run', provider_dataset_id: 'known-dataset' }, {
    acquire: async () => true, release: async () => {}, reserveStart: async () => true,
    start: async () => { starts++; throw Error('UNAUTHORIZED_TEST_START') }, saveRun: async () => {},
    get: async () => ({ runId: 'known-run', datasetId: 'known-dataset', status: 'SUCCEEDED' }), finished: async () => {},
    retrieve: async () => { const j = await savedRun(reviews.length, 1717); await finalize(j.id, j.est, 150); return restaurant(j.est) },
    defer: async () => { throw Error('UNEXPECTED_DEFER') },
  })
  expect(result).toMatchObject({ review_collection_status: 'partial', review_collection_unique: 5, review_collection_expected: 150, next_sync_at: null })
  expect(starts).toBe(0)
  expect((await db.query('select count(*)::int n from private.notices')).rows[0].n).toBe(0)
  expect((await db.query('select * from public.claim_initial_import_jobs(\'cron\',5,240,2)')).rows).toHaveLength(0)
})

it.each([[5, 5], [100, 100], [150, 2000]])('finishes %i unique reviews for a Google total of %i, even with zero newly inserted', async (unique, total) => {
  const j = await savedRun(unique, total)
  expect(await finalize(j.id, j.est, 0)).toBe(true)
  expect(await restaurant(j.est)).toMatchObject({ review_collection_status: 'complete', review_collection_expected: Math.min(150, total), review_collection_unique: unique })
  expect((await restaurant(j.est)).next_sync_at).not.toBeNull()
})

it.each([null, undefined, -1, 2.5, 'not a count', 0])('does not invent a reliable total from %s when five reviews were collected', async total => {
  const j = await savedRun(5, total); await finalize(j.id, j.est)
  expect(await restaurant(j.est)).toMatchObject({ review_collection_status: 'unknown', review_collection_expected: null })
})

it('two simultaneous manual requests join one new attempt for the same restaurant and preserve the five saved reviews and consumed receipt', async () => {
  const before = (await db.query('select count(*)::int n from public.establishments')).rows[0].n
  const [a, b] = await Promise.all([retry(historical.id), retry(historical.id)])
  expect(a.id).toBe(b.id); expect(a.status).toBe('queued')
  const row = (await db.query('select * from public.initial_import_jobs where id=$1', [historical.id])).rows[0]
  expect(row.provider_attempt_history).toHaveLength(1)
  expect(row.provider_attempt_history).toMatchObject([{ status: 'SUCCEEDED', reviews_fetched: 5, result: { collection: { status: 'partial' } } }])
  expect(row.provider_run_id).toBeNull(); expect(row.provider_start_attempted_at).toBeNull()
  expect(row.reviews_fetched).toBe(0)
  expect(await restaurant(historical.est)).toMatchObject({ active: true, review_collection_status: 'retrying', next_sync_at: null })
  expect((await db.query('select count(*)::int n from public.establishments')).rows[0].n).toBe(before)
  expect((await db.query('select count(*)::int n from public.reviews where establishment_id=$1', [historical.est])).rows[0].n).toBe(5)
  expect((await db.query('select count(*)::int n from private.fake_net_calls')).rows[0].n).toBe(1)
})

it('preserves data and restores the alert after a failed manual attempt, without an automatic fresh collection', async () => {
  await retry(historical.id)
  await db.query("update public.initial_import_jobs set status='failed',provider_start_attempted_at=now(),provider_run_id=null where id=$1", [historical.id])
  expect((await restaurant(historical.est)).review_collection_status).toBe('partial')
  await reject('select public.retry_initial_import_job($1)', [historical.id], 'APIFY_START_OUTCOME_UNKNOWN')
  expect((await db.query('select count(*)::int n from public.reviews where establishment_id=$1', [historical.est])).rows[0].n).toBe(5)
})

it('blocks normal sync for partial/retrying imports and rejects manual recollection while another sync is pending', async () => {
  expect((await db.query('insert into public.review_sync_jobs(establishment_id) values($1) returning id', [historical.est])).rows).toHaveLength(0)
  await retry(historical.id)
  expect((await db.query('insert into public.review_sync_jobs(establishment_id) values($1) returning id', [historical.est])).rows).toHaveLength(0)
  const j = await savedRun(5, 1717); await finalize(j.id, j.est)
  await db.query("update public.establishments set review_collection_status='complete' where id=$1", [j.est])
  await db.query('insert into public.review_sync_jobs(establishment_id) values($1)', [j.est])
  await reject('select public.retry_initial_import_job($1)', [j.id], 'REVIEW_COLLECTION_BUSY')
})

it('refuses a fresh attempt for a complete restaurant or an unconfirmed terminal outcome', async () => {
  await reject('select public.retry_initial_import_job($1)', [small.id], 'IMPORT_JOB_NOT_RETRYABLE')
  await db.query('update public.initial_import_jobs set provider_finished_observed_at=null where id=$1', [historical.id])
  await reject('select public.retry_initial_import_job($1)', [historical.id], 'IMPORT_RESULT_NOT_CONFIRMED')
})

it('allows only the authorized account and organization; keeps helper functions private', async () => {
  expect((await db.query(`select has_function_privilege('anon','public.retry_initial_import_job(uuid)','execute') retry,
    has_function_privilege('authenticated','public.finalize_initial_import_job(uuid,text,uuid,text,timestamptz,timestamptz,jsonb)','execute') finalize`)).rows[0])
    .toEqual({ retry: false, finalize: false })
  await db.exec('set local role authenticated')
  expect((await db.query('select id from public.establishments where id=$1', [historical.est])).rows).toHaveLength(1)
  await db.exec('reset role')
  const foreignUser=crypto.randomUUID(), foreignOrg=crypto.randomUUID()
  await db.query('insert into public.organization_members values($1,$2,\'owner\')',[foreignOrg,foreignUser])
  await db.exec('set local role authenticated')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [foreignUser])
  expect((await db.query('select id from public.establishments')).rows).toHaveLength(0)
  await reject('select public.retry_initial_import_job($1)', [historical.id], 'IMPORT_JOB_NOT_RETRYABLE')
  await reject("select private.initial_review_collection_coverage('1717',5)", [], 'permission denied')
})
