-- Repair the localized title already persisted before the Apify adapter
-- started preferring canonical Google Maps place names.
update public.establishments
set name = 'Green Home Restaurant'
where place_id = 'ChIJY0rVZRRncDERV-9UR-iMjns'
  and name = 'Nhà hàng Green Home';
