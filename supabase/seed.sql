-- Local demo account: demo@home-reviews.fr / demohome
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,raw_user_meta_data)
values('00000000-0000-0000-0000-000000000000','00000000-0000-4000-8000-000000000099','authenticated','authenticated','demo@home-reviews.fr',crypt('demohome',gen_salt('bf')),now(),now(),now(),'','','','',jsonb_build_object('organization_name','HOME France'))
on conflict(id) do nothing;

do $$
declare org uuid; e1 uuid:='00000000-0000-4000-8000-000000000101';e2 uuid:='00000000-0000-4000-8000-000000000102';e3 uuid:='00000000-0000-4000-8000-000000000103';e4 uuid:='00000000-0000-4000-8000-000000000104';
begin
select id into org from public.organizations where created_by='00000000-0000-4000-8000-000000000099' limit 1;
update public.subscriptions set plan_key='pro',status='active' where organization_id=org;
insert into public.establishments(id,organization_id,name,address,city,country_code,google_maps_url,google_place_ref,source_provider,provider_place_ref,current_rating,current_review_count,last_synced_at,next_sync_at,sync_status) values
(e1,org,'Le Petit Hanoi','12 rue de la Paix','Paris','FR','https://www.google.com/maps/search/?api=1&query=Le+Petit+Hanoi','mock-le-petit-hanoi','mock','mock-le-petit-hanoi',4.2,318,now(),now()+interval '1 hour','ok'),
(e2,org,'Saigon Bistro','8 avenue Parmentier','Paris','FR','https://www.google.com/maps/search/?api=1&query=Saigon+Bistro','mock-saigon-bistro','mock','mock-saigon-bistro',4.5,186,now(),now()+interval '1 hour','ok'),
(e3,org,'Da Nang Beach','27 quai de Loire','Paris','FR','https://www.google.com/maps/search/?api=1&query=Da+Nang+Beach','mock-da-nang','mock','mock-da-nang',3.9,247,now(),now()+interval '1 hour','warning'),
(e4,org,'L''Indochine','4 place des Vosges','Paris','FR','https://www.google.com/maps/search/?api=1&query=Indochine','mock-indochine','mock','mock-indochine',4.7,412,now(),now()+interval '1 hour','ok')
on conflict(id) do nothing;

insert into public.reviews(organization_id,establishment_id,source_provider,external_review_id,author_name,rating,review_text,review_language,published_at,source_url,is_historical_import,requires_action,status)
select org,(array[e1,e2,e3,e4])[(n%4)+1],'mock','seed-'||n,(array['Camille D.','Minh T.','Sophie L.','Julien R.','Anna P.'])[(n%5)+1],(array[1,2,3,4,5])[(n%5)+1],
(array['Attente beaucoup trop longue et aucune explication.','La salle manquait de propreté.','Cuisine correcte mais service très lent.','Bonne expérience dans l''ensemble.','Excellent accueil, nous reviendrons !'])[(n%5)+1],
'fr',now()-(n||' hours')::interval,'https://maps.google.com',true,((n%5)+1)<=2,case when ((n%5)+1)<=2 then 'to_process'::public.review_status else 'ignored'::public.review_status end
from generate_series(1,20)n on conflict do nothing;
end $$;
