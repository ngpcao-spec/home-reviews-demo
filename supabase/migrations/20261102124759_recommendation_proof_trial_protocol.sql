begin;
set local lock_timeout='2s';
lock table private.recommendation_corrected_diagnostic_trials in access exclusive mode nowait;
-- Protocol compatibility only: no grant, attempt, expiry reset or provider call.
-- Keep complete triples, including the immutable historical V7 and V8 pins.
alter table private.recommendation_corrected_diagnostic_trials
 drop constraint recommendation_corrected_diagnostic_tria_target_validator_check,
 drop constraint recommendation_diagnostic_protocol_pair,
 add constraint recommendation_diagnostic_protocol_pair check (
  (target_contract='recommendation-criteria-coverage-v2' and target_validator='recommendation-criteria-validator-v2' and target_cache='recommendation-ai-open-criteria-safety-v7') or
  (target_contract='recommendation-criteria-coverage-v3' and target_validator='recommendation-criteria-validator-v2' and target_cache='recommendation-ai-open-criteria-safety-v8') or
  (target_contract='recommendation-criteria-coverage-v3' and target_validator='recommendation-criteria-validator-v3' and target_cache='recommendation-ai-open-criteria-safety-v9')
 );
commit;
