-- PRIVATE_SOURCE_FIXTURE must set test.compact_source to a real immutable
-- source bundle. All rejected mutations use subtransactions; no supplier calls.
begin;
set local role service_role;
-- PRIVATE_SOURCE_FIXTURE
do $$declare b jsonb=current_setting('test.compact_source')::jsonb;v jsonb;id uuid;n int=0;begin
 id=public.save_jls_compact_reused_source(b,public.jls_restaurant_hash(b));
 assert id=public.save_jls_compact_reused_source(b,public.jls_restaurant_hash(b));n=n+1;
 foreach v in array array[
  jsonb_set(b,'{establishment_id}',to_jsonb(gen_random_uuid()::text)),
  jsonb_set(b,'{protocol,body,source,source_binding,dataset_binding,text_reviews}','91'),
  jsonb_set(b,'{source_input,dataset,body,reviews,0,result,categories,service,native_choice}','"negative"'),
  jsonb_set(b,'{protocol,body,source,selected,0,polarity}','"invalid"')
 ] loop
  begin
   perform public.save_jls_compact_reused_source(v,public.jls_restaurant_hash(v));
   raise exception 'MUTATION_ACCEPTED';
  exception when raise_exception then
   if sqlerrm='MUTATION_ACCEPTED' then raise;end if;n=n+1;
  end;
 end loop;
 assert not has_function_privilege('authenticated','public.save_jls_compact_reused_source(jsonb,text)','execute');n=n+1;
 assert not has_function_privilege('anon','public.save_jls_compact_reused_source(jsonb,text)','execute');n=n+1;
 perform set_config('test.compact_source_result',jsonb_build_object('assertions',n,'provider_calls',0,'rollback',true)::text,true);
end $$;
select current_setting('test.compact_source_result')::jsonb as source_checks;
rollback;
