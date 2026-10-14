import { jlsFixture, mockJlsLuna } from "../../tests/fixtures/jev-luna-sol.ts";
import { acceptedSolDossier, parseJlsLuna } from "../functions/_shared/jev-luna-sol.ts";
import { processJlsJob, simulateJlsLuna } from "../functions/_shared/jev-luna-sol-worker.ts";
const assert = (v: unknown) => { if (!v) throw new Error("ASSERT_FAILED"); };
Deno.test("offline grouped evidence and low confidence remain uncertain", async () => {
  const f=await jlsFixture();
  const ds=(await Promise.all(f.jls.luna_groups.map(async g => (await parseJlsLuna(f.jls,g,mockJlsLuna(g,"supported",.5))).decisions))).flat();
  assert(ds.length===f.jls.question_count);assert(ds.every(d=>d.status==="UNCERTAIN"));
  const dossier=await acceptedSolDossier(f.jls,ds);assert(dossier.accepted_ids.length===0);
  assert(dossier.packet.statistics===f.jls.statistics);
});
Deno.test("offline mobile interruption / repeated wake cannot resend", async () => {
  const f=await jlsFixture(), seen=new Set<string>();let count=0;
  const s={reserve:(_phase:string,key:string)=>{if(seen.has(key))return Promise.resolve(false);seen.add(key);return Promise.resolve(true);},finish:()=>Promise.resolve()};
  const m={kind:"explicit_test_mock" as const,luna:()=>{count++;return Promise.reject(new Error("network ambiguity"));},sol:()=>Promise.reject(new Error("SOL_MUST_NOT_RUN"))};
  await simulateJlsLuna(f.jls,s,m);await simulateJlsLuna(f.jls,s,m);assert(count===f.jls.max_luna_calls);
  try { await processJlsJob();throw new Error("OPEN"); } catch(e) { assert(String(e).includes("DISABLED")); }
});
