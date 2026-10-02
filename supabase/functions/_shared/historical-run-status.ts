import { consultantBatches } from './consultant-report.ts'
export function historicalRunStatus(run: {establishment_id:string;language:string;generation_id:string;status:string;cursor:number;error_code:string|null;total_steps?:number|null;snapshot?:{reviews?:Parameters<typeof consultantBatches>[0]}}) {
  let total=run.total_steps ?? null
  if(total===null && run.snapshot?.reviews) { try { total=consultantBatches(run.snapshot.reviews).length+1 } catch { /* cursor still meaningful */ } }
  return {establishment_id:run.establishment_id,preferred_language:run.language,generation_id:run.generation_id,status:run.status,
    progress:run.status==='completed'?total ?? run.cursor:run.cursor,total_steps:total,error_code:run.error_code,
    resumable:false, // Server owns continuation; retained for old-client compatibility.
  }
}
