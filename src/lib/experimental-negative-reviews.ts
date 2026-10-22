import type {Axis} from '../../supabase/functions/_shared/consultant-contract'
import {experimentalPresentation,type ExperimentalRow} from './experimental-report-presentation'

// directCategoryCounts archives negative+mixed IDs and positive+mixed IDs.
// Their intersection is exactly the native mixed choice, not a new classifier.
export function experimentalNegativeReviews(row:ExperimentalRow,axis:Axis){
 const presentation=experimentalPresentation(row).axis(axis),counts=row.statistics?.counts.categories[presentation.category]
 const validIds=(ids:unknown):ids is string[]=>Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.length>0)
 const available=validIds(counts?.negative_review_ids)&&validIds(counts?.positive_review_ids)
 const ids=available?[...new Set(counts!.negative_review_ids!)]:[],positive=new Set(available?counts!.positive_review_ids:[])
 const sources=new Map<string,ExperimentalRow['source_reviews'][number]>()
 for(const source of row.source_reviews)if(!sources.has(source.id))sources.set(source.id,source)
 const reviews=ids.flatMap(id=>{const source=sources.get(id);return source?[{source,classification:positive.has(id)?'mixed' as const:'negative' as const}]:[]})
 return {category:presentation.category,expectedCount:presentation.negative,available,reviews,missingReviewIds:ids.filter(id=>!sources.has(id)),
  countMismatch:available&&presentation.negative!==null&&ids.length!==presentation.negative}
}
