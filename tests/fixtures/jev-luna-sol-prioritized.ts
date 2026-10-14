import { syntheticPilot, pilotDecision } from "./jev-pilot.ts";
import { resolvePilotReviews, pilotSourceHash } from "../../supabase/functions/_shared/jev-pilot-core.ts";
import { economyIdentity, economyCacheKey, economicThemeResults } from "../../supabase/functions/_shared/jev-economy-cache.ts";
import { buildHybridPlan, hybridHash } from "../../supabase/functions/_shared/jev-hybrid-evidence.ts";
import { buildBalancedPlan } from "../../supabase/functions/_shared/jev-hybrid-balanced.ts";
import { buildJlsPlan, parseJlsLuna } from "../../supabase/functions/_shared/jev-luna-sol.ts";
import { buildPrioritizedDraft, JLS_PRIORITIZED_VERSION } from "../../supabase/functions/_shared/jev-luna-sol-prioritized.ts";
import { mockJlsLuna, mockJlsReport } from "./jev-luna-sol.ts";
import type { PrioritizedResponse } from "../../supabase/functions/_shared/jev-luna-sol-prioritized-validation.ts";
export async function prioritizedFixture(language: "fr" | "vi" = "fr") {
  const f = await syntheticPilot(), cases = [
    { text: "We waited a long time for our food on the terrace. The waiter later apologised and offered a discount.", themes: ["wait_time:negative"] },
    { text: "The bill included a service fee that was not announced. Staff explained it afterwards.", themes: ["billing:negative"] },
    { text: "The soup was delicious but the portion was too small. The waitress offered an extra serving.", themes: ["food_quality:positive", "portions:negative"] },
    { text: "The restaurant is far from the city center but the atmosphere was lovely.", themes: ["location:negative", "atmosphere:positive"] },
    { text: "The coffee was delicious. Our pasta was overcooked, but staff offered to replace it.", themes: ["drinks:positive", "cooking:negative"] },
    { text: "The waiter could not understand our order. Even with a translator communication was difficult.", themes: ["communication:negative"] },
  ];
  cases.forEach((c, i) => { f.raw[i].original_text = c.text; f.raw[i].original_language = "en"; });
  const reviews = await resolvePilotReviews(f.raw, [], f.snapshot.organization_id, f.snapshot.establishment_id, "2026-10-14"), cache = [];
  for (const [i, c] of cases.entries()) {
    const r = reviews.find(r => r.id === f.raw[i].id)!, response = pilotDecision();
    for (const key of c.themes) {
      const [theme, polarity] = key.split(":"); response.themes[theme as keyof typeof response.themes] = {
        choice: polarity as "positive" | "negative", probabilities: { absent: 0, both: 0, positive: polarity === "positive" ? 1 : 0, negative: polarity === "negative" ? 1 : 0 },
      };
    }
    const identity = await economyIdentity(r.organization_id, r.establishment_id, r.id, r.analysis_text!, "jev-1.13.0");
    cache.push({ ...identity, id: "mock-" + r.id, cache_key: await economyCacheKey(identity), response,
      theme_results: economicThemeResults(response), status: "completed" as const, served_model: "jev-1.13.0",
      processed_at: "2026-10-14", source_task_id: "explicit_mock_only", input_tokens: 8000, output_tokens: 1000, cost_usd: .000336, usage_complete: true });
  }
  f.snapshot.source.reviews = reviews; f.snapshot.source_sha256 = await pilotSourceHash(f.snapshot.source);
  const hybrid = await buildHybridPlan(f.snapshot, cache, [], language), balanced = await buildBalancedPlan(f.snapshot, cache, [], language, hybrid);
  const source = { id: "explicit_synthetic_prioritized_source", body: balanced, result_sha256: await hybridHash(balanced) },
    p = await buildJlsPlan(source, f.snapshot, language),
    decisions = (await Promise.all(p.luna_groups.map(async g => (await parseJlsLuna(p, g, mockJlsLuna(g))).decisions))).flat();
  const draft = await buildPrioritizedDraft(p, decisions, language);
  const raw: PrioritizedResponse = { ...mockJlsReport(p, draft.accepted_ids), format_version: JLS_PRIORITIZED_VERSION };
  const e = p.selected.find(e => e.theme_key === "wait_time")!, context = draft.packet.evidence.find(x => x.evidence_id === e.evidence_id)!;
  raw.report.recommendations = [{ title: language === "fr" ? "Suivre les délais de service" : "Theo dõi thời gian phục vụ", axis: "service", topic: "service_flow", evidence_ids: [e.evidence_id],
    observations: [{ text: language === "fr" ? "Un client rapporte une longue attente sur la terrasse." : "Một khách phản ánh phải đợi lâu ở sân hiên.", evidence_id: e.evidence_id, theme_key: e.theme_key, polarity: e.polarity,
      quote: e.quote, quote_sha256: e.quote_sha256, context_quote: e.context, context_sha256: context.context_sha256,
      context_summary: language === "fr" ? "Le serveur a ensuite présenté des excuses et proposé une remise." : "Nhân viên sau đó xin lỗi và đề nghị giảm giá." }],
    proposed_action: { text: language === "fr" ? "Examiner le suivi des commandes sur la terrasse, en tenant compte de la prise en charge ultérieure." : "Xem xét việc theo dõi đơn tại sân hiên, có tính đến cách xử lý sau đó.", kind: "inspect", focus: "service_delay" },
    priority: { rank: 1, reason: language === "fr" ? "Ce délai décrit par un client constitue un point concret à vérifier." : "Thời gian chờ được khách mô tả là điểm cụ thể cần kiểm tra.", basis: "isolated_signal_to_verify", frequency_keys: [] } }];
  return { ...f, p, decisions, draft, raw };
}
