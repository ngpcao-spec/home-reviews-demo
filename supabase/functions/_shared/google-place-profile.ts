import {placeCategories,placeFeature,placeKey} from './google-place-taxonomy.ts';
import type {PriceIdentity} from './google-place-price.ts';
export const PLACE_PROFILE_VERSION='google-place-profile-v1';
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():null;
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const bool=(v:unknown)=>typeof v==='boolean'?v:null;
const strings=(v:unknown)=>arr(v).filter((x):x is string=>typeof x==='string'&&!!x.trim()).map(x=>x.trim());
function url(v:unknown){try{const u=new URL(String(v));return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
const weekdays=[['sunday','dimanche','chủ nhật'],['monday','lundi','thứ hai'],['tuesday','mardi','thứ ba'],['wednesday','mercredi','thứ tư'],['thursday','jeudi','thứ năm'],['friday','vendredi','thứ sáu'],['saturday','samedi','thứ bảy']];
export type DayHours={day:number|null;label:string;raw:string;status:'parsed'|'closed'|'unknown';intervals:{start:number;end:number}[]};
export function parsePlaceHours(value:unknown):DayHours[]{
 return arr(value).map(v=>{const x=obj(v),label=text(x.day)??'',raw=text(x.hours)??'',day=weekdays.findIndex(labels=>labels.map(placeKey).includes(placeKey(label)));
  const result:DayHours={day:day<0?null:day,label,raw,status:'unknown',intervals:[]};
  if(day<0)return result;
  if(['closed','fermé','đóng cửa'].map(placeKey).includes(placeKey(raw)))return {...result,status:'closed'};
  if(['open 24 hours','ouvert 24h/24','mở cửa cả ngày','mở cửa 24 giờ'].map(placeKey).includes(placeKey(raw)))return {...result,status:'parsed',intervals:[{start:0,end:1440}]};
  const parts=raw.split(/[,;]/).map(s=>s.trim());
  for(const part of parts){const m=/^(\d{1,2}):(\d{2})\s*(?:to|–|—|-)\s*(\d{1,2}):(\d{2})$/.exec(part);
   if(!m||Number(m[1])>23||Number(m[2])>59||Number(m[3])>24||Number(m[4])>59||Number(m[3])===24&&Number(m[4])!==0)return result;
   const start=Number(m[1])*60+Number(m[2]);let end=Number(m[3])*60+Number(m[4]);if(end<=start)end+=1440;
   result.intervals.push({start,end});
  }
  return {...result,status:result.intervals.length?'parsed':'unknown'};
 });
}
const hoursAliases:Record<string,string>={'nha bep':'kitchen','kitchen':'kitchen','cuisine':'kitchen','do an giao tan noi':'delivery','delivery':'delivery','livraison':'delivery','do an mang di':'takeaway','takeout':'takeaway','a emporter':'takeaway','bua sang':'breakfast','breakfast':'breakfast','petit dejeuner':'breakfast','gio tu phuc vu':'self_service','self service':'self_service'};
export type PlaceProfile=ReturnType<typeof placeProfile>;
/** Allowlist projection of an identity-checked result, without reviews/images/enrichments. */
export function placeProfile(items:unknown,identity:PriceIdentity,now=Date.now()){
 if(!Array.isArray(items)||items.length!==1)throw Error('PLACE_PROFILE_OUTPUT_INVALID');
 const x=obj(items[0]),at=text(x.scrapedAt);
 if(text(x.cid)!==identity.google_id||identity.place_id&&x.placeId!==identity.place_id||x.language!==identity.language)throw Error('PLACE_PROFILE_IDENTITY_MISMATCH');
 if(!at||!Number.isFinite(Date.parse(at))||Date.parse(at)>now+300000||!Array.isArray(x.reviews)||x.reviews.length)throw Error('PLACE_PROFILE_RESULT_INVALID');
 const source={source:'google_maps_place_details',observed_at:at,collection_language:identity.language};
 const group=(fields:string[])=>({...source,source_fields:fields});
 const categories=placeCategories([text(x.categoryName),...strings(x.categories)].filter((s):s is string=>s!==null));
 const entries=new Map<string,{group:string;label:string;value:boolean;source_fields:string[]}>();
 for(const [label,values] of Object.entries(obj(x.additionalInfo)))for(const value of arr(values))for(const [name,v]of Object.entries(obj(value))){
  if(typeof v!=='boolean')continue;const k=placeKey(label)+'|'+placeKey(name)+'|'+v;
  if(!entries.has(k))entries.set(k,{group:label,label:name,value:v,source_fields:['additionalInfo.'+label+'.'+name]});
 }
 const facts:Record<string,{value:boolean|null;status:'declared'|'conflicted';evidence:ReturnType<typeof entries.values> extends IterableIterator<infer T>?T[]:never}>={};
 for(const entry of entries.values()){const id=placeFeature(entry.label);if(!id)continue;
  const fact=facts[id];if(fact){fact.evidence.push(entry);if(fact.value!==entry.value){fact.value=null;fact.status='conflicted';}}
  else facts[id]={value:entry.value,status:'declared',evidence:[entry]};
 }
 const location=obj(x.location),latitude=location.lat,longitude=location.lng;
 const coordinates=typeof latitude==='number'&&typeof longitude==='number'&&Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180?{latitude,longitude}:null;
 // This response has no description-language metadata. The collection locale is NOT a text-language assertion.
 const prose=(v:unknown,kind:string)=>text(v)?{text:text(v),language:null,language_status:'not_provided',translated:false,kind}:null;
 const links=(values:unknown[])=>[...new Set(values.flatMap(v=>{const u=url(typeof v==='string'?v:obj(v).url);return u?[u]:[];}))];
 const additional=Object.entries(obj(x.additionalOpeningHours)).map(([label,values])=>({label,kind:Object.hasOwn(hoursAliases,placeKey(label))?hoursAliases[placeKey(label)]:null,days:parsePlaceHours(values)}));
 let timezone:string|null=null,timezoneSource:string|null=null;
 const candidate=text(x.timeZone)??text(x.timezone);
 if(candidate){try{new Intl.DateTimeFormat('en',{timeZone:candidate});timezone=candidate;timezoneSource='provider';}catch{/* unknown */}}
 if(!timezone&&x.countryCode==='VN'){timezone='Asia/Ho_Chi_Minh';timezoneSource='explicit_single_timezone_country:VN';}
 const histogram=Object.entries(obj(x.popularTimesHistogram)).filter(([day])=>['Su','Mo','Tu','We','Th','Fr','Sa'].includes(day)).map(([day,values])=>({day,values:[...new Map(arr(values).flatMap(v=>{const h=obj(v);return Number.isInteger(h.hour)&&Number(h.hour)>=0&&Number(h.hour)<24&&typeof h.occupancyPercent==='number'&&h.occupancyPercent>=0&&h.occupancyPercent<=100?[[h.hour,{hour:Number(h.hour),occupancy_percent:h.occupancyPercent}] as const]:[];})).values()].sort((a,b)=>a.hour-b.hour)}));
 return {version:PLACE_PROFILE_VERSION,
  identity:{...group(['title','address','neighborhood','street','city','postalCode','state','countryCode','location','cid','placeId','fid','url']),name:text(x.title),address:text(x.address),neighborhood:text(x.neighborhood),street:text(x.street),city:text(x.city),postal_code:text(x.postalCode),state:text(x.state),country_code:text(x.countryCode),coordinates,cid:identity.google_id,place_id:text(x.placeId),fid:text(x.fid),google_maps_url:url(x.url)??identity.google_maps_url},
  categories:{...group(['categoryName','categories']),primary:text(x.categoryName),...categories},
  hours:{...group(['openingHours','additionalOpeningHours','temporarilyClosed','permanentlyClosed','wasOpenAtScrapeTime','countryCode']),timezone,timezone_source:timezoneSource,weekly:parsePlaceHours(x.openingHours),additional,temporarily_closed:bool(x.temporarilyClosed),permanently_closed:bool(x.permanentlyClosed),open_at_observation:bool(x.wasOpenAtScrapeTime),live:false,holiday_exceptions_known:false},
  attributes:{...group(['additionalInfo']),entries:[...entries.values()],facts},
  popularity:{...group(['popularTimesHistogram','popularTimesLiveText','popularTimesLivePercent']),weekly:histogram,relative_to_own_peak:true,live:false,at_observation:{text:text(x.popularTimesLiveText),percent:typeof x.popularTimesLivePercent==='number'?x.popularTimesLivePercent:null}},
  presentation:{...group(['description','ownerDescription']),description:prose(x.description,'google_presentation'),owner_description:prose(x.ownerDescription,'commercial_presentation')},
  contacts:{...group(['phone','website','imageUrl','menu','reserveTableUrl','tableReservationLinks','bookingLinks','servicesLink','googleFoodUrl']),phone:text(x.phone),website:url(x.website),primary_photo_url:url(x.imageUrl),menu_links:links([x.menu]),reservation_links:links([x.reserveTableUrl,...arr(x.tableReservationLinks),...arr(x.bookingLinks)]),service_links:links([x.servicesLink,x.googleFoodUrl]),menu_contents_known:false,reservation_availability_known:false},
 };
}
/** Weekly schedule only: never a live/holiday opening guarantee. Unknowns fail closed. */
export function scheduledOpening(profile:PlaceProfile,instant:string,kind='venue'):'scheduled_open'|'scheduled_closed'|'unknown'{
 if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(instant)||!Number.isFinite(Date.parse(instant)))throw Error('INVALID_VISIT_TIME');
 const h=profile.hours;if(h.permanently_closed===true||h.temporarily_closed===true)return 'scheduled_closed';
 if(!h.timezone)return 'unknown';
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:h.timezone,weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const day=weekdays.findIndex(labels=>labels[0]===parts.find(p=>p.type==='weekday')?.value.toLowerCase());
 const minute=Number(parts.find(p=>p.type==='hour')?.value)*60+Number(parts.find(p=>p.type==='minute')?.value);
 const schedules=kind==='venue'?[h.weekly]:h.additional.filter(x=>x.kind===kind).map(x=>x.days);
 if(schedules.length!==1)return 'unknown';const days=schedules[0],today=days.filter(d=>d.day===day),previous=days.filter(d=>d.day===(day+6)%7);
 const open=(rows:DayHours[],offset:number)=>rows.some(d=>d.status==='parsed'&&d.intervals.some(i=>i.start<=minute+offset&&minute+offset<i.end));
 if(open(today,0)||open(previous,1440))return 'scheduled_open';
 // An unparsed previous day might extend into today. Do not claim closed.
 if(today.length!==1||today[0].status==='unknown'||previous.length!==1||previous[0].status==='unknown')return 'unknown';
 return 'scheduled_closed';
}
