import {THEME_KEYS,themePayload,type ThemeKey} from './jev-themes.ts'
import {benchmarkPayload,UNTRUSTED,type SystemOnePayload} from './jev.ts'
import {v9Payload} from './historical-v9-core.ts'
export const V10_THRESHOLD_VERSION='jev-theme-thresholds-v1'
export const V10_QUESTION_SET='themes_v10_calibrated_v1'
export const V10_DEFAULT_THRESHOLD=.70
type Polarity='positive'|'negative'
const overrides:Partial<Record<ThemeKey,number>>={friendly_staff:.60,attentiveness:.60,wait_time:.60,coordination:.70,communication:.85,professionalism:.75,atmosphere:.60}
export const V10_THRESHOLDS=Object.freeze(Object.fromEntries(THEME_KEYS.map(theme=>{const threshold=overrides[theme]??V10_DEFAULT_THRESHOLD;return [theme,Object.freeze({positive_threshold:threshold,negative_threshold:threshold})]}))) as Record<ThemeKey,{positive_threshold:number;negative_threshold:number}>
export const v10Threshold=(theme:ThemeKey,polarity:Polarity)=>V10_THRESHOLDS[theme]?.[`${polarity}_threshold`]??V10_DEFAULT_THRESHOLD
// Repeated decimal probabilities may average one ULP below the configured boundary.
// Accept only arithmetic noise, never a materially lower probability.
export const meetsV10Threshold=(probability:number,threshold:number)=>probability>=threshold||Math.abs(probability-threshold)<=8*Number.EPSILON
export const V10_DEFINITIONS={
  communication:'Explicit communication directly with the customer: explanations, clear or unclear information, understanding or misunderstanding, a language communication problem, listening to customer requests, or direct communication with the customer. Do NOT infer communication from friendly staff, helpful staff, good service, attentive staff, professional staff or fast service without an explicit communication concept.',
  professionalism:'Explicit competence, expertise, professional conduct, knowledgeable staff, capable handling of a situation, or serious/professional behaviour. Do NOT infer professionalism solely from great service, friendly, nice, attentive, fast or helpful.',
  attentiveness:'Attention to customer needs: attentive, responsive, helpful to customer needs, proactive assistance, checking on guests, or noticing what is needed. Explicit expressions of attentiveness, responsiveness or customer care are sufficient; do not require a detailed incident. Generic good service alone does not establish this theme.',
  coordination:'Organization and synchronization of service: staff worked smoothly together, service was well organized, or multiple staff coordinated the table. Do NOT infer coordination solely from good service or fast service.',
} as const
export function v10Payload(kind:'sentiment'|'themes',alias:string,text:string):SystemOnePayload{
  if(kind==='sentiment')return v9Payload(kind,alias,text)
  const p=themePayload('jev-latest',alias,text)
  for(const theme of Object.keys(V10_DEFINITIONS) as (keyof typeof V10_DEFINITIONS)[])p.questions[theme]={...p.questions[theme] as Record<string,unknown>,instructions:`Determine whether the review text explicitly expresses an opinion about this theme. ${V10_DEFINITIONS[theme]} Do not infer sentiment from stars or metadata. ${UNTRUSTED}`}
  return benchmarkPayload(p,7)
}
