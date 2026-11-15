// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { processReviewNotifications, type PushReceipt, type ReviewNotification } from '../../supabase/functions/_shared/review-notification-worker'

let db: PGlite
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
const rpc = async <T>(name: string, args: unknown[]) => (await q<{ result: T }>(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args))[0].result
const add = (n: number, rating = 1, org = 1, historical = false) => q('insert into public.reviews(id,organization_id,establishment_id,rating,historical_import) values($1,$2,$3,$4,$5)', [id(n), id(org), id(org + 10), rating, historical])
const count = async (table = 'public.notifications') => (await q<{ n: number }>(`select count(*)::int n from ${table}`))[0].n
const claim = (n = 1000) => rpc<ReviewNotification | null>('claim_review_notification_delivery', [id(n)])
const success: PushReceipt = { sent: 1, failed: 0, skipped: false, attempted: 1, subscriptionCount: 1, providerStatusCodes: [201], expiredRemoved: 0 }
const ports = (send = vi.fn(async () => success)) => ({
  claim: (claimId: string) => rpc<ReviewNotification | null>('claim_review_notification_delivery', [claimId]),
  send,
  finish: (notificationId: string, claimId: string, state: string, receipt: PushReceipt | { error: string }) => rpc<boolean>('finish_review_notification_delivery', [notificationId, claimId, state, receipt]),
})

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('NETWORK_FORBIDDEN') }))
  db = new PGlite()
  await db.waitReady
  await db.exec(`
   create role anon; create role authenticated; create role service_role bypassrls;
   create schema private; create schema auth; create schema net; create schema vault; create schema cron;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table auth.users(id uuid primary key);
   create table public.organizations(id uuid primary key);
   create table public.establishments(id uuid primary key,organization_id uuid,name text,active boolean default true);
   create table public.organization_members(organization_id uuid,user_id uuid,created_at timestamptz default now()-interval '1 day');
   create table public.profiles(user_id uuid primary key,preferred_language text);
   create table public.reviews(id uuid primary key,organization_id uuid,establishment_id uuid,rating int not null,
    historical_import boolean not null default false,has_negative_feedback boolean,original_text text,created_at timestamptz default clock_timestamp());
   create table vault.decrypted_secrets(name text,decrypted_secret text);
   create table public.test_dispatch(url text);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$begin insert into public.test_dispatch values(url);return 1;end$$;
   create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
  `)
  // Use the existing notification table, grants and private read-state RLS unchanged.
  await db.exec(readFileSync('supabase/migrations/20260927130000_notifications_v1.sql', 'utf8').split('create table if not exists public.push_subscriptions')[0])
  await db.exec(readFileSync('supabase/migrations/20261115042449_restore_jev_review_notifications.sql', 'utf8'))
  await db.exec('grant usage on schema public,private,auth to service_role,authenticated; grant all on all tables in schema public,private to service_role;')
}, 30000)
beforeEach(async () => {
  await db.exec(`reset role; truncate public.notifications,public.reviews,public.organization_members,public.profiles,public.establishments,public.organizations,auth.users,public.test_dispatch cascade;
   update private.review_notification_runtime set enabled=true,activated_at=clock_timestamp()-interval '1 hour';`)
  for (const n of [1, 2]) {
    await q('insert into public.organizations values($1)', [id(n)])
    await q('insert into public.establishments(id,organization_id,name) values($1,$2,$3)', [id(n + 10), id(n), n === 1 ? 'TITO' : 'K.HOUSE'])
    await q('insert into auth.users values($1)', [id(n + 100)])
    await q('insert into public.profiles values($1,$2)', [id(n + 100), n === 1 ? 'vi' : 'fr'])
    await q('insert into public.organization_members(organization_id,user_id) values($1,$2)', [id(n), id(n + 100)])
  }
})
afterAll(async () => { await db.close(); vi.unstubAllGlobals() })

it('creates new 1–3 star alerts without an AI callback, in VI and FR, including textless reviews', async () => {
  await add(200, 1); await add(201, 2); await add(202, 3, 2)
  const rows = await q<{ title: string; user_id: string }>('select title,user_id from public.notifications order by review_id')
  expect(rows.map(r => r.title)).toEqual(['Đánh giá mới 1★ — TITO', 'Đánh giá mới 2★ — TITO', 'Nouvel avis 3★ — K.HOUSE'])
  expect(rows.map(r => r.user_id)).toEqual([id(101), id(101), id(102)])
  expect(await count('private.review_notification_deliveries')).toBe(3)
})
it('excludes historical imports, pre-activation reviews, inactive restaurants and 4/5 stars without confirmed negative feedback', async () => {
  await add(200, 1, 1, true); await add(201, 4); await add(202, 5)
  await q('update private.review_notification_runtime set activated_at=clock_timestamp()+interval \'1 day\'')
  await add(203)
  await db.exec("update private.review_notification_runtime set activated_at=clock_timestamp()-interval '1 hour'; update public.establishments set active=false")
  await add(204)
  expect(await count()).toBe(0)
})
it('creates one 4-star alert only after confirmed negative feedback; replays and text edits cannot duplicate it', async () => {
  await add(200, 4)
  expect(await count()).toBe(0)
  await q('update public.reviews set has_negative_feedback=true where id=$1', [id(200)])
  await q('update public.reviews set has_negative_feedback=true,original_text=$1 where id=$2', ['edited', id(200)])
  await q('update public.reviews set has_negative_feedback=false where id=$1', [id(200)])
  await q('update public.reviews set has_negative_feedback=true where id=$1', [id(200)])
  expect(await count()).toBe(1)
  expect((await q('select type from public.notifications'))[0].type).toBe('four_star_attention')
})
it('does not notify a new member about pre-membership reviews or an unrelated organization', async () => {
  await q("update public.organization_members set created_at=clock_timestamp()+interval '1 day' where organization_id=$1", [id(1)])
  await add(200)
  expect(await count()).toBe(0)
})
it('keeps shared review projections and read states separate in two organizations', async () => {
  await add(200); await add(201, 1, 2)
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${id(101)}';`)
  expect(await count()).toBe(1)
  await db.exec('update public.notifications set read_at=now(); reset role;')
  expect((await q('select count(*)::int n from public.notifications where read_at is null'))[0].n).toBe(1)
})
it('uses the existing uniqueness key so legacy AI completion cannot insert a second alert', async () => {
  await add(200)
  await db.exec("insert into public.notifications(organization_id,user_id,review_id,establishment_id,type,title,body) select organization_id,user_id,review_id,establishment_id,type,title,body from public.notifications on conflict(user_id,review_id,type) do nothing")
  expect(await count()).toBe(1)
  expect(await count('private.review_notification_deliveries')).toBe(1)
})
it('reserves a push once when two worker requests race', async () => {
  await add(200)
  const send = vi.fn(async () => success)
  await Promise.all([processReviewNotifications(ports(send)), processReviewNotifications(ports(send))])
  expect(send).toHaveBeenCalledTimes(1)
  expect((await q('select push_status from public.notifications'))[0].push_status).toBe('sent')
})
it('does not retry an uncertain external delivery', async () => {
  await add(200)
  const send = vi.fn(async (): Promise<PushReceipt> => { throw new Error('transport disconnected after acceptance') })
  await processReviewNotifications(ports(send)); await processReviewNotifications(ports(send))
  expect(send).toHaveBeenCalledTimes(1)
  expect((await q('select state from private.review_notification_deliveries'))[0].state).toBe('unknown')
})
it('keeps successful and failed deliveries terminal, including missing/expired subscriptions', async () => {
  await add(200); await add(201)
  const send = vi.fn().mockResolvedValueOnce({ ...success, sent: 0, skipped: true, attempted: 0, subscriptionCount: 0 }).mockResolvedValueOnce({ ...success, sent: 0, failed: 1, providerStatusCodes: [410], expiredRemoved: 1 })
  await processReviewNotifications(ports(send)); await processReviewNotifications(ports(send))
  expect(send).toHaveBeenCalledTimes(2)
  expect((await q('select state from private.review_notification_deliveries order by created_at')).map(r => r.state)).toEqual(['skipped', 'failed'])
})
it('never reclaims a delivery after worker interruption and rejects a late receipt', async () => {
  await add(200)
  const n = await claim()
  await db.exec("update private.review_notification_deliveries set claimed_at=now()-interval '6 minutes'")
  expect(await claim(1001)).toBeNull()
  expect(await rpc('finish_review_notification_delivery', [n!.id, id(1000), 'sent', success])).toBe(false)
  expect((await q('select push_error from public.notifications'))[0].push_error).toBe('DELIVERY_OUTCOME_UNKNOWN')
})
it('does not resend if receipt persistence fails after a successful push', async () => {
  await add(200)
  const p = ports()
  await expect(processReviewNotifications({ ...p, finish: async () => { throw new Error('DB unavailable') } })).rejects.toThrow('DB unavailable')
  await processReviewNotifications(p)
  expect(p.send).toHaveBeenCalledTimes(1)
})
it('checks membership, read state and active subscription again before push', async () => {
  await add(200); await add(201, 1, 2)
  await q('delete from public.organization_members where organization_id=$1', [id(1)])
  await q('update public.notifications set read_at=now() where organization_id=$1', [id(2)])
  expect(await claim()).toBeNull()
  expect((await q('select push_status from public.notifications')).map(r => r.push_status)).toEqual(['skipped', 'skipped'])
})
it('disabling the runtime stops creation, claims and dispatch without deleting existing data', async () => {
  await add(200)
  await db.exec('update private.review_notification_runtime set enabled=false')
  await add(201)
  expect(await claim()).toBeNull()
  await db.exec('select private.dispatch_review_notifications()')
  expect(await count()).toBe(1)
  expect(await count('public.test_dispatch')).toBe(0)
})
it('refuses authenticated client access to delivery reservations and receipts', async () => {
  await db.exec('set role authenticated')
  await expect(claim()).rejects.toThrow(/permission denied/)
  await expect(rpc('finish_review_notification_delivery', [id(300), id(1000), 'sent', success])).rejects.toThrow(/permission denied/)
})
