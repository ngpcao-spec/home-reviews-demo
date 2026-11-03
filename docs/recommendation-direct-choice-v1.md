# Direct AI comparison on the private test page

The live comparison returns up to three candidate IDs with model-written
explanations, cautions, uncertainties and optional source references. It no
longer requires recognized free-text subjects, a coverage matrix, imposed
documented/partial/unknown states, criterion bindings or a semantic judgment
about a caution's relevance. Those historical decoders remain for saved offline
fixtures; the live HTTP and cache paths use the direct decoder exclusively.

The server still requires an exploitable JSON choices array, no more than three
distinct transmitted candidate IDs, and a nonempty explanation per choice.
Optional references are resolved only inside their chosen candidate. Missing,
malformed, foreign or unavailable citations are omitted individually, with an
omission notice; they cannot discard an otherwise usable model explanation.
A real saved citation's availability is not an independent verification that
it substantiates the AI's claim. No semantic claim is silently corrected.

The client shows the actual generated prose as an AI assessment, explicitly
not independently verified, in French and Vietnamese. It presents uncertainties
and cautions directly, without imposed coverage badges. Available saved sources
remain in details with their original provenance. Model strings are rendered as
text, never HTML or executable links. An empty choice list is usable and is
explained without switching to the engine fallback or filling three places.

Versions:

- Contract: `recommendation-direct-choice-v1`
- Validator: `recommendation-structural-validator-v1`
- Cache: `recommendation-ai-light-v11`
- Input: `recommendation-light-v1` (see [light sheets](recommendation-light-v1.md))
- Client mode: `direct_choice_v1`

The historical `recommendation-criteria-coverage-v3` constant identifies the
offline decoder only. Live diagnostics identify the direct contract and
structural validator. Their legacy `ai_validated` origin label means technical
acceptance only; the page never describes semantic/source validation.

Deploy the private function and the client together. The server rejects an old
comparison client before reservation; classical search remains compatible.
The new client rejects an incompatible successful comparison response.
No grant activation is needed for this output contract. Persistent light input
reuse has its own empty derived-cache migration, documented with the light format.

Authentication, organization roles/RLS, explicit mandatory filters, existing
shortlisting (maximum twenty), immutable scores, languages and input-byte-gate
removal are preserved. Detailed candidate facts remain on the server; the live
input uses deterministic general light sheets, retaining report reservations and
separating Google declarations from report observations. Models, reasoning,
output allowance, infrastructure timeouts and response-size bounds are unchanged.

Reservations precede HTTP. Existing user/data/access/request identity checks,
source recheck, one-use grants, unknown outcomes and receipt-save protections
remain unchanged. New cache versions never authorize a replay of consumed
diagnostic grants. No authorization is created or reset by delivery. A matching
old consumed grant may continue to block that same historical request until a
separate explicit authorization; a version change is not permission to resend.

Generated explanations belong to the accepted private result/cache. Requests,
complete prompts, raw model replies and report excerpts are not added to
technical diagnostic logs. Diagnostics remain content-free and retain the
existing bounded seven-day policy. The generated prose can be wrong: no offline
test or technical acceptance establishes recommendation quality.

Offline coverage includes usable explanations with unsupported paraphrases,
unrelated cautions and missing/invalid citations; structural failures; empty
choices; scope, scores, budget and access preservation; cache compatibility;
in-flight sharing and unknown/no-resend behavior; mobile FR/VI attribution,
source display and uncertainty. No real model call is required by these checks.
