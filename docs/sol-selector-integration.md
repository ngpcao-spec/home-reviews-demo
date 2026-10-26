# Request-pinned Sol evidence selector

Prepared in code only. This change does not deploy, change the server default,
start a generation, reserve a supplier call or replace a published report.
The migration also ships with the existing selector as its default.

## Exact implementation

The new choice is `sol-evidence-single-negative-source-completion-proposal-v1`.
It is the function tested at commit
`a9ed8d56f4f29ba33956fbf72a756c2e6ff20d7d`, promoted into
`supabase/functions/_shared/jev-priority-evidence-selection.ts`.
Only its imports and introductory comment changed. A test checks the complete
function-body SHA-256. Its frozen policy, ordering, tie breaks, pair accounting,
duplicate checks and capacity are unchanged. The policy's original
`production_enabled: false` is preserved as experimental provenance; it is not
the activation mechanism. Activation is the separate, request-pinned setting.

- Prioritize native negative and inseparable mixed associations from 1–4 stars.
- Complete a single missing negative category for a source already started.
- Maximum 32 associations; mixed pairs consume two places.
- Keep available positive illustrations and the existing completion ordering.
- Five-star criticism remains eligible in completion; there is no general ban.
- No semantic severity, text-length importance score, restaurant exception,
  classification correction, new prompt, language change or new threshold.

The two allowed bindings are:

| Version | Configuration SHA-256 |
| --- | --- |
| `jls-direct4-negative-mixed-coverage-v1` | `17ea400f28bdc39c7218e2d62c9d9452d137b8e0b4e4891acfacfa8e0237de5e` |
| `sol-evidence-single-negative-source-completion-proposal-v1` | `3ca3d6002e5cb3a1d29221f6b392bed79514b18af5c29eae7861ab90ed2ce973` |

## Normal generation and resume

1. A `BEFORE INSERT` trigger copies the server setting into
   `report_generation_requests.evidence_selector_version`, in the enqueue
   transaction. Settings are locked `FOR SHARE`; a setting switch takes
   `FOR UPDATE`. Client-supplied values cannot select a different version.
2. Existing requests receive the legacy column default. The existing immutable
   request trigger protects the new column as well as the previous fields.
3. The historical worker reads this request binding, not the latest setting.
   It seals the descriptor in the source protocol. SQL checks that descriptor
   against the request, including when reusing an immutable certificate.
4. For the priority version, the current batch manifest stores the descriptor
   in the immutable batch template. The shared worker dispatches the exact
   selector while building the dossier. The draft and envelope retain it.
5. A resume uses its stored template/draft/envelope. A rehashed switch is rejected
   before any Sol reservation. Missing bindings on older batch templates retain
   legacy behavior; unknown versions or changed hashes fail closed.

The retained individual V2 route accepts the same pinned descriptor. This does
not switch JEV transport. Existing claim, receipt, unknown-outcome, concurrency,
publication and obsolete-generation guards remain in place. No experimental
controller is imported or armed. The existing function named
`jev-batch-experiment` already serves normal batch requests; that shared worker
is the production integration point, not the isolated K.HOUSE controller.

## Offline evidence

The three saved Vietnamese corpora were replayed through **`batchSolDraft`**,
the normal shared worker function, using their real saved JEV receipts.
Each replay reproduces the ordered 32 associations, compact references, packet,
statistics and serialized Sol request from the experiment exactly. The old
unversioned template also reproduces its historical Sol wire exactly.

| Corpus | Experiment | Recovered quality source |
| --- | --- | --- |
| K.HOUSE | `ef32f424-3e09-40ef-a057-1bdaa6a4dbd3` | `89eadd38` — uneven hot/cold skewers and salt |
| Bottega 26 | `6c8e6297-b15e-4bfd-b32e-c06577911b2f` | `d2838f11` — dried-out tuna |
| OPTIMIST | `dc676f14-0e32-4827-8acc-a71cdce54ce6` | `5ee0e75b` — barely warm coffee |

The receipt-free reproducibility manifest is
`tests/fixtures/sol-priority-frozen-manifest.json`; local replay results are in
`docs/verification/sol-selector-replay-20261026.json`. Full customer texts and
native receipts remain in the existing local experiment directory, not in CI.

Run the real-corpus replay separately, with no network fallback:

```powershell
$env:HOME_REVIEWS_SELECTOR_REPLAY_ROOT='D:/Codex/GoogleMaps Avis/output/sol-priority-experiment-20261026'
npm run test:selector-replay -- --maxWorkers=1
```

CI runs the synthetic selection, request/resume and PostgreSQL boundary tests,
the implementation fingerprint check, full repository tests, lint, build and
type checks of the three affected server entrypoints. Simulated Sol responses
test wiring and persistence; they do not establish future report quality.

## Future deployment, not executed here

1. Apply **only** `20261026132413_pin_report_evidence_selector.sql`, preserving
   its migration history. Check remote migration drift first: the isolated
   experiment's schema is not part of this PR. Do not apply every local migration
   blindly. This migration neither activates the new default nor wakes work.
2. Deploy these functions from the reviewed integration commit:
   - `process-historical-report-jobs`: load the pinned request and build the protocol/manifest.
   - `jev-batch-experiment`: current batch execution, dossier selection and capability metadata.
   - `process-jls-restaurant`: consistent support for the retained individual V2 route.
3. Confirm the legacy selector remains the global setting and existing requests
   retain their binding. Verify versions without starting a generation.
4. Only on a separate activation decision, run the following transaction.
   Changing this setting makes no supplier call and does not rewrite old requests.

```sql
begin;
set local role service_role;
select public.set_current_report_evidence_selector(
 'sol-evidence-single-negative-source-completion-proposal-v1',
 'Activate the exact a9ed8d5 selector for future report requests only'
);
commit;

select engine,jev_transport,evidence_selector_version,updated_at
from public.report_pipeline_settings where id;
```

## Rollback for future requests

```sql
begin;
set local role service_role;
select public.set_current_report_evidence_selector(
 'jls-direct4-negative-mixed-coverage-v1',
 'Return future report requests to the previous evidence selector'
);
commit;

select engine,jev_transport,evidence_selector_version,updated_at
from public.report_pipeline_settings where id;
```

Keep both implementations deployed while priority-bound requests remain active.
Do not roll back binaries or drop the new columns to change the default: that
would prevent those requests from resuming consistently. Do not reset attempts,
receipts or consumed/unknown calls. Completed reports are unaffected.

## Limits deliberately retained

This is an integration of the tested selector, not a new selection experiment.
The 32-association trade-offs remain: Bottega can lose its distinct five-star
driver-hygiene signal and positive hospitality examples. Sol can still omit a
selected criticism, and JEV or translation errors remain upstream. Three single
Sol runs do not establish universal improvement or a performance gain. No new
report is generated or rewritten by these integration tests.
