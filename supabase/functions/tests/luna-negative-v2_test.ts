import {
  blindNegativeExport,
  englishFlags,
  NEG_ORG,
  negativeBootstrap,
  prepareNegativeSet,
  verifyNegativeSet,
} from "../_shared/luna-negative-v2.ts";
import { decisionsHash } from "../_shared/decisions-config.ts";
import { negativeHandler } from "../_shared/luna-negative-v2-api.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("ASSERT_FAILED");
};
Deno.test("negative V2 no-network preparation hashes, grouping, shortage and blind export", async () => {
  const inv = {
    history_tables: ["mock"],
    historical_review_ids: 0,
    total_text_reviews: 1,
    unused: [{
      review_id: "00000000-0000-4000-8000-000000000001",
      organization_id: NEG_ORG,
      establishment_id: "00000000-0000-4000-8000-000000000100",
      establishment_name: "Synthetic",
      rating: 2,
      original_language: "en",
      original_text: "The food was bland and the soup was cold.",
    }],
  };
  const set = await prepareNegativeSet(inv, "2026-10-13");
  await verifyNegativeSet(set, await decisionsHash(set));
  assert(
    set.review_count === 1 && set.question_count === 2 &&
      set.future_calls === 1,
  );
  assert(set.inventory.shortfalls.low_mid === 7);
  assert(set.reviews[0].payload.questions.length === 2);
  assert(Object.keys(blindNegativeExport(set)[0]).length === 4);
  assert(englishFlags("The food is good. 음식 좋아요", "original_en").length);
  assert((await negativeBootstrap(set, [], [], "empty")).intervals === null);
});
Deno.test("negative V2 no dispatch or retry action", async () => {
  let writes = 0;
  const view = {
      record: null,
      reference_seal: null,
      blind_export: null,
      paid_enabled: false as const,
      new_paid_calls: 0 as const,
    },
    handler = negativeHandler(async () => ({
      read: async () => view,
      freeze: async () => {
        writes++;
        return view;
      },
      seal: async () => {
        writes++;
        return view;
      },
    }));
  assert((await handler(new Request("http://local"))).status === 200);
  for (const action of ["launch", "confirm_launch", "wake", "retry"]) {
    assert(
      (await handler(
        new Request("http://local", {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
      )).status === 405,
    );
  }
  assert(writes === 0);
});
