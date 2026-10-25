export const CUSTOMER_CATEGORIES=['food','service','atmosphere','price'] as const
export type CustomerCategory=typeof CUSTOMER_CATEGORIES[number]
const clean=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').replace(/[_\s-]+/g,' ').trim()
const aliases:Record<string,CustomerCategory>={food:'food',cuisine:'food',nourriture:'food',qualite:'food','qualite des plats':'food','do an':'food','thuc an':'food','food rating':'food',service:'service','dich vu':'service','service rating':'service',atmosphere:'atmosphere',ambience:'atmosphere',ambiance:'atmosphere','khong gian':'atmosphere','bau khong khi':'atmosphere','atmosphere rating':'atmosphere',price:'price',prix:'price',gia:'price','gia ca':'price','rapport qualite prix':'price'}
export function customerScore(raw:unknown):number|null{
 const n=typeof raw==='number'?raw:typeof raw==='string'&&/^[1-5](?:[.,]\d+)?(?:\s*\/\s*5)?$/.test(raw.trim())?Number(raw.split('/')[0].trim().replace(',','.')):NaN
 return Number.isFinite(n)&&n>=1&&n<=5?n:null
}
export function customerRatings(raw:unknown){
 const values=Object.fromEntries(CUSTOMER_CATEGORIES.map(k=>[k,new Set<number>()])) as Record<CustomerCategory,Set<number>>
 if(raw&&typeof raw==='object'&&!Array.isArray(raw))for(const[k,v]of Object.entries(raw)){const name=aliases[clean(k)],n=customerScore(v);if(name&&n!==null)values[name].add(n)}
 return Object.fromEntries(CUSTOMER_CATEGORIES.map(k=>[k,values[k].size===1?[...values[k]][0]:null])) as Record<CustomerCategory,number|null>
}
export function customerRatingStats(reviews:readonly {id:string;rating:unknown;review_detailed_rating?:unknown}[]){
 const unique=[...new Map(reviews.map(r=>[r.id,r])).values()],summary=(values:(number|null)[])=>{const valid=values.filter((v):v is number=>v!==null);return {count:valid.length,average:valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null}}
 return {total_reviews:unique.length,overall:summary(unique.map(r=>customerScore(r.rating))),categories:Object.fromEntries(CUSTOMER_CATEGORIES.map(k=>[k,summary(unique.map(r=>customerRatings(r.review_detailed_rating)[k]))])) as Record<CustomerCategory,{count:number;average:number|null}>}
}
