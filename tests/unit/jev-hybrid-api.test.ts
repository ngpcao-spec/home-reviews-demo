import { expect, it, vi } from "vitest";
import { hybridHandler } from "../../supabase/functions/_shared/jev-hybrid-api";
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
