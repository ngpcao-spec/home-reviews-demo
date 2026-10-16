// Synthetic mobile fixture only. No real report/reference/provider is created.
import {prioritizedFixture} from "../tests/fixtures/jev-luna-sol-prioritized.ts";
import {validateEditorialReport} from "../supabase/functions/_shared/jls-editorial-validation.ts";
import {validateRecommendationReportV2} from "../supabase/functions/_shared/jls-recommendation-contract-v2.ts";
import {structuralRecommendationRevision} from "../supabase/functions/_shared/jls-recommendation-review-v2.ts";
const f=await prioritizedFixture("vi"),original=await validateEditorialReport(f.raw,f.p,f.snapshot,f.decisions);
const rev=structuralRecommendationRevision(f.raw,f.p.statistics_sha256),derived=await validateRecommendationReportV2(rev.raw,f.p,f.snapshot,f.decisions);
const value={id:"11111111-1111-4111-8111-111111111119",sha256:"e".repeat(64),created_at:"2026-10-16",body:{
 version:"jls-recommendation-review-v2",provenance:{commit:"a".repeat(40)},original_revalidation:{validation:original},
 derivative:{validation:derived,changes:rev.changes},future_preparation:{prompt_sha256:"c".repeat(64),schema_sha256:"d".repeat(64)},
 order_candidates:[{review_id:"11111111-1111-4111-8111-111111111118",evidence_id:"f".repeat(64),quote_sha256:"b".repeat(64),
 quote:"They served the wrong dish instead of the soup we ordered.",context:"They served the wrong dish instead of the soup we ordered. Staff apologised.",status:"requires_luna"}],
}};
await Deno.writeTextFile("tests/e2e/fixtures/jls-recommendation-review.json",JSON.stringify({value,original}));

