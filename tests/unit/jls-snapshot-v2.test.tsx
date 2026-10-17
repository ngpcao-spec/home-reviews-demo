import {it,expect,vi,afterEach} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {readFileSync} from "node:fs";
import {historicalSnapshotFingerprint,prepareSnapshotV2,snapshotV2Configuration,SNAPSHOT_V2,type FrozenHistorical} from "../../supabase/functions/_shared/jls-snapshot-v2";
import {I18nProvider} from "../../src/i18n";
import {JlsRestaurantPreparation,type RestaurantView} from "../../src/components/analysis/JlsRestaurantPreparation";
import {restaurantConfiguration} from "../../supabase/functions/_shared/jls-restaurant";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {ECONOMY_CONFIG} from "../../supabase/functions/_shared/jev-economy-config";
afterEach(cleanup);
it("historical fingerprint restores the exact V7 field order independent of JSONB outer order",async()=>{
 const r={id:"synthetic",rating:2,original_text:"Synthetic original",text:"Synthetic",published_at:null,historical_import:true,has_negative_feedback:false,status:"new",review_detailed_rating:null,review_context:null,ready:false,original_language:"en",analysis_text:"Synthetic original",analysis_language:"en",analysis_source:"original_en"};
 const s={analysis_version:7,reviews:[r],base:{google_total_reviews:1,google_rating:2},publication:{}} as unknown as FrozenHistorical["snapshot"];
 const a=await historicalSnapshotFingerprint(s);s.reviews=[Object.fromEntries(Object.entries(r).reverse()) as unknown as typeof s.reviews[number]];
 expect(await historicalSnapshotFingerprint(s)).toBe(a);s.reviews[0].analysis_text+=" changed";expect(await historicalSnapshotFingerprint(s)).not.toBe(a);
});
it("unknown historical fields and fake source references fail closed",async()=>{
 const s={analysis_version:7,reviews:[{id:"synthetic",injected:1}],base:{},publication:{}} as unknown as FrozenHistorical["snapshot"];
 await expect(historicalSnapshotFingerprint(s)).rejects.toThrow("JLS_FROZEN_REVIEW_SCHEMA_CHANGED");
 const net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("FORBIDDEN_NETWORK"));
 await expect(prepareSnapshotV2({id:"wrong",snapshot:s} as FrozenHistorical,[],"synthetic","jev-1.13.0")).rejects.toThrow("JLS_HISTORICAL_SNAPSHOT_CHANGED");
 expect(net).not.toHaveBeenCalled();net.mockRestore();
});
it("V2 keeps the exact economic questions while historical instructions remain unchanged",async()=>{
 const before=await hybridHash(await restaurantConfiguration()),c=await snapshotV2Configuration();
 expect(c.policy.format_version).toBe("jls-prioritized-recommendations-v2");expect(c.policy.version).toBe(SNAPSHOT_V2);
 expect(c.jev_request_template.questions).toEqual(ECONOMY_CONFIG.questions);expect(Object.keys(c.jev_request_template.questions)).toHaveLength(25);
 expect(c.policy).toMatchObject({automatic_retry:false,provider_client_retries:0,max_sol_calls:1,apify_calls:0});
 expect(await hybridHash(await restaurantConfiguration())).toBe(before);
});
it("SQL limits sources, costs zero at preparation, and never authorizes or wakes during migration",()=>{
 const sql=readFileSync("supabase/migrations/20261017024212_jls_chill_snapshot_v2_preparation.sql","utf8");
 expect(sql).toContain("JLS_COMPLETED_CACHE_REQUIRED_NO_MOCK");expect(sql).toContain("JLS_NATIVE_QUALIFICATION_REQUIRED");
 expect(sql).toContain("count(distinct c.review_id)");expect(sql).toContain("enable row level security");
 expect(sql).not.toMatch(/(?:update|delete from|insert into) public\.(?:historical_report_runs|historical_establishment_reports|reviews|review_translations)\b/i);
 expect(sql).not.toMatch(/^\s*(?:select|perform) public\.(?:authorize|wake)_/mi);
 const server=readFileSync("supabase/functions/process-jls-restaurant/index.ts","utf8");
 expect(server.indexOf('mode==="snapshot_v2_probe"')).toBeLessThan(server.indexOf('Deno.env.get("OPENAI_API_KEY")'));
});
it.each(["fr","vi"] as const)("%s clearly separates 100 and 80 and has no paid launch",language=>{
 const data:RestaurantView={protocol:{id:"synthetic",sha256:"a".repeat(64),created_at:"2026-10-17",establishment_name:"SYNTHETIC CHILL",source_sha256:"b".repeat(64),configuration_sha256:"c".repeat(64),
 coverage:{google_total:2745,stored_reviews:100,reviews_with_text:80,english_ready:80,reused_analyses:0,missing_analyses:80,missing_english:0},max_jev_calls:80,max_luna_calls:32,max_sol_calls:1,language:"vi",format_version:"jls-prioritized-recommendations-v2",editorial_version:"jls-recommendation-contract-v2"},
 frozen_source:{establishment_id:"synthetic",historical_run_id:"synthetic-historical",source_fingerprint:"d".repeat(64),source_ids:[],statistics_denominators:{overall:100,thematic:80},no_paid_go:true,immutable_historical_report:true},run:null,result:null,progress:null};
 render(<I18nProvider language={language}><JlsRestaurantPreparation data={data}/></I18nProvider>);
 expect(screen.getByTestId("jls-frozen-source")).toHaveTextContent("100");expect(screen.getByTestId("jls-frozen-source")).toHaveTextContent("80");
 expect(screen.getAllByRole("button").filter(b=>b.hasAttribute("disabled"))).toHaveLength(1);
 expect(screen.getByTestId("jls-restaurant-preparation").textContent).not.toMatch(/USD|coût|chi phí/i);
});
