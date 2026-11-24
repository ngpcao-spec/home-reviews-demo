begin;

create table public.helpeat_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  locale text not null default 'vi' check (locale in ('vi', 'fr')),
  zone text not null default '' check (char_length(zone) <= 150)
);

create table public.helpeat_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meal_date date not null check (isfinite(meal_date)),
  meal_slot text not null check (meal_slot in ('breakfast', 'lunch', 'dinner')),
  status text not null check (status in ('confirmed', 'planned')),
  unique (user_id, meal_date, meal_slot),
  unique (id, user_id)
);

create table public.helpeat_meal_items (
  meal_id uuid not null,
  user_id uuid not null default auth.uid(),
  position smallint not null check (position between 1 and 12),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  primary key (meal_id, position),
  foreign key (meal_id, user_id) references public.helpeat_meals(id, user_id) on delete cascade
);

create index helpeat_meal_items_owner_idx on public.helpeat_meal_items (user_id, meal_id);

create table public.helpeat_notification_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  breakfast time(0) not null default '06:00',
  lunch time(0) not null default '10:00',
  dinner time(0) not null default '16:30'
);

create function public.helpeat_google_user()
returns uuid language sql stable security invoker set search_path = ''
as $$
  select auth.uid() from (select auth.jwt() as token) jwt
  where token->'amr' @> '[{"method":"oauth"}]'::jsonb
    and (token->'app_metadata'->>'provider' = 'google'
      or token->'app_metadata'->'providers' @> '["google"]'::jsonb);
$$;

revoke all on function public.helpeat_google_user() from public, anon, authenticated;
grant execute on function public.helpeat_google_user() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'helpeat_profiles', 'helpeat_meals', 'helpeat_meal_items', 'helpeat_notification_settings'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format(
      'create policy helpeat_owner on public.%I for all to authenticated
        using (user_id = (select public.helpeat_google_user()))
        with check (user_id = (select public.helpeat_google_user()))', table_name);
  end loop;
end;
$$;

create function public.helpeat_save_meal(p_date date, p_slot text, p_status text, p_dishes text[])
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  owner_id uuid := public.helpeat_google_user();
  stored_meal_id uuid;
  today date := (statement_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if owner_id is null then raise exception 'signInRequired' using errcode = '42501'; end if;
  if p_date is null or not isfinite(p_date) or
     p_slot is null or p_slot not in ('breakfast', 'lunch', 'dinner') or
     p_status is null or p_status not in ('confirmed', 'planned') or
     p_date > today + (case when p_status = 'planned' then 1 else 0 end) or
     coalesce(array_ndims(p_dishes), 0) <> 1 or cardinality(p_dishes) not between 1 and 12 or
     exists (select 1 from unnest(p_dishes) dish where dish is null or char_length(btrim(dish)) not between 1 and 100)
  then raise exception 'invalid' using errcode = '22023'; end if;

  insert into public.helpeat_meals as meal (user_id, meal_date, meal_slot, status)
  values (owner_id, p_date, p_slot, p_status)
  on conflict (user_id, meal_date, meal_slot) do update
    set status = excluded.status
    where meal.status = 'planned' or excluded.status = 'confirmed'
  returning id into stored_meal_id;

  if stored_meal_id is null then raise exception 'alreadyConfirmed'; end if;

  delete from public.helpeat_meal_items as item where item.meal_id = stored_meal_id and item.user_id = owner_id;
  insert into public.helpeat_meal_items (meal_id, user_id, position, name)
  select stored_meal_id, owner_id, item.position, btrim(item.name)
  from unnest(p_dishes) with ordinality as item(name, position);
  return stored_meal_id;
end;
$$;

create function public.helpeat_save_preferences(p_locale text, p_zone text, p_breakfast time, p_lunch time, p_dinner time)
returns void language plpgsql security invoker set search_path = ''
as $$
declare owner_id uuid := public.helpeat_google_user();
begin
  if owner_id is null then raise exception 'signInRequired' using errcode = '42501'; end if;
  if p_locale is null or p_locale not in ('fr', 'vi') or p_zone is null or char_length(p_zone) > 150
     or p_breakfast is null or p_lunch is null or p_dinner is null
     or p_breakfast >= time '24:00' or p_lunch >= time '24:00' or p_dinner >= time '24:00'
  then raise exception 'invalid' using errcode = '22023'; end if;

  insert into public.helpeat_profiles (user_id, locale, zone) values (owner_id, p_locale, btrim(p_zone))
  on conflict (user_id) do update set locale = excluded.locale, zone = excluded.zone;

  insert into public.helpeat_notification_settings (user_id, breakfast, lunch, dinner)
  values (owner_id, p_breakfast, p_lunch, p_dinner)
  on conflict (user_id) do update set breakfast = excluded.breakfast, lunch = excluded.lunch, dinner = excluded.dinner;
end;
$$;

create function public.helpeat_habits()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with confirmed as (
    select m.id, m.meal_slot, m.meal_date, item.position, item.name,
      regexp_replace(replace(lower(normalize(btrim(item.name), NFD)), 'đ', 'd'), '[̀-ͯ]', '', 'g') as dish_key
    from public.helpeat_meals m
    join public.helpeat_meal_items item on item.meal_id = m.id and item.user_id = m.user_id
    where m.user_id = (select public.helpeat_google_user()) and m.status = 'confirmed'
      and m.meal_date between (statement_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 179
      and (statement_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date
  ), classified as (
    select *, case
      when dish_key ~ '^(pho|bun|mi|mien|hu tieu)( |$)' then 'noodles'
      when dish_key ~ '^(com|xoi|chao)( |$)' then 'rice'
      when dish_key ~ '^(banh mi|sandwich)( |$)' then 'sandwich'
      when dish_key ~ '^(goi cuon|cha gio|nem|rouleaux)( |$)' then 'rolls'
      when dish_key ~ '^(canh|sup|soupe)( |$)' then 'soup'
    end as family
    from confirmed
  ), dish_counts as (
    select min(name) as name, count(distinct id) as count from confirmed group by dish_key
    order by count desc, min(name) limit 5
  ), family_counts as (
    select family, count(distinct id) as count from classified where family is not null
    group by family order by count desc, family limit 5
  ), meal_dishes as (
    select meal_slot, min(name) as name, count(distinct id) as count
    from confirmed group by meal_slot, dish_key
  ), recent as (
    select meal_date as date, meal_slot as meal, array_agg(name order by position) as dishes
    from confirmed group by id, meal_date, meal_slot
    order by meal_date desc, case meal_slot when 'dinner' then 3 when 'lunch' then 2 else 1 end desc
    limit 5
  )
  select jsonb_build_object(
    'dishes', coalesce((select jsonb_agg(row_to_json(d) order by count desc, name) from dish_counts d), '[]'::jsonb),
    'families', coalesce((select jsonb_agg(row_to_json(f) order by count desc, family) from family_counts f), '[]'::jsonb),
    'byMeal', (select jsonb_object_agg(slots.slot, coalesce((
      select jsonb_agg(jsonb_build_object('name', ordered.name, 'count', ordered.count)
        order by ordered.count desc, ordered.name)
      from (select name, count from meal_dishes where meal_slot = slots.slot order by count desc, name limit 3) ordered
    ), '[]'::jsonb)) from (values ('breakfast'), ('lunch'), ('dinner')) as slots(slot)),
    'recent', coalesce((select jsonb_agg(row_to_json(r) order by date desc,
      case meal when 'dinner' then 3 when 'lunch' then 2 else 1 end desc) from recent r), '[]'::jsonb)
  );
$$;

revoke all on function public.helpeat_save_meal(date,text,text,text[]),
  public.helpeat_save_preferences(text,text,time,time,time), public.helpeat_habits() from public, anon, authenticated;
grant execute on function public.helpeat_save_meal(date,text,text,text[]),
  public.helpeat_save_preferences(text,text,time,time,time), public.helpeat_habits() to authenticated;

notify pgrst, 'reload schema';
commit;
