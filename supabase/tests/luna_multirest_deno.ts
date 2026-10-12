import {
  blindMultiExport,
  dispatchMultirest,
  selectMultiCandidate,
  verifyMultiReferences,
} from "../functions/_shared/luna-multirest.ts";
import { decisionsHash } from "../functions/_shared/decisions-config.ts";
import {
  mockMultiReferences,
  mockMultiSet,
} from "../../tests/fixtures/luna-multirest.ts";
function assert(v: unknown, m: string) {
  if (!v) throw new Error(m);
}
Deno.test("multirest candidate selection and blind export are offline and deterministic", async () => {
  const a = await selectMultiCandidate("id", "Nice!"),
    b = await selectMultiCandidate("id", "Nice!");
  assert(JSON.stringify(a) === JSON.stringify(b), "nondeterministic");
  assert(
    a.quote === null && a.basis === "no_specific_theme_anchor",
    "generic praise became evidence",
  );
  const s = await mockMultiSet(),
    e = blindMultiExport(s, await decisionsHash(s));
  assert(e.items.length === 40, "wrong count");
  assert(
    e.items.every((i) =>
      Object.keys(i).length === 4 && !("polarity" in i) && !("rating" in i)
    ),
    "blind export leaked",
  );
});
Deno.test("reference sealing requires all labels; no paid dispatcher can run", async () => {
  const s = await mockMultiSet(), r = await mockMultiReferences(s);
  r.items[0].choice = "uncertain";
  const p = await verifyMultiReferences(s, await decisionsHash(s), r);
  assert(p.body.items[0].choice === "uncertain", "lost uncertainty");
  let rejected = false;
  try {
    await dispatchMultirest();
  } catch {
    rejected = true;
  }
  assert(rejected, "paid path enabled");
});
