import {afterEach,describe,it,expect,vi} from 'vitest'
import {analyzeReviewWithOpenAI,analyzeFourStarReviewWithOpenAI,translateReplyWithOpenAI,reviewAiSchema} from './ai.ts'
afterEach(()=>vi.unstubAllGlobals())
function provider(output:object){
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({output_text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:35,total_tokens:135}}),{status:200}))
  vi.stubGlobal('fetch',fetcher);vi.stubGlobal('Deno',{env:{get:()=> 'test-key-never-used'}})
  return fetcher
}
describe('individual reply without summary tokens',()=>{
  it.each(['fr','vi'] as const)('requests only a reply and language in %s in one provider call',async language=>{
    const reply=language==='fr'?'Merci pour votre retour. Nous regrettons cette attente.':'Cảm ơn bạn đã phản hồi. Chúng tôi rất tiếc về thời gian chờ.'
    const fetcher=provider({ai_suggested_reply:reply,detected_language:'en'})
    const result=await analyzeReviewWithOpenAI(2,'We waited too long.',language)
    expect(result).toMatchObject({ai_suggested_reply:reply,detected_language:'en',usage:{output_tokens:35}})
    expect(result).not.toHaveProperty('ai_summary')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const body=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)
    expect(body.text.format.schema.required).toEqual(['ai_suggested_reply','detected_language'])
    expect(Object.keys(body.text.format.schema.properties)).toEqual(['ai_suggested_reply','detected_language'])
    expect(JSON.stringify(body)).not.toMatch(/ai_summary|summary|summari/i)
    expect(body.input[1].content).toContain('We waited too long.')
  })
  it('does not require, validate or retain a legacy summary key',()=>{
    expect(reviewAiSchema.parse({ai_suggested_reply:'Merci.',detected_language:'fr',ai_summary:42})).toEqual({ai_suggested_reply:'Merci.',detected_language:'fr'})
  })
  it('still validates the reply language without any summary validation',async()=>{
    provider({ai_suggested_reply:'Очень плохое обслуживание.',detected_language:'ru'})
    await expect(analyzeReviewWithOpenAI(2,'Очень плохое обслуживание.','fr')).rejects.toThrow('AI_LANGUAGE_MISMATCH')
  })
  it('keeps four-star triage and its operational feedback field in one call, without an ai_summary alias',async()=>{
    const fetcher=provider({has_negative_feedback:true,negative_feedback_summary:'Attente longue.',ai_suggested_reply:'Merci. Nous regrettons cette attente.',detected_language:'fr'})
    const result=await analyzeFourStarReviewWithOpenAI('Bon repas mais attente longue.','fr')
    expect(result.has_negative_feedback).toBe(true)
    expect(result.negative_feedback_summary).toBe('Attente longue.')
    expect(result).not.toHaveProperty('ai_summary');expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('keeps the separate on-demand draft translation contract unchanged',async()=>{
    const fetcher=provider({translated_reply_text:'Thank you for your feedback.'})
    expect(await translateReplyWithOpenAI('Merci pour votre retour.','fr','en')).toMatchObject({translated_reply_text:'Thank you for your feedback.'})
    const body=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)
    expect(body.text.format.schema.required).toEqual(['translated_reply_text'])
  })
})
