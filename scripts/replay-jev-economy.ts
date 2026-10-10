/** Offline only. Input is a PRIVATE export of EconomySource[]; never commit review text.
 * npx deno run --cached-only --deny-net --allow-read --allow-write scripts/replay-jev-economy.ts input.json output.json
 * Does not write to Supabase, create a benchmark, retry, or call any provider.
 */
import {compareEconomySource,type EconomySource} from '../supabase/functions/_shared/jev-economy-score.ts'
declare const Deno:{args:string[];readTextFile:(path:string)=>Promise<string>;writeTextFile:(path:string,data:string)=>Promise<void>}
const [input,output]=Deno.args;if(!input||!output||input===output)throw new Error('Provide different private input/output file paths');
const sources=JSON.parse(await Deno.readTextFile(input)) as EconomySource[];if(!Array.isArray(sources))throw new Error('Expected an EconomySource array');
const comparisons=await Promise.all(sources.map(compareEconomySource));await Deno.writeTextFile(output,JSON.stringify({new_paid_calls:0,comparisons},null,2));
