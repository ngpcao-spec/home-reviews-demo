import type {ParallelView} from '../../src/components/ParallelReports'
import type {HistoricalReportRow} from '../../src/lib/historical-report'

// Explicit synthetic data. No reference annotations or supplier responses.
export function parallelPresentationRow(language:'fr'|'vi'):NonNullable<ParallelView['experimental']>{
 const categories=['service','quality','price','ambiance'],text=language==='fr'?'Texte synthétique conservé mot pour mot.':'Nội dung giả lập được giữ nguyên từng chữ.'
 const evidence=categories.map(category=>({evidence_id:'proof-'+category,review_id:'review-'+category,quote:'EXPLICIT SYNTHETIC CUSTOMER SOURCE.'}))
 return {id:'mock-derived',created_at:'2026-10-21T00:00:00Z',state:'completed',error_code:null,generated_at:'2026-10-21T00:00:00Z',reference_generation_id:'mock-generation',
  source_report:{generation_id:'mock-generation',stored_reviews_count:7,preferred_language:language} as HistoricalReportRow,
  original_report:{marker:'EXPLICIT ORIGINAL MOCK'},raw_response:{marker:'EXPLICIT MOCK'},corrections:[{marker:'SYNTHETIC CORRECTION'}],controls:{technical_checks_passed:true,evidence},usage:{jev:0,luna:0,sol:0},
  source_reviews:[...categories.map(category=>({id:'review-'+category,analysis_text:'EXPLICIT COMPLETE ANALYTICAL TEXT '+category,original_text:'EXPLICIT ORIGINAL SYNTHETIC TEXT '+category,rating:2,published_at:'2026-10-01T10:00:00+07:00',analysis_language:'en',original_language:'vi'})),
   {id:'review-never-selected',original_text:'FULL NEGATIVE REVIEW OUTSIDE THE SELECTED QUOTATIONS.',analysis_text:'EXISTING TRANSLATION OF THE UNSELECTED REVIEW.',rating:1,published_at:'2026-10-02T10:00:00+07:00',analysis_language:'en',original_language:'vi'},
   {id:'review-positive-only',original_text:'POSITIVE ONLY REVIEW MUST NOT APPEAR.',analysis_text:'POSITIVE ONLY REVIEW MUST NOT APPEAR.',rating:5,published_at:'2026-10-03T10:00:00+07:00'},
   {id:'review-textless',original_text:'',analysis_text:null,rating:4,published_at:null}],
  statistics:{scope:{source_reviews:7,analysed_text_reviews:6,textless_statistics_only:1},counts:{categories:Object.fromEntries(categories.map(category=>[category,{positive_including_mixed:3,negative_including_mixed:2,positive_review_ids:['review-'+category,'review-positive-only','review-'+categories.find(c=>c!==category)],negative_review_ids:['review-'+category,'review-never-selected'],distinct_mentioned_reviews:4,denominator_reviews:6,exclusive:{positive:2,negative:1,mixed:1,neutral:0,not_mentioned:2,uncertain:0}}]))}},
  derived_report:{format_version:'jls-direct-categories4-report-v1',report:{categories:categories.map(category=>({category,text:text+' '+category,evidence_ids:['proof-'+category]})),positive_aspects:[{category:'quality',text:'EXPLICIT POSITIVE PASSAGE',evidence_ids:['proof-quality']}],negative_aspects:[{category:'service',text:'EXPLICIT NEGATIVE PASSAGE',evidence_ids:['proof-service']}],conclusion:{text:'EXPLICIT UNCHANGED CONCLUSION',evidence_ids:['proof-service']},recommendations:[{title:'EXPLICIT RECOMMENDATION TITLE',category:'service',evidence_ids:['proof-service'],observations:[{text:'EXPLICIT UNCHANGED OBSERVATION',evidence_id:'proof-service',quote:evidence[0].quote}],proposed_action:'EXPLICIT UNCHANGED ACTION',priority_reason:'EXPLICIT UNCHANGED PRIORITY'}]}}
 }
}
