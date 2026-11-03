begin;
set local lock_timeout='2s';
lock table private.recommendation_corrected_diagnostic_trials in access exclusive mode nowait;
-- Operator-grant compatibility only. No attempt, grant or expiry is created/reset.
alter table private.recommendation_corrected_diagnostic_trials
 drop constraint recommendation_diagnostic_protocol_pair,
 add constraint recommendation_diagnostic_protocol_pair check (
  (target_contract='recommendation-criteria-coverage-v2' and target_validator='recommendation-criteria-validator-v2' and target_cache='recommendation-ai-open-criteria-safety-v7') or
  (target_contract='recommendation-criteria-coverage-v3' and target_validator='recommendation-criteria-validator-v2' and target_cache='recommendation-ai-open-criteria-safety-v8') or
  (target_contract='recommendation-criteria-coverage-v3' and target_validator='recommendation-criteria-validator-v3' and target_cache='recommendation-ai-open-criteria-safety-v9') or
  (target_contract='recommendation-direct-choice-v1' and target_validator='recommendation-structural-validator-v1' and target_cache='recommendation-ai-direct-choice-v10')
 );
commit;
