# Transmitted reference catalogue — contract V3

This is a prepared local/server change, not deployment or permission for another
paid comparison. The historical rejected reply is missing; it cannot be replayed,
corrected or declared valid by these tests. Synthetic cases reproduce its error
class only. Existing historical receipts and consumed diagnostic grants remain
untouched.

## Request construction

`prepareAi` constructs the input object once. It supplies that same object's
`candidates` to `coverageSchema`, then serializes it as Responses API `input`.
The reference enum is the sorted, exact, deduplicated union of:

- `candidates[].facts[].ref`;
- `candidates[].unknown_feature_refs[]`.

It does not come from all accessible restaurants, hidden canonical fields,
review/evidence IDs, report prose, source labels or an independently reconstructed
catalogue. No spelling normalization, approximate match or replacement is made.
Unknown-feature references remain usable as evidence of uncertainty, subject to
the existing state/relevance checks; they never become positive/negative facts.

All four reference positions share `#/$defs/fact_ref`:
`reason_refs[]`, `criterion_evidence[].refs[]`, `caution_refs[]` and
`caution_bindings[].ref`. Candidate and alternative IDs similarly share the
transmitted candidate-ID definition. Shared definitions avoid multiplying enum
values across repeated schema positions.

The enum is global to this bounded call, not an authorization to reuse another
restaurant's reference. Server validation still independently checks existence
inside the selected restaurant, allowed use, criterion relevance, source/state
compatibility, duplicates, explicit caution binding and alternatives. An existing
but unrelated reservation stays invalid. Scores, candidate selection, ranking,
source data and the prompt's business instructions are unchanged.

## Empty, nullable and historical fields

Free criteria still use `key:null` and their own quote spans/indexes; two null keys
remain two independent criteria. This does not introduce a closed vocabulary for
the user's request. Existing list bounds remain: reasons require at least one
reference; criterion refs, caution lists/bindings and alternative lists can be
empty where the contract permits it. Binding `criterion:null` remains possible
for its existing supported use. All properties already required by strict wire
mode remain required; no new response property is added. The validator's limited
historical reader for omitted caution bindings is unchanged.

With no candidates, only an empty `choices` list is allowed and the comparison
returns `NO_CANDIDATES` without reservation or HTTP. Null-only unreachable ID/ref
definitions make the empty local schema valid without an empty enum or a made-up
identifier. A nonempty candidate list with no references is rejected before any
provider attempt rather than yielding an unusable schema.

## API compatibility

The existing API is `POST /v1/responses`, using strict `text.format` JSON Schema.
The [official Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
supports local definitions/references, string enums, nullable fields and array
bounds. It requires strict objects to list their properties as required and to
disable additional properties. The implementation avoids unsupported composition
keywords. Enum totals and string budgets follow the documented bounds: 1,000 enum
values overall, 120,000 characters for schema names/enum strings, and 15,000 string
characters for a single enum larger than 250 values.

The preflight enforces these API schema bounds without trimming candidates or
references. It is not an HTTP request-byte cap: removal of the former 200,000-byte
application gate remains intact, including large-body/no-retry tests. AJV is
declared as a test-only dependency at the version already present transitively;
no extra library enters the deployed runtime.

Offline checks compile the actual generated schema with AJV, check the documented
subset/bounds and capture the body received by the mocked HTTP transport. They
do not prove live provider acceptance or recommendation quality; no real request
is sent in this preparation.

## Versions and preservation

- Native contract: `recommendation-criteria-coverage-v3`.
- Request/cache configuration: `recommendation-ai-open-criteria-safety-v8`.
- Validator rules: still `recommendation-criteria-validator-v2`.
- API/client mode and rendered response fields remain unchanged.

Full-body request/access/data hashes and the new version prevent reuse of old
cache entries. Old stored coverage is not promoted to V3. The frozen V6 identity
bridge retains its original request/schema and its identity regression hashes.
No reservation, finish, authorization, migration or SQL pin is changed.

The previous explicit one-use trial remains consumed and pinned to V2/V7; V3/V8
cannot silently reuse or rearm it. A regression test explicitly rejects the new
tuple through that old grant. A later real test needs separate explicit
authorization and a compatible mechanism. This PR creates neither.

Future deployment scope is only `test-restaurant-recommendations` and its changed
shared modules, with JWT verification. No client republication, data migration,
import, report generation, scheduler or HOME AI integration is included.
