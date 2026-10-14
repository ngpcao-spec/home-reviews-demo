import { beforeAll, describe, expect, it, vi } from "vitest";
import { jlsFixture, mockJlsLuna, mockJlsReport, mockAction } from "../fixtures/jev-luna-sol";
import { acceptedSolDossier, buildJlsPlan, JLS_CONFIG, JLS_EVIDENCE_BOUNDARIES, jlsProvenanceMetadata, parseJlsLuna, verifyJlsPlan } from "../../supabase/functions/_shared/jev-luna-sol";
import { hybridHash } from "../../supabase/functions/_shared/jev-hybrid-evidence";
import { validateJlsReport } from "../../supabase/functions/_shared/jev-luna-sol-validation";
import { processJlsJob, simulateJlsLuna, simulateJlsSol, type JlsMockStore } from "../../supabase/functions/_shared/jev-luna-sol-worker";
import { jlsHandler } from "../../supabase/functions/_shared/jev-luna-sol-api";
import { readFileSync } from "node:fs";
let f: Awaited<ReturnType<typeof jlsFixture>>;
beforeAll(async () => { f = await jlsFixture(); });
const allAccepted = async () => (await Promise.all(f.jls.luna_groups.map(async g => (await parseJlsLuna(f.jls, g, mockJlsLuna(g))).decisions))).flat();
const store = () => {
  const seen = new Set<string>(), results: unknown[] = [];
  const storage: JlsMockStore = { reserve: async (phase, key) => { const id=phase+key;if(seen.has(id))return false;seen.add(id);return true; },
    finish: async (_phase, _key, r) => { results.push(r); } };
  return { storage, seen, results };
};
it("free frozen preparation preserves JEV statistics, source, themes and cache identities without network", async () => {
  const before = await hybridHash(f.source), spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("FORBIDDEN_PROVIDER"));
  try {
    const p = await buildJlsPlan(f.source, f.snapshot, "vi");
    expect(p.statistics).toEqual(f.source.body.analytics); expect(p.statistics.themes).toHaveLength(25);
    expect(p.cache_fingerprints).toEqual(f.source.body.cache_fingerprints);
    expect(await hybridHash(f.source)).toBe(before); expect(spy).not.toHaveBeenCalled();
    expect(p.estimates.jev_new_calls).toBe(0); expect(p.evidence_decisions).toBeNull();
    expect(p.accepted_sol_dossier).toBeNull(); expect(p.sol_response).toBeNull(); expect(p.paid_enabled).toBe(false);
  } finally { spy.mockRestore(); }
});
it("same-review questions are grouped; exact English is sent once with no Google metadata", () => {
  expect(f.jls.max_luna_calls).toBe(new Set(f.jls.selected.map(e => e.review_id)).size);
  expect(f.jls.luna_groups.reduce((n,g)=>n+g.payload.questions.length,0)).toBe(f.jls.question_count);
  for (const g of f.jls.luna_groups) {
    expect(Object.keys(JSON.parse(g.payload.input)).sort()).toEqual(["analysis_text", "review_alias"]);
    expect(JSON.parse(g.payload.input).analysis_text).toBe(f.snapshot.source.reviews.find(r=>r.id===g.review_id)!.analysis_text);
    expect(g.payload.questions.map(q=>q.name)).toEqual(g.evidence_ids);
  }
  expect(f.jls.luna_groups.some(g=>g.evidence_ids.length===2)).toBe(true);
});
it("Sol gets exact evidence and provenance hashes, never superseded translation texts or posthoc audit opinions", () => {
  const original={policy:"frozen",provider:{id:"provider-id",sha256:"source-hash",translated_text:"wrong polarity"},
    correction:{source:"recorded-override",corrected_english_sha256:"corrected-hash",corrected_english_text:"exact corrected",evidence_fr:"posthoc opinion"}};
  expect(jlsProvenanceMetadata(original)).toEqual({policy:"frozen",provider:{id:"provider-id",sha256:"source-hash"},correction:{source:"recorded-override",corrected_english_sha256:"corrected-hash"}});
  expect(original.provider.translated_text).toBe("wrong polarity");
});
it.each(["competence", "Friendly/polite", "communication", "price_level", "value", "VAT", "drinks", "cooking", "Portions", "Distance", "Negation", "typos", "mixed sentiments"])("semantic evidence boundary kept: %s", boundary => {
  expect(JLS_EVIDENCE_BOUNDARIES.toLowerCase()).toContain(boundary.toLowerCase());
  expect(f.jls.luna_groups[0].payload.questions[0].instructions).toContain(JLS_EVIDENCE_BOUNDARIES);
});
it("costs from configured rates, unknown Sol tariffs stay unknown, input budget fixed", async () => {
  expect(f.jls.estimates.luna_cost_usd).toBe(f.jls.estimates.luna_input_tokens*.1/1e6);
  expect(f.jls.estimates.sol.estimated_input_tokens).toBeLessThanOrEqual(20000);
  const src=structuredClone(f.source), snap=structuredClone(f.snapshot);
  src.body.estimates.rates.sol_input=null; src.result_sha256=await hybridHash(src.body);
  const p=await buildJlsPlan(src,snap,"fr");expect(p.estimates.total_estimated_cost_usd).toBeNull();
});
it.each(["quote", "analysis_text_sha256", "polarity"])("hash/binding tampering rejected: %s", async key => {
  const p=structuredClone(f.jls);(p.selected[0] as unknown as Record<string,unknown>)[key]="tampered";
  await expect(verifyJlsPlan(p,f.source,f.snapshot)).rejects.toThrow();
});
it("JSONB key reordering is semantically verified without changing historical records", async () => {
  const s=structuredClone(f.source);
  // Reordering the complete object through canonical serialization must not change its hash.
  const { canonicalJson }=await import('../../supabase/functions/_shared/jev-exploratory-core');
  s.body=JSON.parse(canonicalJson(f.source.body));s.result_sha256=await hybridHash(s.body);
  expect((await buildJlsPlan(s,f.snapshot,"fr")).statistics).toEqual(f.jls.statistics);
});
it("supported below confidence threshold is UNCERTAIN; native probabilities preserved", async () => {
  const g=f.jls.luna_groups[0], r=await parseJlsLuna(f.jls,g,mockJlsLuna(g,"supported",.59));
  expect(r.decisions.every(d=>d.status==="UNCERTAIN"&&d.native_choice==="supported"&&d.probabilities!.supported===.96)).toBe(true);
  expect(JLS_CONFIG.confidence_min).toBe(.6);
});
it("refusals and native uncertainty are never accepted", async () => {
  const g=f.jls.luna_groups[0], raw=mockJlsLuna(g);raw.answers=raw.answers.map(a=>({name:a.name,type:"refusal"} as typeof a));
  expect((await parseJlsLuna(f.jls,g,raw)).decisions.every(d=>d.refused&&d.status==="UNCERTAIN")).toBe(true);
  expect((await parseJlsLuna(f.jls,g,mockJlsLuna(g,"uncertain"))).decisions.every(d=>d.status==="UNCERTAIN")).toBe(true);
});
it("wrong model and incomplete response refused", async () => {
  const g=f.jls.luna_groups[0], raw=mockJlsLuna(g);raw.model="gpt-6.1-sol";
  await expect(parseJlsLuna(f.jls,g,raw)).rejects.toThrow();raw.model="gpt-6-luna";raw.answers=[];
  await expect(parseJlsLuna(f.jls,g,raw)).rejects.toThrow();
});
it("Sol dossier includes accepted evidence only without changing full JEV statistics", async () => {
  const decisions=await allAccepted(); const p=f.jls;
  const d=decisions[0];d.native_choice="unsupported";d.status="REJECTED";
  const dossier=await acceptedSolDossier(p,decisions);
  expect(dossier.packet.evidence.some(e=>e.evidence_id===d.evidence_id)).toBe(false);
  expect(dossier.packet.statistics).toEqual(p.statistics);expect(dossier.rejected_ids).toContain(d.evidence_id);
  await expect(acceptedSolDossier(p,decisions.slice(1))).rejects.toThrow("INCOMPLETE");
  d.status="ACCEPTED";await expect(acceptedSolDossier(p,decisions)).rejects.toThrow("BINDING");
});
it("invented IDs, statistics, citations and ungrounded recommendations cannot be validated", async () => {
  const ds=await allAccepted(), raw=mockJlsReport(f.jls,ds.map(d=>d.evidence_id));
  raw.report.conclusion.evidence_ids=["invented"];
  await expect(validateJlsReport(raw,f.jls,f.snapshot,ds)).rejects.toThrow("INVENTED");
  raw.report.conclusion.evidence_ids=[]; raw.report.conclusion.text="422 avis";
  await expect(validateJlsReport(raw,f.jls,f.snapshot,ds)).rejects.toThrow("NUMERIC");
  raw.report.conclusion.text="La couverture reste limitée.";raw.statistics_sha256="changed";
  await expect(validateJlsReport(raw,f.jls,f.snapshot,ds)).rejects.toThrow("STATISTICS");
  raw.statistics_sha256=f.jls.statistics_sha256;
  const extended={...raw,report:{...raw.report,recommendations:[{axis:"service",text:mockAction.wait.fr,action_code:"wait",evidence_ids:[]}]}};
  expect((await validateJlsReport(extended,f.jls,f.snapshot,ds)).report.recommendations[0].status).toBe("review_needed");
  const snap=structuredClone(f.snapshot);snap.source.reviews.find(r=>r.id===f.jls.selected[0].review_id)!.analysis_text="fabricated";
  await expect(validateJlsReport(raw,f.jls,snap,ds)).rejects.toThrow("QUOTE");
});
it("rejected or uncertain references are masked even when Sol cites them", async () => {
  const ds=await allAccepted(), d=ds[0];d.status="UNCERTAIN";d.confidence=.4;
  const raw=mockJlsReport(f.jls,[d.evidence_id]);
  expect((await validateJlsReport(raw,f.jls,f.snapshot,ds)).report.conclusion.status).toBe("review_needed");
});
it("double invocation and network ambiguity never resend paid attempts, mocks only", async () => {
  const s=store(), mock={kind:"explicit_test_mock" as const,luna:vi.fn(async()=>{throw new Error("timeout");}),sol:vi.fn()};
  await Promise.all([simulateJlsLuna(f.jls,s.storage,mock),simulateJlsLuna(f.jls,s.storage,mock)]);
  expect(mock.luna).toHaveBeenCalledTimes(f.jls.max_luna_calls);expect(mock.sol).not.toHaveBeenCalled();
  expect(s.results.every(r=>(r as {status:string}).status==="billing_uncertain")).toBe(true);
  await expect(processJlsJob()).rejects.toThrow("DISABLED");
});
it("one Sol mock maximum, output and calculated cost persisted separately", async () => {
  const ds=await allAccepted(), s=store(), mock={kind:"explicit_test_mock" as const,luna:vi.fn(),sol:vi.fn(async()=>({data:mockJlsReport(f.jls,ds.map(d=>d.evidence_id)),model:"gpt-6.1-sol",input_tokens:200,output_tokens:100,duration_ms:10,response_id:"explicit-mock"}))};
  await simulateJlsSol(f.jls,f.snapshot,ds,s.storage,mock);await simulateJlsSol(f.jls,f.snapshot,ds,s.storage,mock);
  expect(mock.sol).toHaveBeenCalledTimes(1);expect(s.results[0]).toMatchObject({status:"completed",request_count:1,cost_usd:.0014});
});
describe("read-only API and authenticated organization isolation",()=>{
  it.each([["UNAUTHORIZED",401],["FORBIDDEN",403]])("rejects %s",async(error,status)=>{
    const r=await jlsHandler(async()=>{throw new Error(String(error));})(new Request("https://test/"));expect(r.status).toBe(status);
  });
  it("POST cannot create a consent/job or invoke repository",async()=>{
    const read=vi.fn();expect((await jlsHandler(read)(new Request("https://test/",{method:"POST"}))).status).toBe(405);expect(read).not.toHaveBeenCalled();
  });
  it("server scope resolved from requested establishment, never from another experiment",()=>{
    const s=readFileSync('supabase/functions/jev-luna-sol-hybrid/index.ts','utf8');
    expect(s).toContain('ctx.client.from("establishments")');expect(s).toContain('assertMembership');
    expect(s).not.toContain('JLS_SOURCE_PLAN');expect(s).not.toContain('api.openai.com');
  });
});
