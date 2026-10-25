// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {processDisplayJob,translateDisplayOriginal,DisplayProviderError,type DisplayJob} from '../../supabase/functions/_shared/review-display-provider'
import {displayLanguage,reliableProviderLanguage} from '../../supabase/functions/_shared/review-display-language'
const job:DisplayJob={review_id:'synthetic',language:'fr',source_sha256:'hash',original_text:'Very slow service.',original_language:'en',source_provider:'apify'}
const port=()=>({reserve:vi.fn(async()=>true),finish:vi.fn(async()=>{}),translate:vi.fn(async()=>({status:'translated' as const,translated_text:'Service lent.',source_language:'en',language_origin:'detected' as const}))})
it('preserves provider language aliases and rejects missing or conflicting Latin/script metadata',()=>{
 expect(displayLanguage('en-GB')).toBe('en');expect(displayLanguage('iw')).toBe('he');expect(displayLanguage('unknown')).toBeNull()
 expect(reliableProviderLanguage('Очень медленное обслуживание.','fr','apify')).toBeNull();expect(reliableProviderLanguage('Très bon restaurant.','fr','apify')).toBe('fr')
})
it.each(['fr','vi'] as const)('does not translate matching originals for a %s account',async language=>{
 const p=port();await processDisplayJob({...job,language,original_language:language,original_text:language==='fr'?'Service très lent.':'Phục vụ rất chậm.'},p);expect(p.reserve).not.toHaveBeenCalled();expect(p.translate).not.toHaveBeenCalled();expect(p.finish).toHaveBeenCalledWith(expect.objectContaining({status:'original'}))
})
it('handles EN/VI/FR, missing and contradictory languages directly from the original',async()=>{
 for(const original_language of ['en','vi',null]){const p=port();await processDisplayJob({...job,original_language},p);expect(p.translate).toHaveBeenCalledWith(job.original_text,'fr',original_language)}
 const p=port();await processDisplayJob({...job,original_language:'fr',original_text:'Очень медленное обслуживание.'},p);expect(p.translate).toHaveBeenCalledWith('Очень медленное обслуживание.','fr',null)
})
it('does not call a provider for textless reviews or compatible provider translations',async()=>{
 for(const original_text of ['','   ','⭐']){const p=port();await processDisplayJob({...job,original_text},p);expect(p.reserve).not.toHaveBeenCalled()}
 const p=port();await processDisplayJob({...job,provider_translation:'Service lent.'},p);expect(p.reserve).not.toHaveBeenCalled();expect(p.finish).toHaveBeenCalledWith(expect.objectContaining({status:'translated',translated_text:'Service lent.'}))
})
it('never sends a call without reservation and never retries an unknown result',async()=>{
 const p=port();p.reserve.mockResolvedValue(false);await processDisplayJob(job,p);expect(p.translate).not.toHaveBeenCalled()
 const q=port();q.translate.mockRejectedValue(new DisplayProviderError('TRANSLATION_OUTCOME_UNKNOWN',{},true));await processDisplayJob(job,q);expect(q.translate).toHaveBeenCalledTimes(1);expect(q.finish).toHaveBeenCalledWith(expect.objectContaining({status:'unknown'}))
})
it('retains provider usage on rejected language identification and does not make an English intermediary',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'receipt',model:'mock-native',usage:{input_tokens:19,output_tokens:8},output_text:JSON.stringify({source_language:'und',confidence:'low',translated_text:'OK'})}),{status:200}))
 try{await expect(translateDisplayOriginal('OK','vi',null,'SYNTHETIC')).rejects.toMatchObject({message:'LANGUAGE_UNCERTAIN',receipt:{model:'mock-native',usage:{input_tokens:19,output_tokens:8}}});const body=JSON.parse(fetch.mock.calls[0][1]?.body as string);expect(body.input[1].content).toContain('"original_review":"OK"');expect(body.input[1].content).toContain('"target_language":"vi"');expect(fetch).toHaveBeenCalledTimes(1)}finally{fetch.mockRestore()}
})
