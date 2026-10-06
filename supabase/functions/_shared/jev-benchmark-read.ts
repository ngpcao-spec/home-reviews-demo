export interface EligibleJevSource { establishment_id:string;organization_id:string;name:string;source_generation_id:string;reviews_total:number;completed_at:string;snapshots?:{source_generation_id:string;reviews_total:number;completed_at:string}[] }
export function eligibleJevSources(rows:{generation_id:string;organization_id:string;establishment_id:string;completed_at:string;snapshot:{analysis_version?:number;reviews?:unknown[]};establishments:{name:string}|null}[]):EligibleJevSource[] {
  const latest=new Map<string,EligibleJevSource>()
  for(const r of [...rows].sort((a,b)=>b.completed_at.localeCompare(a.completed_at)||b.generation_id.localeCompare(a.generation_id))) {
    if(r.snapshot?.analysis_version!==6 || !Array.isArray(r.snapshot.reviews) || !r.establishments?.name)continue
    const snapshot={source_generation_id:r.generation_id,reviews_total:r.snapshot.reviews.length,completed_at:r.completed_at}
    const previous=latest.get(r.establishment_id)
    if(previous){previous.snapshots!.push(snapshot);continue}
    latest.set(r.establishment_id,{establishment_id:r.establishment_id,organization_id:r.organization_id,name:r.establishments.name,...snapshot,snapshots:[snapshot]})
  }
  return [...latest.values()].sort((a,b)=>a.name.localeCompare(b.name))
}
export function preferredJevRun<T extends {status:string;created_at:string}>(rows:T[]):T|null {
  const priority:Record<string,number>={running:0,completed:1,failed:2}
  return [...rows].sort((a,b)=>(priority[a.status]??3)-(priority[b.status]??3)||b.created_at.localeCompare(a.created_at))[0]??null
}
