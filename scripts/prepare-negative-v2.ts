// Local deterministic preparation; no network or provider client.
import {
  prepareNegativeSet,
  verifyNegativeSet,
} from "../supabase/functions/_shared/luna-negative-v2.ts";
import { decisionsHash } from "../supabase/functions/_shared/decisions-config.ts";
const [input, output, asOf] = Deno.args;
const inventory = JSON.parse(await Deno.readTextFile(input));
const body = await prepareNegativeSet(inventory, asOf),
  sha = await decisionsHash(body);
await verifyNegativeSet(body, sha);
await Deno.writeTextFile(output, JSON.stringify({ body, sha }, null, 2));
console.log(JSON.stringify({
  reviews: body.review_count,
  questions: body.question_count,
  calls: body.future_calls,
  inventory: body.inventory.available,
  shortfalls: body.inventory.shortfalls,
  restaurants: body.restaurants,
  stars: body.star_distribution,
  tokens: body.estimated_input_tokens,
  cost: body.estimated_cost_usd,
  themes: body.theme_distribution,
}));
