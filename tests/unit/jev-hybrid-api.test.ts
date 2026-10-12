import { expect, it, vi } from "vitest";
import { hybridHandler } from "../../supabase/functions/_shared/jev-hybrid-api";
import { hybridFixture } from "../fixtures/jev-hybrid";
import { buildBalancedPlan } from "../../supabase/functions/_shared/jev-hybrid-balanced";
import { hybridHash } from "../../supabase/functions/_shared/jev-hybrid-evidence";
it("HTTP cannot start, authorize or prepare a paid action; GET only", async () => {
  const read = vi.fn(async () => ({
      plan: null,
      control: null,
      jobs: [],
      paid_enabled: false as const,
      can_generate: false as const,
      production_enabled: false as const,
      new_paid_calls: 0 as const,
    })
    ),
    repository = vi.fn(async () => ({ read })),
    handler = hybridHandler(repository);
  for (
    const action of ["generate", "authorize", "start", "sol", "jev", "prepare"]
  ) {
    const response = await handler(
      new Request("https://unit", {
        method: "POST",
        body: JSON.stringify({ action, confirm_cost: true }),
      }),
    );
    expect(response.status).toBe(405);
  }
  expect(repository).not.toHaveBeenCalled();
  expect((await handler(new Request("https://unit"))).status).toBe(200);
  expect(read).toHaveBeenCalledTimes(1);
});
it("membership failures cannot expose any plan", async () =>
  expect(
    (await hybridHandler(async () => {
      throw new Error("FORBIDDEN");
    })(new Request("https://unit"))).status,
  ).toBe(403));
it("balanced comparison is hash checked against unchanged V1, never triggers processing",async()=>{
  const f=await hybridFixture(),balanced=await buildBalancedPlan(f.snapshot,f.cache,[],"fr",f.plan);
  const view={plan:{id:"v1",body:f.plan,result_sha256:await hybridHash(f.plan),created_at:"fixture"},balanced:{id:"v11",body:balanced,result_sha256:await hybridHash(balanced),created_at:"fixture"},control:null,jobs:[],paid_enabled:false as const,can_generate:false as const,production_enabled:false as const,new_paid_calls:0 as const};
  const handler=hybridHandler(async()=>({read:async()=>view}));
  expect((await handler(new Request("https://unit"))).status).toBe(200);
  view.balanced.body.statistics_sha256="changed";
  expect((await handler(new Request("https://unit"))).status).toBe(409);
});
