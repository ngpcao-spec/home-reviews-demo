import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {bindDirectSolWire} from '../../supabase/functions/_shared/jev-direct-report-preparation';
import {PlanTokenMemo} from '../../supabase/functions/_shared/jls-token-memo';
import {solRequestSize,SOL_SIZE_POLICY} from '../../supabase/functions/_shared/jls-sol-size';
import {directCanonical} from '../../supabase/functions/_shared/jev-direct-categories';
let network:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(network).not.toHaveBeenCalled();network.mockRestore();});
function fixture(){
 const packet={statistics:{counts:{service:{positive:3,negative:1}},scope:{total:100,text:80}},
  evidence:[{evidence_id:'synthetic',polarity:'negative',quote:'The drinks arrived late.'}]};
 const request={model:'gpt-6.1-sol',max_output_tokens:9500,input:[{role:'system',content:'EXPLICIT SYNTHETIC INSTRUCTIONS'},
  {role:'user',content:JSON.stringify(packet)}],text:{format:{type:'json_schema',schema:{type:'object',properties:{report:{type:'string'}},required:['report']}}}};
 return {packet,request,wire:JSON.stringify(request)};
}
it('measures and sends the frozen wire after a JSONB-like key reorder, without adding an unmeasured token entry',()=>{
 const {packet,request,wire}=fixture(),memo=new PlanTokenMemo(),original=solRequestSize(request,SOL_SIZE_POLICY,memo.count);
 const loadedPacket={...packet,statistics:{scope:{text:80,total:100},counts:{service:{negative:1,positive:3}}}};
 const rebuilt={...request,input:[request.input[0],{role:'user',content:JSON.stringify(loadedPacket)}]};
 expect(directCanonical(loadedPacket)).toBe(directCanonical(packet));expect(JSON.stringify(rebuilt)).not.toBe(wire);
 memo.sealed=true;memo.misses=0;
 expect(()=>solRequestSize(rebuilt,SOL_SIZE_POLICY,memo.count)).toThrow('JLS_TOKEN_MEASUREMENT_MISSING');
 const bound=bindDirectSolWire(rebuilt,loadedPacket,wire);
 expect(JSON.stringify(bound)).toBe(wire);expect(solRequestSize(bound,SOL_SIZE_POLICY,memo.count)).toEqual(original);
 expect(memo.misses).toBe(0);expect(JSON.stringify(request)).toBe(wire);
});
it.each(['quote','counts','polarity','evidence_id'] as const)('rejects changed %s even when another wire has valid JSON',field=>{
 const {packet,request,wire}=fixture(),changed=structuredClone(packet);
 if(field==='counts')changed.statistics.counts.service.positive=4;
 else changed.evidence[0][field]='changed';
 expect(()=>bindDirectSolWire(request,changed,wire)).toThrow('DIRECT_REPORT_SOL_PACKET_CHANGED');
});
it.each(['model','prompt','schema','output'] as const)('rejects changed %s instead of borrowing its token measurement',field=>{
 const {packet,request,wire}=fixture(),changed=structuredClone(request);
 if(field==='model')changed.model='another-model';
 if(field==='prompt')changed.input[0].content='different instructions';
 if(field==='schema')changed.text.format.schema.required=[];
 if(field==='output')changed.max_output_tokens=10000;
 expect(()=>bindDirectSolWire(changed,packet,wire)).toThrow('DIRECT_REPORT_SOL_REQUEST_CHANGED');
});
it('does not accept a missing certificate entry, fall back to retokenization or raise the budget',()=>{
 const {packet,request,wire}=fixture(),bound=bindDirectSolWire(request,packet,wire),memo=new PlanTokenMemo();memo.sealed=true;
 expect(()=>solRequestSize(bound,SOL_SIZE_POLICY,memo.count)).toThrow('JLS_TOKEN_MEASUREMENT_MISSING');
 expect(memo.entries.size).toBe(0);expect(memo.misses).toBe(0);expect(SOL_SIZE_POLICY.input_budget_tokens).toBe(32768);
});
it('rejects outer padding and duplicate packet keys, preserving exact certified bytes',()=>{
 const {packet,request,wire}=fixture();
 expect(()=>bindDirectSolWire(request,packet,' '+wire)).toThrow('DIRECT_REPORT_SOL_WIRE_CHANGED');
 const duplicate=structuredClone(request);
 duplicate.input[1].content='{"statistics":{},'+JSON.stringify(packet).slice(1);
 expect(()=>bindDirectSolWire(request,packet,JSON.stringify(duplicate))).toThrow('DIRECT_REPORT_SOL_PACKET_CHANGED');
});
