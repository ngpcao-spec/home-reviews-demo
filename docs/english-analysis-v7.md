# English Google review input — V7

New Apify runs always use `GOOGLE_REVIEWS_IMPORT_LANGUAGE='en'`, independent of
the user's FR/VI preference. Existing provider run IDs/dataset IDs and legacy
FR/VI cursors continue without restarting. Original text is the exact `item.text`;
original language is the provider's `originalLanguage`. The provider raw payload
is retained by the existing ingestion path. EN translations are accepted only
when the actual returned `translatedLanguage` normalizes to en (including en-US,
en_GB); the requested locale never substitutes for this validation.

`review_translations` accepts FR, VI and EN with the same review_id/language
unique key and RLS. Upsert EN coexists with every existing FR/VI translation.
Display priority: preferred FR/VI, then EN, then original. Original remains
accessible. No model translates reviews for display or backfill.

## Historical versioning

The manual historical enqueue now requests V7. Active older jobs retain their
version and immutable snapshot. A failed older-version run is not silently
converted into V7; a new explicit V7 request creates a new generation.
Old V6 rows and benchmarks are never migrated, regenerated or overwritten.

V7 snapshots preserve original_text/original_language and add analysis_text,
analysis_language and analysis_source. `analysisTextForReview` chooses original
English first, verified Google EN translation next, then original fallback.
Textless originals remain textless. The fingerprint includes these analytical
fields. `analysis_input_stats` records English coverage and non-English fallback
counts in snapshot.base and the published consultant_report JSON.

V7 extraction sends analysis_text only (plus the existing id/rating tie-breaker),
not English and Russian together. Evidence is grounded in analysis_text; an
unsupported finding is rejected individually. V6 remains grounded in original.
The four axes, diagnostics, thresholds, structured Google context and deterministic
manager conclusion continue. The final narrative remains FR/VI in run.language.
Individual 1–3-star replies and four-star triage still receive original_text/text.

All Jev phases accept completed V6 or V7. The shared benchmarkText selects original
for V6 and frozen analysis_text for V7. V7 state uses analysis_text rather than
mislabeling an English translation as original_text. Comparison records source
version, target analysis_input_language=en and actual coverage/fallback stats.
The user can distinguish original-language V6 from Analyse EN V7 in Test Jev.

## Manual English preparation

The Test Jev screen contains **Préparer les avis en anglais** / **Chuẩn bị đánh
giá bằng tiếng Anh**, current stored-review coverage and an explicit launch button.
Only owner/admin/manager of the selected establishment's organization can enqueue.
The endpoint `backfill-review-english-translations` GET reads coverage/status;
POST creates a durable job. It never accepts an arbitrary organization scope.

Only jobs created by that authenticated click are processed by the private cron
worker `process-review-english-backfill-jobs`. The cron does nothing if its queue
is empty. One active job per establishment, fenced four-minute leases and bounded
single-job claims. A new run requests EN/newest and
`min(max(stored_review_count+50,100),1000)` reviews. Existing IDs are frozen in
the job, without review text. Matching is strictly by external_review_id/reviewId.

The worker writes only EN rows in review_translations plus its own job metadata.
No review update/insert, drafts, notifications, historical run or benchmark write.
It never calls the general import persistence function. Missing translations are
reported through coverage; exceeding the provider safety cap may leave old
reviews uncovered. Provider requests count the start/status/dataset attempts.

Provider runs continue independently of the phone. Cron polls their stored IDs;
transient polling/dataset errors reuse the same run until the 30-minute deadline.
An ambiguous paid start is marked starting before the provider call: if its lease
expires without a saved run ID, the job fails `ENGLISH_APIFY_START_UNCONFIRMED`
instead of automatically creating another paid run. Inspect provider status before
an explicit retry in this case. No automatic cleanup or massive backfill.

Frontend double taps are guarded immediately, serialized across tabs where Web
Locks exists, and carry a durable user/establishment pending reference. Reload and
foreground read GET only; they never POST. A network-ambiguous launch remains
blocked until a server job is found. Finished preparation never enqueues V7 or Jev.
The user checks coverage first, then deliberately regenerates a historical report.

No backfill, historical report or benchmark is launched as part of deployment.
First real preparation is Shabu, manually from the iPhone.
