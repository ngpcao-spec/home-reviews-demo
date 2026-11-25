import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {getEncoding} from 'js-tiktoken'
import {classifyMenuWithAi, DEFAULT_MODEL, menuAiRequest} from '../supabase/functions/_shared/menu-dish-ai.ts'

const live=process.argv[2]==='--live'
if (process.argv.length>2&&!live) throw Error('Use no argument for an estimate or --live for the two-menu pilot.')
const limits={output:3000,expectedOutput:1500}
const prices={input:0.20,output:1.25}
const fixtures=[
  {file:'bun-bo-huong-giang-menu-saved.json',excluded:[4,5,6,7]},
  {file:'banh-can-menu-saved.json'},
]
const encoding=getEncoding('o200k_base')
const samples=await Promise.all(fixtures.map(async spec=>{
  const file=new URL('../tests/fixtures/'+spec.file,import.meta.url)
  const menu=JSON.parse(await readFile(file,'utf8'))
  if (!menu.runId||!Array.isArray(menu.raw)||!menu.raw.length||
    menu.raw.some(row=>row.placeId!==menu.placeId)) throw Error('PILOT_SOURCE_MISMATCH')
  const excluded=new Set(spec.excluded??menu.result.excludedDrinks.map(row=>row.sourceRow))
  const packet={
    restaurant:menu.raw[0].placeName?.trim()||menu.establishment,
    lines:menu.raw.map((row,i)=>({
      id:i+1,name:row.name??null,section:row.category??null,description:row.description??null,
      price:row.price??null,priceText:row.priceText??null,currency:row.currency??null,knownDrink:excluded.has(i+1),
    })),
  }
  const estimatedInput=encoding.encode(JSON.stringify(menuAiRequest(packet,DEFAULT_MODEL,limits.output))).length
  return {
    runId:menu.runId,packet,estimatedInput,
    estimatedUsd:(estimatedInput*prices.input+limits.expectedOutput*prices.output)/1e6,
    estimateAtOutputLimitUsd:(estimatedInput*prices.input+limits.output*prices.output)/1e6,
  }
}))
console.table(samples.map(({packet,runId,...estimate})=>({restaurant:packet.restaurant,rows:packet.lines.length,...estimate})))
console.log('Total estimated USD:',samples.reduce((s,item)=>s+item.estimatedUsd,0).toFixed(5))
console.log('Total with output limit and estimated input USD:',samples.reduce((s,item)=>s+item.estimateAtOutputLimitUsd,0).toFixed(5))
if (live) {
  const key=process.env.OPENAI_API_KEY?.trim()
  if (!key) throw Error('PILOT_OPENAI_CREDENTIAL_UNAVAILABLE')
  const folder=new URL('../artifacts/menu-dish-ai-pilot/',import.meta.url)
  await mkdir(folder,{recursive:true})
  // One receipt per menu, reserved before the provider request. An interrupted
  // attempt remains reserved so a second invocation cannot charge it again.
  for (const sample of samples) {
    const receipt=new URL(sample.runId+'.json',folder)
    const common={runId:sample.runId,restaurant:sample.packet.restaurant,model:DEFAULT_MODEL}
    await writeFile(receipt,JSON.stringify({...common,status:'attempted'},null,2),{flag:'wx'})
    try {
      const result=await classifyMenuWithAi(sample.packet,DEFAULT_MODEL,key,fetch,limits.output)
      await writeFile(receipt,JSON.stringify({...common,status:'succeeded',...result},null,2))
    } catch {
      await writeFile(receipt,JSON.stringify({...common,status:'failed_or_unknown'},null,2))
      process.exitCode=1
      break
    }
  }
}
