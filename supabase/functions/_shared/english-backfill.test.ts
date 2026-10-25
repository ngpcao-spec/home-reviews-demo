// @vitest-environment node
import {describe,it,expect,vi} from 'vitest'
import {processEnglishJob,type EnglishJob} from './english-backfill.ts'
import {readFileSync} from 'node:fs'
describe('retired English collection',()=>{
 it.each(['queued','running','starting'])('never accesses the provider or database for an old %s job',async status=>{
  const admin=new Proxy({},{get(){throw new Error('DATABASE_ACCESS_FORBIDDEN')}})
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('NETWORK_FORBIDDEN'))
  try{expect(await processEnglishJob(admin as never,{status} as EnglishJob,'unused')).toEqual({status:'retired',error_code:'ENGLISH_BACKFILL_RETIRED',provider_requests:0});expect(network).not.toHaveBeenCalled()}finally{network.mockRestore()}
 })
 it('retired user endpoint authenticates without enqueueing',()=>{
  const endpoint=readFileSync(new URL('../backfill-review-english-translations/index.ts',import.meta.url),'utf8')
  expect(endpoint).toContain('requireUser');expect(endpoint).toContain('410');expect(endpoint).not.toContain('.insert(');expect(endpoint).not.toContain('startApifyRun')
 })
})
