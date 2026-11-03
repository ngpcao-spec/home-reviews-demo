# Deterministic light restaurant sheets

The private direct comparison sends `recommendation-light-v1` candidates with
the unchanged direct-choice output contract and structural validator. Paid result
cache/configuration is `recommendation-ai-light-v11`. Historical identity hashing,
reservations, unknown outcomes and one-use trial grants are unchanged. A format
or cache version never authorizes a replay of a consumed attempt.

The engine still selects at most twenty candidates and applies the same mandatory
filters and exact internal scores. Each transmitted sheet contains restaurant ID,
name, cuisine/specialties/usages, the four exact decimal scores, indicative saved
Google price range/currency/level and confirmed unit (otherwise null), review
summary, reservations, Google declarations, separate report observations, report
date and freshness. Missing attributes are unknown, never false. One shared
legend explains provenance, score scale, uncertainty and support-count semantics.

Published positive and negative summaries are the primary prose. Every saved
negative point is preserved without truncation, including isolated testimony,
reported recurrence, uncertainty and favourable context. Identical points in the
same section/category are merged with their optional references; the combined
support count becomes unknown rather than summing potentially overlapping reviews.
Full report recommendation observations fill evidence missing from those points.
Category prose is a conservative fallback for evidence still missing. No statistical
or managerial action narrative is appended wholesale. This evidence-based coverage
is deterministic; it does not independently certify completeness or business truth.

Google facility declarations remain in `google_features` as true/false/conflicted.
Report observations are separate references with their source scope/context. The
general sheet has no free-text-specific interpretation, visit-context guarantee
or rewritten score. Supplementary text goes through the existing privacy filter.
No raw reviews, people identities, contacts, address, review/evidence hashes,
source binding arrays, score fractions or repeated technical attestations are sent.
Detailed source facts and reports stay on the server. Existing optional references
resolve there; missing or unusable ones are omitted individually as before.

`recommendation_light_sheet_cache` is a disposable server-produced cache, separate
from business rows, publications, paid receipts and trial permissions. Reads use
caller RLS (owner/admin/manager of that tenant); only the server role writes.
SHA-256 identity includes the complete authorized source row, language and format,
so same-ID content edits, price, facility, score and freshness changes invalidate
reuse. Tenant and establishment scope are also checked before reuse. Different
requests share the same sheet. A small server memo avoids repeated deterministic
construction in a warm isolate. Persistent hits skip construction after cold
starts. Cache outages fall back to free local construction; they do not retry AI.
At most one current source version is stored per tenant/restaurant/language/format.
Concurrent misses can perform the same free deterministic work; no paid call is
used to prepare a sheet. The existing paid reservation still controls AI dispatch.

Install `20261103003249_recommendation_light_sheets_cache.sql` before deploying the
updated private function for persistent reuse. No frontend contract change is
required. The migration creates an empty derived cache only; it does not backfill,
modify a report, run a supplier, or create/extend/reset a trial grant. Existing
grant rows remain unchanged. The separate light manual-trial protocol migration
allows an operator-authorized successful direct-v10 parent for light-v11 only.
It preserves the existing request/data/language/access identity bridge, parent/root
fingerprints, expiry, atomic consumption and shared-child/no-resend rules. Runtime
15 or newer is required. The operator SQL uses explicit LOCAL settings and is not
a callable authorization RPC. It never extends or rearms an existing grant. Any
future manual trial still requires its own explicit instruction.

Offline audit:

```text
node scripts/audit-recommendation-light.mjs PRIVATE_CATALOGUE PRIVATE_RECEIPT PRIVATE_OUTPUT
```

It requires the successful receipt's exact twenty candidate IDs/order, blocks fetch,
checks preservation of every previously transmitted reservation, and counts UTF-8
bytes and local `o200k_base` tokens. Exact local encoding counts are not asserted
to be the model's billing tokenizer. The historical private request/controls are
not retained: both local inputs use the same empty request, not invented historical
text. An estimate can subtract the local token delta from historical billed input.
Output count is held constant for cost comparisons, not predicted. Standard
noncached pricing and cache-write scenarios are reported separately; receipt cost
is unavailable and cache-write retention is unknown. Private real examples and
payloads stay outside public source control.

No input-byte ceiling, per-sheet token cap, semantic rejection or new model call
is introduced. Recommendation quality remains for a later manual evaluation.
