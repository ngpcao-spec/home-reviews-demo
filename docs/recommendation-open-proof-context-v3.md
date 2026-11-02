# Verbatim open-criterion proof normalization — local correction

The V12 source archived during delivery is byte-identical to the baseline used
here. The real rejected reply, its criterion quotes and the two reference values
were not retained. These tests reproduce branches with synthetic FR/VI data,
not that historical reply. No conclusion about its full validity follows.

## Demonstrated defects

`verifiedOpenCriterion` parsed the quote before removing optionality markers,
while removing those markers only from the complete request. A model quoting
`en famille si possible` or `gia đình nếu có thể` therefore got no independent
subject, although the shorter quote of the same need passed. Leading optional
phrases and terminal punctuation inside a quote also prevented containment in
the punctuation-delimited context. This is a normalization inconsistency,
not evidence that a restaurant meets the request.

The proof-only aliases also missed ordinary plural family and child wording.
Vietnamese generic suitability/seating wording left harmless residual words.
These prevented source verification even when the corresponding canonical Google
fact was present. The conservative shortlist parser remains unchanged.

The prompt's broad instruction to cite a relevant supplied fact for an open need
was also wider than the validator: practical needs are accepted only through
their canonical `feature_*` reference, with its reconciled source/state. A real
cooking complaint or global score cannot establish family/outdoor suitability.

## Minimal correction

- Normalize the quote and complete context identically for evidence proof only:
  ignore explicit `si possible`, `nếu có thể`, `if possible`, and outer punctuation.
  The literal quote must still occur in the original request. Original text,
  quote offsets, hard filters, candidate data and shortlist are never rewritten.
- Extend proof-only family/child/exterior aliases and permit generic suitability
  and seating connectors. Keep family suitability, children and outdoor seating
  as separate source properties. A family-friendly declaration does not establish
  child facilities or baby care.
- Preserve whole-request negation and scope checks. Extra qualifiers such as
  heating, baby care or a specific unverified time still cannot be erased by a
  generic property. A quote merging several independent subjects remains
  unverified; the native prompt already requires separate criteria.
- Clarify the same existing canonical-reference policy in the provider prompt.
  Do not accept raw points, scores, unrelated or foreign refs just because they
  exist. Source-derived state and caution-position binding checks are unchanged.

Known source-backed needs may be documented, partial or contradicted. Missing
canonical metadata supports unknown only. Unsupported semantics may still be
unknown with no refs; this is not a universal semantic parser and does not force
all free criteria to unknown. No source, probability, score or evidence is invented.

## Local versions and preservation

The response schema remains bounded contract `recommendation-criteria-coverage-v3`
with the same fields and empty/nullable options. New local proof semantics use
`recommendation-criteria-validator-v3`; the clarified request/cache uses
`recommendation-ai-open-criteria-safety-v9`. Old cache keys cannot be reused.
This is not a deployment or permission to retry. Existing SQL grants retain
their old pins and explicitly reject the new tuple without consuming anything.
No SQL, authorization, provider, model or client change is included.

Full data, maximum twenty candidates, removed application input-byte gate,
provider/infrastructure bounds, access/provenance checks, duplicate protection
and unknown-result no-resend behavior remain intact. The frozen historical
identity bridge is unchanged and its original hash regressions still apply.

## Verification boundaries

Regression cases compare valid canonical refs, real irrelevant refs, unknown
metadata, foreign/invented refs, separate null-key criteria, negative/optional
context, concrete/time qualifiers and source/caution bindings in FR/VI. They
check the rendered coverage, not a required text for a future report.

The private before/after matrix uses the archived baseline verifier and identical
synthetic native objects. It does not reconstruct the missing historical quote
or identify which historical parser condition failed. Real model compliance and
selection quality remain to be evaluated under a separate future authorization.

## Local runner observations

The first highly parallel recommendation run exhausted Windows process resources
and hit the five-second deadline of the unchanged SQL sheet-backfill test. The
same committed test measured 1.922 s on the baseline copy and 1.676 s on the
current copy, in one environment with one worker. Its assertions, SQL and timeout
are unchanged. No recommendation latency improvement is inferred from this.

A pre-existing cron-suite install failed on
`CRON_LOG_RETENTION_LOOKUP_ANCHOR_CHANGED`: checkout CRLF bytes inside a function
body did not match a later migration's literal LF anchor. Baseline and corrected
code reproduce the same failure. A one-off LF conversion established the cause,
but did not make validation reproducible after another checkout.

The test loader now uses `sqlMigrationSource` to normalize CRLF to LF in memory,
before PostgreSQL interprets the body. It never rewrites SQL files, string escapes,
Git settings, production migrations or assertions. The complete thirteen-case
cron suite runs with both explicitly constructed LF and CRLF inputs on every OS.
All existing retention, lock, access, idempotence and preservation assertions run
for both representations with their original deadlines. Skipping the literal
anchor check or accepting a failed installation is not allowed.
Explicit result types for the local SQL test database allow this harness to be
checked in strict TypeScript too. Type erasure leaves the existing policy test
bodies unchanged; no assertion or runtime behavior is changed by these types.

Review validation runs the entire global suite on the final committed source,
along with targeted FR/VI coverage, the 48 mobile tests, lint, strict typing,
build and the offline synthetic-catalogue replay. Private results record the
exact commit and original fixture hashes; no provider or production call is used.
