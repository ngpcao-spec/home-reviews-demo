/** V8 post-extraction context only. No provider client, inference or finding writes. */
export const RATING_CATEGORIES=['food','service','atmosphere'] as const
export type RatingCategory=typeof RATING_CATEGORIES[number]
export type CategoryRatings=Record<RatingCategory,number|null>
export const CATEGORY_THEMES={food:['food_quality','freshness','cooking','temperature','portions','presentation','drinks','variety','consistency'],service:['friendly_staff','attentiveness','wait_time','coordination','communication','order_accuracy','professionalism'],atmosphere:['atmosphere','decor','noise','comfort','cleanliness','location'],price:['value','billing','price_level']} as const
export type CrossStatus='confirmed_negative'|'low_score_unexplained'|'textual_issue_despite_high_score'|'positive_consistent'|'mixed_text_signal'|'high_score_without_text_signal'|'no_category_rating'
const STATUSES:CrossStatus[]=['confirmed_negative','low_score_unexplained','textual_issue_despite_high_score','positive_consistent','mixed_text_signal','high_score_without_text_signal','no_category_rating']
export interface CrossReview {id:string;rating:number;analysis_text?:string;review_detailed_rating?:unknown;review_context?:unknown;normalized_category_ratings?:CategoryRatings}
export interface TextFinding {review_id:string;theme_key:string;sentiment:'positive'|'negative';evidence:string|null}
const normalize=(key:string)=>key.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/đ/g,'d').trim().replace(/[_\s]+/g,' ')
const aliases:Record<string,RatingCategory>={'do an':'food',food:'food',cuisine:'food','food rating':'food','dich vu':'service',service:'service','service rating':'service','bau khong khi':'atmosphere',atmosphere:'atmosphere',ambiance:'atmosphere',ambience:'atmosphere','atmosphere rating':'atmosphere'}
function score(raw:unknown):number|null {const value=typeof raw==='number'?raw:typeof raw==='string'&&/^[1-5](?:\s*\/\s*5)?$/.test(raw.trim())?Number(raw.trim().split('/')[0]):NaN;return Number.isInteger(value)&&value>=1&&value<=5?value:null}
export function normalizeCategoryRatings(raw:unknown):CategoryRatings {
  const values={food:new Set<number>(),service:new Set<number>(),atmosphere:new Set<number>()}
  if(raw&&typeof raw==='object'&&!Array.isArray(raw))for(const [key,value] of Object.entries(raw)){const category=aliases[normalize(key)],rating=score(value);if(category&&rating!==null)values[category].add(rating)}
  // Conflicting aliases stay unavailable instead of winning by object order.
  return Object.fromEntries(RATING_CATEGORIES.map(k=>[k,values[k].size===1?[...values[k]][0]:null])) as CategoryRatings
}
export function crossStatus(rating:number|null,positive:number,negative:number):CrossStatus {
  if(rating===null)return 'no_category_rating'
  if(positive>0&&negative>0)return 'mixed_text_signal'
  if(rating<=3)return negative>0?'confirmed_negative':'low_score_unexplained'
  if(negative>0)return 'textual_issue_despite_high_score'
  return positive>0?'positive_consistent':'high_score_without_text_signal'
}
export interface CrossAxisReview {category_rating:number|null;positive_finding_count:number;negative_finding_count:number;has_positive_text_signal:boolean;has_negative_text_signal:boolean;status:CrossStatus;overall_category_gap:number|null;themes:Omit<TextFinding,'review_id'>[]}
export interface CrossReviewResult {review_id:string;overall_rating:number|null;axes:Record<RatingCategory,CrossAxisReview>;overall_vs_category_flags:{high_overall_low_category:RatingCategory[];low_overall_high_categories:boolean}}
export interface CrossAxisStats {rating_count:number;average_rating:number|null;low_rating_count:number;distribution:Record<'1'|'2'|'3'|'4'|'5',number>;confirmed_negative_count:number;low_score_unexplained_count:number;textual_issue_despite_high_score_count:number;positive_consistent_count:number;mixed_text_signal_count:number;high_score_without_text_signal_count:number;no_category_rating_count:number}
export interface CrossRatingAnalysis {analysis_unavailable_review_ids?:string[];total_reviews:number;overall_rating_count:number;overall_average_rating:number|null;axes:Record<RatingCategory,CrossAxisStats>;price:{positive_finding_count:number;negative_finding_count:number;positive_review_count:number;negative_review_count:number;price_per_person_count:number};overall_vs_category_counts:{high_overall_low_category:number;low_overall_high_categories:number};review_analyses:CrossReviewResult[];high_signal_review_count:number;high_signal_reviews:(CrossReviewResult&{analysis_text:string;priority:number})[]}
const priceKeys=new Set(['price per person','prix par personne','gia moi nguoi']),priority=(r:CrossReviewResult)=>r.overall_vs_category_flags.high_overall_low_category.length?1:Object.values(r.axes).some(a=>a.status==='confirmed_negative')?2:Object.values(r.axes).some(a=>a.status==='textual_issue_despite_high_score')?3:Object.values(r.axes).some(a=>a.status==='low_score_unexplained')?4:Object.values(r.axes).some(a=>a.status==='mixed_text_signal')?5:r.overall_vs_category_flags.low_overall_high_categories?6:Infinity
export function crossRatingAnalysis(reviews:readonly CrossReview[],findings:readonly TextFinding[]):CrossRatingAnalysis {
  if(new Set(reviews.map(r=>r.id)).size!==reviews.length)throw new Error('CROSS_RATING_DUPLICATE_REVIEW')
  const ordered=[...reviews].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),ids=new Set(ordered.map(r=>r.id)),known=new Set<string>(Object.values(CATEGORY_THEMES).flat()),unique=new Map<string,TextFinding>()
  for(const f of findings)if(ids.has(f.review_id)&&known.has(f.theme_key)&&['positive','negative'].includes(f.sentiment))unique.set(`${f.review_id}:${f.theme_key}:${f.sentiment}`,{...f})
  const byReview=new Map<string,TextFinding[]>();for(const f of unique.values())byReview.set(f.review_id,[...byReview.get(f.review_id)??[],f])
  const axes=Object.fromEntries(RATING_CATEGORIES.map(k=>[k,{rating_count:0,average_rating:null,low_rating_count:0,distribution:{'1':0,'2':0,'3':0,'4':0,'5':0},...Object.fromEntries(STATUSES.map(s=>[s+'_count',0]))}])) as Record<RatingCategory,CrossAxisStats>
  const price={positive_finding_count:0,negative_finding_count:0,positive_review_count:0,negative_review_count:0,price_per_person_count:0},review_analyses:CrossReviewResult[]=[],totals={food:0,service:0,atmosphere:0},overallValues:number[]=[]
  for(const review of ordered){const ratings=normalizeCategoryRatings(review.normalized_category_ratings??review.review_detailed_rating),overall=score(review.rating),textFindings=byReview.get(review.id)??[],rowAxes={} as Record<RatingCategory,CrossAxisReview>
    if(overall!==null)overallValues.push(overall)
    for(const category of RATING_CATEGORIES){const themes=textFindings.filter(f=>(CATEGORY_THEMES[category] as readonly string[]).includes(f.theme_key)).sort((a,b)=>a.theme_key.localeCompare(b.theme_key)||a.sentiment.localeCompare(b.sentiment)).map(({theme_key,sentiment,evidence})=>({theme_key,sentiment,evidence})),positive=themes.filter(f=>f.sentiment==='positive').length,negative=themes.filter(f=>f.sentiment==='negative').length,rating=ratings[category],status=crossStatus(rating,positive,negative),stats=axes[category]
      rowAxes[category]={category_rating:rating,positive_finding_count:positive,negative_finding_count:negative,has_positive_text_signal:positive>0,has_negative_text_signal:negative>0,status,overall_category_gap:overall!==null&&rating!==null?overall-rating:null,themes}
      const field=(status+'_count') as keyof CrossAxisStats;(stats[field] as number)++;if(rating!==null){stats.rating_count++;totals[category]+=rating;stats.distribution[String(rating) as keyof typeof stats.distribution]++;if(rating<=3)stats.low_rating_count++}
    }
    const available=RATING_CATEGORIES.filter(k=>ratings[k]!==null),low=overall!==null&&overall>=4?available.filter(k=>ratings[k]!<=3):[]
    review_analyses.push({review_id:review.id,overall_rating:overall,axes:rowAxes,overall_vs_category_flags:{high_overall_low_category:low,low_overall_high_categories:overall!==null&&overall<=3&&available.length>0&&available.every(k=>ratings[k]!>=4)}})
    const p=textFindings.filter(f=>(CATEGORY_THEMES.price as readonly string[]).includes(f.theme_key));for(const sentiment of ['positive','negative'] as const){const count=p.filter(f=>f.sentiment===sentiment).length;price[sentiment+'_finding_count' as 'positive_finding_count']+=count;if(count)price[sentiment+'_review_count' as 'positive_review_count']++}
    if(review.review_context&&typeof review.review_context==='object'&&!Array.isArray(review.review_context)&&Object.entries(review.review_context).some(([key,v])=>priceKeys.has(normalize(key))&&typeof v==='string'&&v.trim()))price.price_per_person_count++
  }
  for(const k of RATING_CATEGORIES)axes[k].average_rating=axes[k].rating_count?totals[k]/axes[k].rating_count:null
  const high=review_analyses.filter(r=>Number.isFinite(priority(r))).map(r=>({...r,priority:priority(r),analysis_text:ordered.find(v=>v.id===r.review_id)?.analysis_text??''})).sort((a,b)=>a.priority-b.priority||(a.review_id<b.review_id?-1:a.review_id>b.review_id?1:0))
  return {total_reviews:ordered.length,overall_rating_count:overallValues.length,overall_average_rating:overallValues.length?overallValues.reduce((a,b)=>a+b,0)/overallValues.length:null,axes,price,overall_vs_category_counts:{high_overall_low_category:review_analyses.filter(r=>r.overall_vs_category_flags.high_overall_low_category.length).length,low_overall_high_categories:review_analyses.filter(r=>r.overall_vs_category_flags.low_overall_high_categories).length},review_analyses,high_signal_review_count:high.length,high_signal_reviews:high.slice(0,5)}
}
