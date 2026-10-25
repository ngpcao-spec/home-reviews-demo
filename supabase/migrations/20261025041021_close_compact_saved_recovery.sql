-- Recovery has been performed against the existing native receipts, without
-- rearming either run. Keep its audit on each report, remove the one-off API.
drop function private.publish_revalidated_compact_sol(uuid,text,text,jsonb,text);
drop function private.compact_generated_content(jsonb);
