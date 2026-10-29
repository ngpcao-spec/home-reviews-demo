/** Structured Google fields only. No review prose, score, cuisine, FX or network. */
export type MoneyRange = {status:'parsed'|'unparsed';currency:string|null;minimum:number|null;maximum:number|null;bounds:'closed'|'above'|'below'|'unknown'};
const unknown = (): MoneyRange => ({status:'unparsed',currency:null,minimum:null,maximum:null,bounds:'unknown'});
const normal = (s:string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().trim();
const perPersonSuffix = /\s*(?:\bper person|\bpar personne|\bmoi nguoi|\/\s*(?:nguoi|personne|person))\s*$/;
/** Explicit Google price label only; neither a unit flag nor customer spending proves this. */
export function googlePerPersonPriceLabel(raw:unknown):raw is string {
  return typeof raw==='string' && perPersonSuffix.test(normal(raw)) && googleMoneyRange(raw).status==='parsed';
}
function amount(s:string,currency:string,inherit=1): {value:number;unit:number}|null {
  const m=/^([\d.,\s]+?)\s*(n|tr|k|nghin|ngan|trieu|thousand|million)?$/i.exec(s.trim());
  if(!m)return null;
  const units:Record<string,number>={n:1000,tr:1000000,k:1000,nghin:1000,ngan:1000,trieu:1000000,thousand:1000,million:1000000};
  const unit=m[2]?units[m[2].toLowerCase()]:inherit;
  if(m[2] && /^(n|tr|nghin|ngan|trieu)$/i.test(m[2]) && currency!=='VND')return null;
  let digits=m[1].trim();
  if(currency==='VND') {
    if(/^\d{1,3}(?:[.,\s]\d{3})+$/.test(digits))digits=digits.replace(/[.,\s]/g,'');
    else if(!/^\d+(?:[.,]\d{1,2})?$/.test(digits))return null;
    else digits=digits.replace(',','.');
  } else {
    // Ambiguous 1.000/1,000 in another currency is deliberately not guessed.
    if(!/^\d+(?:[.,]\d{1,2})?$/.test(digits))return null;
    digits=digits.replace(',','.');
  }
  const value=Number(digits)*unit;
  return Number.isFinite(value)&&value>=0&&Number.isSafeInteger(value*100)?{value,unit}:null;
}
export function googleMoneyRange(raw:unknown):MoneyRange {
  if(raw && typeof raw==='object' && !Array.isArray(raw)) {
    const r=raw as Record<string,unknown>;
    return typeof r.currency==='string'&&/^[A-Z]{3}$/.test(r.currency)&&typeof r.minimum==='number'&&typeof r.maximum==='number'
      &&Number.isFinite(r.minimum)&&Number.isFinite(r.maximum)&&r.minimum>=0&&r.maximum>=r.minimum
      ?{status:'parsed',currency:r.currency,minimum:r.minimum,maximum:r.maximum,bounds:'closed'}:unknown();
  }
  if(typeof raw!=='string')return unknown();
  let text=raw.replace(/[\u00a0\u202f]/g,' ').trim();
  const codes=text.match(/\b(?:VND|USD|EUR|KRW|JPY|THB|SGD|AUD|CAD|GBP|CNY)\b/g)??[];
  const currencies=new Set([...codes,...text.includes('₫')?['VND']:[],...text.includes('€')?['EUR']:[]]);
  if(currencies.size!==1 || /[$£₩¥]/.test(text.replace(/\b(?:USD|KRW|JPY|GBP)\b/g,'')))return unknown();
  const currency=[...currencies][0];
  text=normal(text.replace(/\b(?:VND|USD|EUR|KRW|JPY|THB|SGD|AUD|CAD|GBP|CNY)\b/g,'').replace(/[₫€]/g,''));
  text=text.replace(perPersonSuffix,'').trim();
  const open=/^(tren|plus de|over|more than|>|duoi|moins de|under|less than|<)\s+(.+)$/.exec(text);
  if(open){const a=amount(open[2],currency);if(!a)return unknown();const above=['tren','plus de','over','more than','>'].includes(open[1]);
    return {status:'parsed',currency,minimum:above?a.value:null,maximum:above?null:a.value,bounds:above?'above':'below'};}
  const parts=text.split(/\s*[-–—]\s*/);
  if(parts.length!==2)return unknown();
  const right=amount(parts[1],currency),left=amount(parts[0],currency,right?.unit);
  if(!left||!right||left.value>right.value)return unknown();
  return {status:'parsed',currency,minimum:left.value,maximum:right.value,bounds:'closed'};
}
export function googlePriceLevel(raw:unknown,allowNumeric=true):number|null {
  if(allowNumeric&&typeof raw==='number'&&Number.isInteger(raw)&&raw>=0&&raw<=4)return raw;
  if(typeof raw!=='string')return null;
  if(allowNumeric&&/^[0-4]$/.test(raw))return Number(raw);
  if(/^[$€₫]{1,4}$/.test(raw)&&new Set(raw).size===1)return raw.length;
  const levels:Record<string,number>={PRICE_LEVEL_FREE:0,PRICE_LEVEL_INEXPENSIVE:1,PRICE_LEVEL_MODERATE:2,PRICE_LEVEL_EXPENSIVE:3,PRICE_LEVEL_VERY_EXPENSIVE:4};
  return Object.hasOwn(levels,raw)?levels[raw]:null;
}
