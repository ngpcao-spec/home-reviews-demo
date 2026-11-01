# Source-bound open criteria — local correction

## Local SQL validation follow-up

The functional test `recommendation-weight-v2.test.ts` comparing V1/V2 without
negative reviews and checking four positives against one negative performs nine
SQL calculations over frozen 150-review publications. A diagnostic-only local
comparison of the parent revision and the corrected revision measured 2.33–4.65 s
for its body, including runs with two workers. The SQL result digests match;
about 98% of the body is spent in the calculations, rather than the migration or
fixture construction. Database initialization runs separately in `beforeAll`.

The previous five-second runner deadline interrupted this functional scenario;
it is not an application latency contract. This test has a bounded 15 s timeout,
roughly three times the largest completed measurement, to allow local WASM/runner
variability. Its body and assertions are unchanged.

The full-suite follow-up also exposed a five-second cutoff in the existing
`direct4-short-comparison.test.ts` rehearsal of 174 **mocked** HTTP exchanges.
It passed before/after in 3.582/2.063 s and in 4.653 s in a full parallel run,
then hit the runner deadline in a serial full run. Its receipt, comparison,
concurrency and duplicate-call assertions are preserved with the same bounded
15 s allowance. These are the only two case-specific deadline changes; no
global timeout increase is applied. Other test and hook limits, score functions,
fixtures and application code are unchanged. No real HTTP call is made.

The measurements do not establish the precise historical OS load or a production
performance improvement. Complete verification results remain in the private
delivery folder; no supplier call or deployment is needed.

This is a local protocol/validator change, not a deployment or a quality verdict
about a historical model reply. No provider, database, import or report call is
needed. Restaurant-specific data stay in the private delivery folder.

## Proven cause and historical limit

V1 permits `criteria[].key = null` for a verbatim free-text need. The schema
offers only keys supplied by conservative hints plus null. Those hints may
abstain on conditional/negated context or miss a formulation. V1 then ignored
null keys in `cautionContext`, so no reservation could bind to two open needs.

The diagnostic receipt proves two null keys and the exact failed caution. The
verbatim request, native criterion quotes and complete reply were intentionally
not retained. The precise phrase-level reason hints were absent is therefore
not verifiable. Conditional FR/VI examples in tests reproduce a GENERAL mechanism,
not the missing historical sentence or response.

## Identity, binding and independent proof

The raw key remains null. A criterion's identity is its ordered position and
verbatim request span. The V2 wire adds `caution_bindings: [{ref, criterion}]`, in
the same order as `caution_refs`; criterion is a zero-based integer, not a key.
An integer links exactly one criterion. A null position is reserved for global
stale-report freshness or a comparison with no criteria, not an open criterion.
Malformed, missing, swapped or out-of-range bindings are rejected.

A model-declared link is insufficient. For an open criterion the server:

1. Checks the literal quote, its position and its complete negation/context.
2. Independently resolves one conservative subject with the existing grammar.
   Only explicit optionality markers (`si possible`, `nếu có thể`, `if possible`)
   may be ignored for this proof. The actual request is never edited or rephrased,
   and neither the shortlist nor a mandatory filter is changed.
   Canonical family/exterior aliases are used only in this proof, never fed back
   into preselection. The containing clause must not leave unverified qualifiers:
   a generic terrace cannot establish heating, nor family suitability baby care.
   Separate recognized subjects may share a Vietnamese clause without being
   merged into one criterion.
3. Verifies references against that candidate's canonical feature/category,
   source-derived state and exact report/section/index provenance. A report
   cooking complaint cannot prove a family/outdoor need. Scoped report points
   qualify only if they actually contributed to the reconciled feature.
4. Preserves unknown/partial/contradictory states. Missing feature metadata is an
   explicit unknown, never a negative finding or proof of the opposite.

An unresolved or ambiguous free subject remains a valid open need, but can only
be returned as `unknown` with no refs. A positive/negative assertion without
independent proof is rejected; a generic real reservation is not accepted merely
because the model assigns it to that need. Free text still reaches the model
intact. This is a bounded evidence verifier, NOT universal semantic understanding.
In particular, some valid paraphrases will remain unverified; no lexical match
is fabricated to avoid that limit. Scores alone never prove practical traits.

Each rendered caution exposes `criterion_indices`; two null-key criteria cannot
collapse into one null-key lookup. Report sources and request spans remain
separate. The regular UI can already display individual criterion coverage and
unknown/partial states; no new generated explanatory prose is introduced.

## Compatibility and unchanged behavior

- Native contract: `recommendation-criteria-coverage-v2`.
- Validator: `recommendation-criteria-validator-v2`.
- Request/cache: `recommendation-ai-open-criteria-safety-v7`.
- API/consent mode remain compatible; model and provider parameters are unchanged.
- The nine existing primary practical features now include explicit missing
  values so free unknowns can cite canonical metadata. Empty unsourced values are
  transmitted as `unknown_feature_refs`, not repetitive empty fact objects;
  scoped or sourced facts keep their full context.
- Old coverage caches are refused, never silently promoted. A narrow legacy raw
  decoder may derive bindings for independently verified KNOWN criteria only;
  it never infers a binding for an old open criterion. This supports unchanged
  saved-response regression reads, not reuse of an incompatible production cache.
- Model, scores, weights, hard constraints, preselection/order and cap of twenty,
  source access rules and provider-reservation/unknown-outcome protections remain.
- No diagnostic authorization is reset or reused by this local version change.
  Existing one-use grants retain their pinned old protocol checks.

## Verification scope

Tests cover two distinct null keys, explicit relevant sourced cautions, unknown
metadata, scoped report qualifications, negation/time limits, wrong-criterion
bindings, unrelated cooking/price sources, foreign/invented refs, unsupported
semantic assertions and cache incompatibility, in French and Vietnamese.

Four stored native responses can be read unchanged and checked for selection,
reference, score and preselection regressions. Their original protocol remains
historical; revalidation is not a new model evaluation. The missing real response
cannot be fully replayed. A targeted simulated reproduction establishes the
specific failure/acceptance branch, not the validity of that historical reply.

The synthetic 100-restaurant fixture is run from a private copy to preserve every
original byte, including its validation report. Keep D31 at 95 admissibles.
No expected score, dataset or oracle is modified to make these checks pass.
