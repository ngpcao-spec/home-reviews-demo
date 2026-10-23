import type {Axis} from '../../supabase/functions/_shared/consultant-contract'
import type {ParallelView} from '../components/ParallelReports'

export type ExperimentalRow=NonNullable<ParallelView['experimental']>
const categoryForAxis={service:'service',quality:'quality',price:'price',atmosphere:'ambiance'} as const
const finite=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null
// A read-only projection, never a ConsultantReportData or a fabricated diagnosis.
export function experimentalPresentation(row:ExperimentalRow){
 const report=row.derived_report?.report,scope=row.statistics?.scope
 const source=row.source_report
 const reference=source&&scope&&source.stored_reviews_count===scope.source_reviews&&source.generation_id&&source.generation_id===row.reference_generation_id?source.consultant_report:null
 const current=source&&row.current_source_run_id&&String(source.ai_status)==='source_frozen'&&source.stored_reviews_count===scope?.source_reviews&&source.generation_id===row.reference_generation_id?source:null
 return {report,scope,reference,language:source?.preferred_language,sampleAverage:finite(reference?.sample_average_rating??current?.sample_average_rating),contextStats:reference?.structured_context_stats,
  axis:(key:Axis)=>{const category=categoryForAxis[key],counts=row.statistics?.counts.categories[category],google=reference?.axis_diagnostics?.[key]
   return {category,section:report?.categories.find(s=>s.category===category),positive:finite(counts?.positive_including_mixed??counts?.positive_reviews),negative:finite(counts?.negative_including_mixed??counts?.negative_reviews),mentioned:finite(counts?.distinct_mentioned_reviews),denominator:finite(counts?.denominator_reviews??scope?.analysed_text_reviews),
    googleAverage:finite(google?.subrating_average??(key==='quality'?current?.food_average:key==='service'?current?.service_average:key==='atmosphere'?current?.atmosphere_average:null)),googleCount:finite(google?.subrating_count??(key==='quality'?current?.food_review_count:key==='service'?current?.service_review_count:key==='atmosphere'?current?.atmosphere_review_count:null)),recommendations:report?.recommendations.map((value,index)=>({value,index})).filter(r=>r.value.category===category)??[]}
  }
 }
}
