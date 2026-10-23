# Guard timeout after the corrected application launch

Run `d05e02ba-597d-4071-ab7a-9e09584e8cdb` stopped with 200 completed
JEV receipts and 326 never-attempted tasks. There were no uncertain tasks and
no Luna or Sol dispatches. PostgreSQL logged 57014 at 02:13:12 UTC in
`jls_restaurant_valid`, called by `claim_parallel_report_task` before the next
reservation. The stopped run remains immutable.

The unchanged authorization predicate measured 207 ms in isolation, versus
14 ms with JIT disabled. Disable JIT on the guard and reservation functions;
retain every access, source, consent, limit and duplicate predicate. Do not
raise SQL timeouts.

`continue_parallel_report_unattempted` is an explicit service-only operation
over the existing queue. It refuses uncertain/running/invalid tasks, missing
receipts, expired/nondelegated grants, changed production references and any
previous Sol operation. It copies exactly compatible completed receipts,
leaves every historical record unchanged, and creates only pending tasks for
reviews never sent. The original grant and its expiry are retained. A source
manifest and operational continuation get separate hashes; semantic
configuration, requests and frozen sources remain unchanged. A per-run cap
limits new JEV reservations to the number never attempted in the source.
The same continuation request returns the existing attempt.

Real SQL rollback qualification created the continuation in 10,893 ms and
reserved all 326 remaining tasks, with a maximum individual claim of 166 ms.
It preserved 200 reused answers, rejected a second run lease, created no
provider dispatch intent and left the blocked source run unchanged. All test
writes rolled back. Creation is an administrative SQL operation, not the
application's 8-second REST launch path. No automatic continuation or paid
retry is introduced.

The worker, JEV short prompt, corrected selector, compact Sol instructions,
Luna cap zero and production reports are unchanged.
