/** Descriptive Google observations only. Never produces sentiments or findings. */
export interface ContextDistribution { total:number; values:{value:string;count:number}[] }
export interface StructuredContextStats {
  noise: {total:number;quiet:number;moderate:number;noisy_conversation_possible:number;unknown:number}
  wait_time: {total:number;no_wait:number;under_10_min:number;from_10_to_30_min:number;from_30_to_60_min:number;over_60_min:number;unknown:number}
  price_per_person: {total:number;ranges:{value:string;count:number}[]}
  meal_type: ContextDistribution
  group_size: ContextDistribution
}
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().trim().replace(/[–—−]/g,'-').replace(/\s+/g,' ')
const keys:Record<string,string[]>={
  noise:['noise','noise level','niveau sonore','niveau de bruit','độ ồn'],
  wait_time:['wait_time','wait time','waiting time','temps d’attente',"temps d'attente",'thời gian chờ'],
  price_per_person:['price_per_person','price per person','prix par personne','giá mỗi người'],
  meal_type:['meal_type','meal type','type de repas','loại hình bữa ăn','loại bữa ăn'],
  group_size:['group_size','group size','taille du groupe','quy mô nhóm'],
}
const noise:Record<string,keyof Omit<StructuredContextStats['noise'],'total'>>={
  'rất yên tĩnh':'quiet','yên tĩnh, dễ trò chuyện':'quiet','quiet, easy to talk':'quiet','very quiet':'quiet','calme, conversation facile':'quiet',
  'ồn ào ở mức vừa phải':'moderate','moderately loud':'moderate','moderate noise':'moderate','modérément bruyant':'moderate',
  'ồn ào, nhưng bạn vẫn trò chuyện được':'noisy_conversation_possible','loud, but you can still talk':'noisy_conversation_possible','bruyant, mais conversation possible':'noisy_conversation_possible',
}
const waits:Record<string,keyof Omit<StructuredContextStats['wait_time'],'total'>>={
  'không phải chờ':'no_wait','không cần chờ':'no_wait','no wait':'no_wait','sans attente':'no_wait',
  'dưới 10 phút':'under_10_min','tới 10 phút':'under_10_min','up to 10 min':'under_10_min','under 10 min':'under_10_min','moins de 10 min':'under_10_min',
  '10-30 phút':'from_10_to_30_min','10-30 min':'from_10_to_30_min',
  '30-60 phút':'from_30_to_60_min','30-60 min':'from_30_to_60_min',
  'hơn 60 phút':'over_60_min','over 60 min':'over_60_min','plus de 60 min':'over_60_min',
}
const meals:Record<string,string>={'bữa sáng':'breakfast',breakfast:'breakfast','petit déjeuner':'breakfast','bữa trưa':'lunch',lunch:'lunch','déjeuner':'lunch','bữa tối':'dinner',dinner:'dinner','dîner':'dinner',brunch:'brunch','khác':'other',other:'other',autre:'other'}
const groups:Record<string,string>={'1 người':'1','1 person':'1','1 personne':'1','2 người':'2','2 people':'2','2 personnes':'2','3 đến 4 người':'3-4','5 đến 8 người':'5-8','phù hợp với mọi quy mô nhóm':'all_sizes','suitable for all group sizes':'all_sizes'}
export function normalizeContextPrice(value:string) {
  const clean=value.normalize('NFKC').trim().replace(/\s+/g,' ')
  return /^\d+\s*[-–—]\s*\d+\s+N\s*₫$/u.test(clean)
    ?clean.replace(/\s*[-–—]\s*/,'–').replace(/\s+N\s*₫$/u,' k₫'):clean
}
export function structuredContextStats(reviews:readonly {id:string;review_context?:unknown}[]):StructuredContextStats {
  const result:StructuredContextStats={noise:{total:0,quiet:0,moderate:0,noisy_conversation_possible:0,unknown:0},wait_time:{total:0,no_wait:0,under_10_min:0,from_10_to_30_min:0,from_30_to_60_min:0,over_60_min:0,unknown:0},price_per_person:{total:0,ranges:[]},meal_type:{total:0,values:[]},group_size:{total:0,values:[]}}
  const distributions={price_per_person:new Map<string,number>(),meal_type:new Map<string,number>(),group_size:new Map<string,number>()}
  const seen=new Set<string>()
  for(const review of reviews) {
    if(seen.has(review.id)) continue
    seen.add(review.id)
    if(!review.review_context || typeof review.review_context!=='object' || Array.isArray(review.review_context)) continue
    const entries=Object.entries(review.review_context).filter((e):e is [string,string]=>typeof e[1]==='string' && !!e[1].trim()).sort(([a],[b])=>a<b?-1:a>b?1:0)
    for(const [field,aliases] of Object.entries(keys)) {
      const entry=entries.find(([key])=>aliases.includes(normalize(key)))
      if(!entry) continue
      const value=normalize(entry[1])
      if(field==='noise'){result.noise.total++;result.noise[noise[value]??'unknown']++}
      else if(field==='wait_time'){result.wait_time.total++;result.wait_time[waits[value]??'unknown']++}
      else {
        const name=field as keyof typeof distributions
        const label=name==='price_per_person'?normalizeContextPrice(entry[1]):name==='meal_type'?(meals[value]??value):(groups[value]??value)
        distributions[name].set(label,(distributions[name].get(label)??0)+1)
        result[name].total++
      }
    }
  }
  const sorted=(map:Map<string,number>)=>[...map].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count || (a.value<b.value?-1:a.value>b.value?1:0))
  result.price_per_person.ranges=sorted(distributions.price_per_person)
  result.meal_type.values=sorted(distributions.meal_type)
  result.group_size.values=sorted(distributions.group_size)
  return result
}
