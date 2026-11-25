# Codex delegation — Luna Negative V2: one execution only

**User authorization:** 13 Oct 2026, ChatGPT conversation: the user expressly requested that Codex execute the already-prepared Luna V2 experiment on their behalf to avoid having to click the launch button in the iPhone app, and then said **« Go »** to set up direct delegation. This authorization is limited to **this single experiment**, not all future paid benchmarks. Use a legitimate authenticated delegated action; the user's statement is not a reusable bearer credential.

## Immutable scope — verify before taking any action

- Repo: `ngpcao-spec/home-reviews-demo` ; Supabase project: `ihuztjkblywzjdruusdj`.
- Organization: `93228bbb-6397-41e3-b8be-21ee7060eda7`.
- Dataset ID: `c8b3eee7-2554-43d9-a16b-5e12413af793`.
- Dataset SHA256: `6e464e2f0fa13ae1f83168b65a04e3de3e396fc0c1150d08ba71e8e30b008189`.
- GPT-6 AI reference seal: `c4031dc6-e0a3-4992-bb35-f790ecccd034`.
- Reference SHA256: `048df28c19e95a25e426ebb08fbb58665634027f85906712072b94e788818592`.
- Configuration: `luna-negative-focused-v2-choice-v1`.
- Model and endpoint: `gpt-6-luna`, OpenAI `POST /v1/decisions`.
- **28 unique reviews, 32 questions, at most 28 billable provider requests**, one attempt/review, 4 reviews contain 2 questions each and must be combined into one request.
- **Zero automatic paid retries** even on timeouts, transient errors, unknown billing or lost worker response. No additional ceiling in USD requested.
- Estimate **19,038 input tokens / USD 0.0019038** at recorded standard rate; not a guarantee of invoice or any regional surcharge.
- Source `docs/luna-negative-v2-manual-launch-20261013.md` and existing Supabase `luna_nv2_*` functions; **reuse existing durable worker and DB invariants**, avoid rebuilding.
- All GPT-6 labels are AI-only reference judgments and not independent human truth.
- The GPT-6 references are sealed. Never touch them, nor JEV V11/V12/V13, Sol, prior Luna experiments, production analyses, translations or historical reports.

## Action for the delegated Codex agent

1. **Read first:** query `analysis_luna_negative_v2_plans`, `runs`, `tasks`, `results`, `reference_seals`. At PR creation the latest checked state was **0 plans, 0 runs, 0 tasks, 0 results, 1 seal**; verify afresh immediately before attempting. If ANY existing run, do not create another; read/report its status, count and cost instead.
2. Decide if this Codex session has an **authorized, auditable user-delegation capability** for paid execution (e.g. a legitimate user-attested Work/Codex session that can invoke the existing confirmation mechanism under the actual owner identity). The intent is to **avoid user interaction on iPhone**. The consent above establishes scope, but **never forge a session, manipulate `auth.uid()`, or insert `confirmed_by` / authorization rows as an impersonation workaround**. Do not bypass RLS, authentication or the server's single-attempt/no-duplicate safety rules.
3. **Only if a legitimate execution channel is available**, prepare the free signed manifest, confirm the fixed 28-call scope and latest cost estimate, trigger this run exactly once, then let the existing durable worker do the calls. No other provider: no JEV, Sol, Apify, Responses, another Luna run, or translations.
4. Monitor the resulting run via read-only checks until terminal when practical; record tasks (<=28), question answers (<=32), retries (0), errors and `billing_uncertain`, served model, input/output tokens, price calculated from reported usage (distinguish unverified invoice). Compare Luna choices to sealed GPT-6 AI reference excluding `uncertain`, with no production rollout.
5. **If Codex/GitHub cannot legitimately initiate this delegated run**, stop and report exactly what additional product-level delegation/connection is needed. **Do not claim to have launched it.** In that event, improve only the *non-paying* UX/setup where demonstrably helpful.
6. Longer-term, propose a reusable **explicit-approval-per-benchmark** delegation workflow in ChatGPT Work/Codex with GitHub-connected task triggers and audit trail, without silently starting future paid tests. Important: this repository has GitHub Issues disabled; use PR workflows if supported.

No need for another iPhone click *if* an authorized delegated execution route is available. Never embed API keys or access tokens in source or PR comments. If access is missing, fail safe.
