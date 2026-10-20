import {expect,it} from 'vitest';
import {balancedDirectReportInstructions,directReportInstructions,verifyDirectReportSources} from '../../supabase/functions/_shared/jev-direct-report-preparation';
import {directHash,DIRECT_CONFIG} from '../../supabase/functions/_shared/jev-direct-categories';
import {readFileSync} from 'node:fs';
it('describes technical missing replies separately from nine genuinely textless reviews',()=>{
 const instructions=balancedDirectReportInstructions({source_reviews:100,analysed_text_reviews:87,textless_statistics_only:9,technical_missing_reviews:4,textual_source_reviews:91});
 expect(instructions).toContain('over 87 analysed reviews');expect(instructions).toContain('other 9 reviews have no text');
 expect(instructions).toContain('4 additional textual reviews');expect(instructions).toContain('not neutral or not_mentioned');
 expect(instructions).toContain('Do not claim all 91 textual reviews');
 expect(instructions).toContain('A strongly positive corpus must remain clearly positive');
});
it('leaves the old complete-scope instructions unchanged',()=>{
 const text=directReportInstructions();expect(text).toContain('over 80 analysed reviews');expect(text).toContain('other 20 reviews');
 expect(text).not.toContain('technical reason');expect(text).not.toContain('Coverage is incomplete');
});
it('preserves the frozen six-choice four-category JEV configuration identity',async()=>{
 expect(await directHash(DIRECT_CONFIG)).toBe('e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69');
});
it('refuses duplicate missing IDs and a missing review with a purported result',async()=>{
 const input={dataset:{body:{reviews:[{review_id:'already_received'}]}},snapshot:{body:{reviews:[{id:'missing',analysis_text:'text'},{id:'already_received',analysis_text:'text'}]}}};
 for(const ids of [['missing','missing'],['already_received'],['foreign']])
  await expect(verifyDirectReportSources(input as never,{technical_missing_review_ids:ids} as never)).rejects.toThrow('DIRECT_REPORT_TECHNICAL_MISSING_CHANGED');
});
it('uses the existing authorization/worker path, database checks and one continuation per source',()=>{
 const sql=readFileSync('supabase/migrations/20261020012043_jls_direct4_partial_continuation.sql','utf8');
 expect(sql).not.toMatch(/create table|select public.authorize|net.http_post|statement_timeout/i);
 expect(sql).toContain('jls_one_partial_continuation_per_source_run');expect(sql).toContain('request_count=0');
 expect(sql).toContain("t.status='running' and t.request_count=1");expect(sql).toContain('source_tasks_sha256');
 expect(sql).toContain('source_artifacts_sha256');expect(sql).toContain('technical_missing_reviews');
 expect(sql).toContain('revoke all on function');
 const cert=readFileSync('supabase/migrations/20261020013947_jls_partial_evidence_certificate.sql','utf8');
 expect(cert).toContain('cert.body=p_body');expect(cert).toContain('JLS_CERTIFICATE_RPC_REQUIRED');
 expect(cert).toContain('p_sha is distinct from public.jls_restaurant_hash(p_body)');
 expect(cert).not.toContain('statement_timeout');
});
