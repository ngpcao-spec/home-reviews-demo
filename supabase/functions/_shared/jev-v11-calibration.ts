import {THEME_KEYS,THEME_DEFINITIONS,themePayload,type ThemeKey} from './jev-themes.ts'
import {benchmarkPayload,UNTRUSTED,type SystemOnePayload} from './jev.ts'
import {v9Payload} from './historical-v9-core.ts'
export const V11_THRESHOLD_VERSION='jev-theme-thresholds-v2'
export const V11_QUESTION_SET='themes_v11_human_aligned_v1'
export const V11_DEFAULT_THRESHOLD=.60
type Thresholds={positive_threshold:number;negative_threshold:number}
const overrides:Partial<Record<ThemeKey,Thresholds>>={
  friendly_staff:{positive_threshold:.55,negative_threshold:.55},attentiveness:{positive_threshold:.60,negative_threshold:.70},wait_time:{positive_threshold:.55,negative_threshold:.55},
  coordination:{positive_threshold:.50,negative_threshold:.70},communication:{positive_threshold:.85,negative_threshold:.85},professionalism:{positive_threshold:.60,negative_threshold:.80},atmosphere:{positive_threshold:.55,negative_threshold:.55},
}
export const V11_THRESHOLDS=Object.freeze(Object.fromEntries(THEME_KEYS.map(theme=>[theme,Object.freeze(overrides[theme]??{positive_threshold:V11_DEFAULT_THRESHOLD,negative_threshold:V11_DEFAULT_THRESHOLD})]))) as Record<ThemeKey,Thresholds>
export const v11Threshold=(theme:ThemeKey,polarity:'positive'|'negative')=>V11_THRESHOLDS[theme]?.[`${polarity}_threshold`]??V11_DEFAULT_THRESHOLD
export const meetsV11Threshold=(probability:number,threshold:number)=>probability>=threshold||Math.abs(probability-threshold)<=8*Number.EPSILON
// These four interpretations extend the V9 base; no V10 service question is imported.
export const V11_INTERPRETATIONS={
  attentiveness:'Use the broad V9 meaning of attention, availability and customer care. Attentive, customer-focused, caring, responsive, helpful, good attention to customers, or positively evaluated overall service that clearly describes how staff take care of guests may count. "Very good service and warm pleasant staff" can express positive customer care. Do NOT require a detailed incident, checking on the table, or noticing a particular need. Do not infer this from friendliness alone or from metadata.',
  professionalism:'Use the V9 meaning of positively or negatively evaluated staff attitude and service execution. Clearly good quality of service delivery, excellent service, professional/helpful execution, useful assistance, staff showing customers how something works, capable service, or strong overall service delivery may count. Do NOT require the words professional, expert or competent. "The waitress is very nice" ALONE, without an evaluation of service execution or a useful action, must NOT automatically create professionalism.',
  coordination:'Use the broad V9 meaning of service organization and good execution of service. Explicit "excellent service" or "good service" can express positive coordination when evaluating overall service execution. Do NOT require descriptions of multiple staff, synchronization or workflow. "Everything arrived quickly" ALONE is primarily wait_time and must NOT automatically create coordination from speed alone.',
  communication:'Require explicitly evaluated or described communication directly with a customer: an explanation, information given, understanding/misunderstanding, listening, verbal exchange, a communication problem, or a language problem affecting the interaction. Do NOT infer communication solely from friendly/helpful staff, good service, attentive/professional staff, fast service or staff speaking a language. "They speak Russian" ALONE is absent: language ability without an evaluated or described customer interaction is insufficient. "The waiter clearly explained how the menu worked" is positive; "They could not understand our order" is negative.',
} as const
export function v11Payload(kind:'sentiment'|'themes',alias:string,text:string):SystemOnePayload{
  if(kind==='sentiment')return v9Payload(kind,alias,text)
  const payload=themePayload('jev-latest',alias,text)
  for(const theme of Object.keys(V11_INTERPRETATIONS) as (keyof typeof V11_INTERPRETATIONS)[])payload.questions[theme]={...payload.questions[theme] as Record<string,unknown>,instructions:`Determine whether the customer's ANALYTICAL review text expresses an opinion about ${THEME_DEFINITIONS[theme]}. ${V11_INTERPRETATIONS[theme]} Do not infer sentiment from stars, metadata or unsupported assumptions. ${UNTRUSTED}`}
  return benchmarkPayload(payload,7)
}
