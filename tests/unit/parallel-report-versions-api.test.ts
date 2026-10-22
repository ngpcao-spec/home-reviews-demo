import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({context:null as unknown,membership:vi.fn()}));
vi.mock('../../supabase/functions/_shared/auth.ts',()=>({requireUser:async()=>mock.context,assertMembership:mock.membership}));
let handler:(r:Request)=>Promise<Response>;
const report={id:'report',organization_id:'org',establishment_id:'est',generation_id:'generation',preferred_language:'vi',stored_reviews_count:1,ai_status:'completed',source_fingerprint:'frozen'};
let rows:Record<string,Record<string,unknown>[]>;
const rpc=vi.fn(),fetchGuard=vi.fn(()=>Promise.reject(Error('NETWORK_FORBIDDEN')));
function from(table:string){
 const filters:[string,unknown][]=[],ordering:{key:string;ascending:boolean}[]=[];let limit=Infinity;
 const values=()=>{let r=(rows[table]??[]).filter(r=>filters.every(([key,v])=>r[key]===v));
  r=r.toSorted((a,b)=>{for(const o of ordering){const diff=String(a[o.key]).localeCompare(String(b[o.key]));if(diff)return o.ascending?diff:-diff;}return 0;});return r.slice(0,limit);};
 const q={select:()=>q,eq:(key:string,v:unknown)=>{filters.push([key,v]);return q;},order:(key:string,o:{ascending:boolean})=>{ordering.push({key,...o});return q;},limit:(n:number)=>{limit=n;return q;},
  maybeSingle:async()=>{const r=values();return r.length>1?{data:null,error:{code:'PGRST116'}}:{data:r[0]??null,error:null};},
  single:async()=>{const r=values();return r.length!==1?{data:null,error:{code:'PGRST116'}}:{data:r[0],error:null};},
  then:(resolve:(v:unknown)=>void)=>Promise.resolve({data:values(),error:null}).then(resolve)};
 return q;
}
beforeAll(async()=>{vi.stubGlobal('Deno',{serve:(h:typeof handler)=>{handler=h;}});vi.stubGlobal('fetch',fetchGuard);await import('../../supabase/functions/parallel-reports/index.ts');});
afterAll(()=>vi.unstubAllGlobals());
beforeEach(()=>{
 mock.membership.mockReset();mock.membership.mockResolvedValue(undefined);rpc.mockReset();fetchGuard.mockClear();
 const pair={organization_id:'org',establishment_id:'est',reference_report_id:'report',reference_generation_id:'generation',language:'vi',state:'completed',run_id:null,source_report:report};
 rows={historical_establishment_reports:[report],establishments:[{id:'est',organization_id:'org'}],
  historical_report_runs:[{generation_id:'generation',organization_id:'org',establishment_id:'est',status:'completed',snapshot:{base:{source_fingerprint:'frozen'},reviews:[]}}],
  analysis_parallel_reports:[{...pair,id:'previous',created_at:'2026-10-21T00:00:00Z'},{...pair,id:'derived',created_at:'2026-10-22T00:00:00Z'}]};
 mock.context={user:{id:'SYNTHETIC_USER'},client:{from},admin:{from,rpc}};
});
const request=(extra:Record<string,unknown>={})=>handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({action:'read',report_id:'report',...extra})}));
it('reads the latest same-corpus derivative and lists both versions without a supplier or write',async()=>{
 const response=await request();expect(response.status).toBe(200);const data=await response.json();expect(data.experimental.id).toBe('derived');expect(data.versions.map((r:{id:string})=>r.id)).toEqual(['derived','previous']);
 expect(data.new_provider_calls).toBe(0);expect(rpc).not.toHaveBeenCalled();expect(fetchGuard).not.toHaveBeenCalled();
});
it('keeps the previous version directly readable',async()=>{const r=await request({comparison_id:'previous'});expect(r.status).toBe(200);expect((await r.json()).experimental.id).toBe('previous');expect(rpc).not.toHaveBeenCalled();});
it('refuses another organization or establishment instead of exposing its archive',async()=>{rows.analysis_parallel_reports[0].organization_id='other-org';expect((await request({comparison_id:'previous'})).status).toBe(403);rows.analysis_parallel_reports[0].organization_id='org';rows.analysis_parallel_reports[0].establishment_id='other-est';expect((await request({comparison_id:'previous'})).status).toBe(403);});
it('retains membership checks and rejects launching an archived comparison',async()=>{mock.membership.mockRejectedValueOnce(Error('FORBIDDEN'));expect((await request()).status).toBe(403);expect((await request({action:'start',comparison_id:'previous'})).status).toBe(409);expect(rpc).not.toHaveBeenCalled();});
