-- Read only. Validate the full UUID before replacing __IMPORT_ID__.
select id,organization_id,establishment_id,status,error_code,resolution_diagnostic_id,
 created_at,started_at,worker_started_at,wake_requested_at,wake_request_id,wake_count,wake_error,
 provider_start_attempted_at,provider_run_saved_at,provider_started_at,provider_finished_at,provider_finished_observed_at,
 retrieval_started_at,retrieval_completed_at,persistence_started_at,persistence_completed_at,finished_at,
 extract(epoch from(started_at-created_at)) as creation_to_claim_seconds,
 extract(epoch from(worker_started_at-started_at)) as claim_to_processing_seconds,
 extract(epoch from(provider_run_saved_at-provider_start_attempted_at)) as start_reservation_to_saved_identity_seconds,
 extract(epoch from(provider_finished_at-provider_started_at)) as native_provider_seconds,
 extract(epoch from(provider_finished_observed_at-provider_finished_at)) as native_finish_to_observation_seconds,
 extract(epoch from(retrieval_completed_at-retrieval_started_at)) as retrieval_and_bookkeeping_seconds,
 extract(epoch from(persistence_completed_at-persistence_started_at)) as persistence_seconds,
 extract(epoch from(finished_at-persistence_completed_at)) as finalization_seconds,
 extract(epoch from(finished_at-created_at)) as total_server_seconds,
 provider_run_id,provider_dataset_id,provider_status,reviews_target,reviews_fetched,reviews_inserted,
 provider_requests,attempts,provider_attempt_history,phase_events,
 provider_start_attempted_at is not null and provider_run_id is null as start_outcome_unknown
from public.initial_import_jobs where id='__IMPORT_ID__'::uuid;
