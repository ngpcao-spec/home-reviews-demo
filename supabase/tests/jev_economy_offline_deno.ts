import {ECONOMY_CONFIG,COMPACT_CONFIG,economyPayload} from '../functions/_shared/jev-economy-config.ts'
import {economyMetrics,economyPrediction,type EconomyTask} from '../functions/_shared/jev-economy-score.ts'
import {dispatchEconomicAnalysis,economyIdentity} from '../functions/_shared/jev-economy-cache.ts'
import {THEME_KEYS,type ThemeDecision} from '../functions/_shared/jev-themes.ts'
const assert=(value:unknown)=>{if(!value)throw new Error('ASSERTION_FAILED')}
Deno.test('independent one-pass config / compact disabled / 25 themes / no metadata',()=>{assert(ECONOMY_CONFIG.repeat_count===1&&!COMPACT_CONFIG.paid_enabled);assert(Object.keys(economyPayload('r','text').state).join(',')==='review_alias,analysis_text');assert(THEME_KEYS.length===25)})
Deno.test('one pass uses its probability, zero support is null',()=>{const response:ThemeDecision={themes:Object.fromEntries(THEME_KEYS.map(k=>[k,{choice:'negative',probabilities:{absent:0,positive:0,negative:1,both:0}}])) as ThemeDecision['themes']},t:EconomyTask={id:'1',review_id:'r',repeat:1,status:'completed',response,served_model:'jev-fixed',input_tokens:1,output_tokens:0,cost_usd:0,request_count:1,retry_count:0,duration_ms:1,usage_complete:true};assert(economyPrediction([t],'r','food_quality','pass1').negative===1);assert(economyMetrics({tp:0,fp:1,fn:0,support:0}).f1===null)})
Deno.test('disabled engine and unpinned served model rejected, never network',async()=>{let blocked=0;try{await dispatchEconomicAnalysis()}catch{blocked++}try{await economyIdentity('o','e','r','text','jev-latest')}catch{blocked++}assert(blocked===2)})
