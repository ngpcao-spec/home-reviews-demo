-- Run only after reverting the frontend, if this feature is deployed later.
-- No DROP/DELETE: keep catalog, evidence, manual corrections and original menus.
begin;
alter table public.rainminer_menu_jobs disable trigger capture_menu_dishes;
alter table private.rainminer_menu_requests disable trigger capture_dish_menu_request;
alter table private.shared_restaurant_establishments disable trigger capture_dish_shared_link;
revoke execute on function public.read_restaurant_dishes(uuid),public.list_dish_names(),
 public.edit_restaurant_dishes(uuid,integer,text,uuid,text,uuid),public.search_restaurants_by_dish(text)
 from authenticated;
commit;
