# Explicit one-use diagnostic trial

This is an operator-authorized exception for one definitively rejected private
comparison. It is not a general retry policy or a personalization change.

The server-only authorization RPC accepts an existing parent UUID only. It
requires a completed `invalid_output` receipt with a native request identifier
and output tokens, current organization membership and no prior replay parent.
One grant ever per parent; authorizing it again returns the same grant, without
resetting consumption or expiry. The grant expires after 24 hours if unused.
It contains only identifiers, hashes and timestamps, without user/report text.

Only the existing explicit Compare button enters reservation. Options, ordinary
searches and deployment do not reserve or send anything. While this user's grant
is armed, mismatched request/access/data hashes are blocked, not silently sent
as a different comparison. Other users retain the ordinary circuit.

The native request, model, prompt, validation, content/configuration version and
original cache/request hashes are unchanged. Both original hashes must match
the parent's saved hashes before dispatch. A new child receipt uses a separate
accounting namespace derived from the immutable grant UUID to respect the
existing unique cache index. This is not an artificial version/text change:
the explicit grant links parent and child, and the original cache hash is still
checked. No historical receipt or general lock/index is removed or reset.

Reservation uses the existing organization advisory lock and concurrency ceiling.
Child creation, consumption of the grant and an initial private diagnostic commit
atomically before HTTP. If the diagnostic cannot be saved, no HTTP is sent.
Completion stores the final validation diagnostic and native receipt in a single
transaction. A failed/unknown save leaves the reservation consumed. Double clicks
and future identical clicks join/cache the child; they never send a second call.
An abandoned child is reported unknown, never resent. A child cannot become a
new diagnostic parent. Retain the content-free grant linkage to protect against
duplicate calls; detailed diagnostics keep the existing bounded retention.

Deployment: apply only `20261101061759_recommendation_single_diagnostic_trial.sql`,
then deploy only `test-restaurant-recommendations` with JWT enabled (version >=8).
Keep the client unchanged. After deployment verification, an operator may execute:

```sql
select public.authorize_recommendation_diagnostic_trial_v1('<verified-parent-uuid>'::uuid);
```

This RPC must never be exposed as a user-callable action or invoked automatically.
Arming does not reserve a child or call any provider. Check the grant, unchanged
parent hash and zero child before inviting the user to click. Same text and
filters are required. If data have changed, show the ordinary explicit fallback
with a diagnostic notice; no provider is called to recreate the historical test.

After the user's click, read the grant's child UUID, its receipt and the private
diagnostic rows. Keep historical rows unchanged and do not launch another call
to complete missing observations. No watcher or scheduled task is installed.

Offline tests cover terminal/unknown parents, expiry, hash/runtime guards, one-use
reservation, double click, concurrency, unknown child, atomic diagnostic failure,
accounting, native request equality, access isolation and unchanged ordinary use.
