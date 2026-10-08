import {requireUser,assertMembership} from '../_shared/auth.ts'
import {enforceRateLimit} from '../_shared/rate-limit.ts'
import {findingAuditHandler,type FindingAudit} from '../_shared/v9-finding-audit-api.ts'
import {AUDIT_V8,AUDIT_V9,type AuditSource,type AuditItem,type AuditLabel} from '../_shared/v9-finding-audit-core.ts'

// Only audit RPCs write. Frozen reports and all other resources are SELECT only.
Deno.serve(findingAuditHandler(async request=>{
  const ctx=await requireUser(request);if(request.method==='POST')enforceRateLimit('finding-audit:'+ctx.user.id,120,60_000)
  const identity=await ctx.admin.from('historical_report_runs').select('organization_id').eq('generation_id',AUDIT_V9).single();if(identity.error||!identity.data)throw new Error('FINDING_AUDIT_SOURCE_REQUIRED')
  const org=identity.data.organization_id;await assertMembership(ctx.client,ctx.user.id,org,['owner','admin','manager'])
  const get=async(id?:string)=>{let q=ctx.admin.from('analysis_v9_finding_audits').select('*').eq('organization_id',org).eq('source_v8_generation_id',AUDIT_V8).eq('source_v9_generation_id',AUDIT_V9);if(id)q=q.eq('id',id);const {data,error}=await q.maybeSingle();if(error)throw new Error('FINDING_AUDIT_READ_FAILED');if(id&&!data)throw new Error('FINDING_AUDIT_NOT_FOUND');return data as FindingAudit|null}
  const children=async(table:'analysis_v9_finding_audit_items'|'analysis_v9_finding_audit_labels',id:string)=>{await get(id);const {data,error}=await ctx.admin.from(table).select('*').eq('audit_id',id).limit(31);if(error)throw new Error('FINDING_AUDIT_READ_FAILED');return data??[]}
  return {user:ctx.user.id,get,
    loadBundle:async()=>{const sources=await Promise.all([AUDIT_V8,AUDIT_V9].map(id=>ctx.admin.from('historical_report_runs').select('generation_id,organization_id,establishment_id,status,snapshot,findings').eq('generation_id',id).eq('organization_id',org).single()));if(sources.some(s=>s.error||!s.data))throw new Error('FINDING_AUDIT_SOURCE_REQUIRED');return {v8:sources[0].data as AuditSource,v9:sources[1].data as AuditSource}},
    items:async id=>await children('analysis_v9_finding_audit_items',id) as AuditItem[],labels:async id=>await children('analysis_v9_finding_audit_labels',id) as AuditLabel[],
    create:async payload=>{const {data,error}=await ctx.admin.rpc('create_v9_finding_audit',payload);if(error||!data)throw new Error('FINDING_AUDIT_CREATE_FAILED');return data as string},
    write:async(id,revision,action,payload)=>{const {error}=await ctx.admin.rpc('write_v9_finding_audit',{p_user:ctx.user.id,p_id:id,p_revision:revision,p_action:action,p_payload:payload});if(error){const code=['FINDING_AUDIT_IMMUTABLE','FINDING_AUDIT_REVISION_CHANGED','FINDING_AUDIT_INCOMPLETE','FORBIDDEN'].find(c=>error.message.includes(c));throw new Error(code??'FINDING_AUDIT_SAVE_FAILED')}},
  }
}))
