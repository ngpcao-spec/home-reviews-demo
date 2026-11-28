alter table private.menu_dish_ai_runs
  add column suppress_automatic_illustration boolean not null default false;

create or replace function private.enqueue_published_dish_image()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  if exists (
    select 1 from private.menu_dish_ai_runs r
    where r.id=new.published_id and r.suppress_automatic_illustration
  ) then return new; end if;

  perform private.enqueue_dish_image(p.specialty_id,new.scope)
  from private.restaurant_dish_profiles p
  where p.scope=new.scope and p.specialty_id is not null;
  return new;
exception when others then
  raise warning 'DISH_IMAGE_ENQUEUE_FAILED (%)',sqlstate;
  return new;
end;
$function$;
