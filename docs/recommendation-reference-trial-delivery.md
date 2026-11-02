# Explicit reference-catalogue diagnostic delivery

Deploy the reference-catalogue V3 private function with JWT verification. The
client mode (`criteria_coverage_v6`) and API response shape remain unchanged;
neither a Pages publication nor business-data migration is required.

A separately authorized manual test needs a new, content-free grant, not a reset
of a consumed V2/V7 grant. Install only
`20261102043631_recommendation_reference_diagnostic_trial.sql`. It allows the two
exact contract/cache tuples while preserving existing rows, reservation and
atomic completion functions. It does not create or dispatch an attempt.

An operator may then call
`public.authorize_reference_recommendation_diagnostic_v1(verified_parent_uuid)`.
The parent must be a definitively completed V7 `INVALID_REFERENCE` receipt with
native request ID and output tokens, linked to an unchanged consumed corrected
trial. Its original root and parent receipts must still match their saved hashes.
A V8 child is ineligible for another grant through this mechanism. Authorization
is not exposed to anonymous or signed-in client roles.

The existing frozen V6 identity bridge is reused unchanged: the current explicit
click must reproduce the original request and the access/catalogue cache hash.
No old payload is sent or stored. Different text, filters, language, access or
catalogue blocks reservation; an operator grant cannot bypass identity checks.
Existing reservation checks pin V3/V8 and validator V2 from the new grant and
commit one child and its initial diagnostic before HTTP. Double clicks join the
child. Failure/unknown results, expiration or reauthorization never resend it.
Expiry is 24 hours from first authorization and cannot be extended by a repeat
call. No authorization is armed by applying the migration or deploying code.

Detailed content-free diagnostics keep their existing 7-day, 100-per-organization,
16-KiB limits. They record stage, field/index, reference ownership/use and final
origin, never user free text, report excerpts or raw model output. The missing
historical response is not reconstructed or validated.

## Existing additional test-helper diagnostics

An extra strict type check outside the normal repository type-check scope found
six diagnostics, identical on the base and reference-schema branch: five TS2322
assignments to inferred `never[]` in `recommendation-criteria.test.ts`, and one
TS2339 (`SheetRow.name`) in `recommendation-legacy-identity.test.ts`. Required CI
runtime/app type checks pass; the changed runtime and new schema test have zero
diagnostics. These older helpers are documented here, not changed by this fix.
