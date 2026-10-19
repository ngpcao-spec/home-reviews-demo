import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {solReadyPort} from '../../supabase/functions/_shared/jls-sol-ready-store';
import type {SupabaseClient} from '@supabase/supabase-js';
const migration=readFileSync('supabase/migrations/20261019124047_jls_direct4_sol_continuation.sql','utf8');
it('uses a distinct immutable continuation and locks the old zero-attempt operation before reservation',()=>{
 expect(migration).toContain('direct4_one_paid_continuation');expect(migration).toContain('direct4_one_paid_consent');
 expect(migration).toContain('request_count in(0,1)');expect(migration).toContain('o.request_count=0');
 expect(migration).toContain('where id=c.source_operation_id for update');
 expect(migration).toContain('DIRECT4_LOST_ATTEMPT_NO_RETRY');
 expect(migration).not.toMatch(/update public.analysis_jls_(restaurant|sol_ready)/);
 expect(migration).toContain('execute function public.jls_ready_operation_guard()');
});
it('binds the existing consent, immutable saved Luna dossier, exact request and organization',()=>{
 for(const field of ['source_run_sha256','source_operation_sha256','source_archive_sha256','ready_sha256','consent_sha256',
  'request_sha256','request_raw_sha256','r.expires_at>now()','r.consent_sha256=public.jls_restaurant_hash(r.consent)',
  "r.consent->'scope'->>'configuration_sha256'",'check_jls_direct4_ready_sources','enable row level security','organization_members'])expect(migration).toContain(field);
 expect(migration).not.toContain('security definer');
});
it('the same ReadyPort routes all continuation mutations to isolated RPCs',async()=>{
 const rpc=vi.fn(async()=>({data:true})),admin={rpc} as unknown as SupabaseClient;
 const port=solReadyPort(admin,true);
 await port.claim('id','worker');await port.receive('id','worker',{} as never,'sha');
 await port.finish('id','worker','completed',{},'sha');await port.abort('id','worker','error');
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['claim_jls_direct4_continuation','receive_jls_direct4_continuation',
  'finish_jls_direct4_continuation','abort_jls_direct4_continuation']);
});
it('historical ReadyPort callers keep the original RPCs',async()=>{
 const rpc=vi.fn(async()=>({data:true})),port=solReadyPort({rpc} as unknown as SupabaseClient);
 await port.claim('id','worker');expect(rpc).toHaveBeenCalledWith('claim_jls_sol_ready',{p_operation:'id',p_worker:'worker'});
});
it('deployment creates no paid continuation; mocks never load the provider key',()=>{
 expect(migration).not.toMatch(/select public.create_jls_direct4_continuation/);
 const server=readFileSync('supabase/functions/process-jls-restaurant/index.ts','utf8');
 expect(server.indexOf("payload?.mode==='direct4_continuation_inspect'")).toBeLessThan(server.indexOf('OPENAI_API_KEY'));
 const probe=readFileSync('supabase/functions/_shared/jls-direct4-continuation.ts','utf8');
 expect(probe).toContain("state.operation.mode!=='mock'");expect(probe).toContain('EXPLICIT_TECHNICAL_MOCK');
});
