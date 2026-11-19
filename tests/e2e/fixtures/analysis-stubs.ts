const p=new URLSearchParams(location.search)
export const lang=p.get('language')==='vi'?'vi':'fr'
export const state=p.get('state')||'fresh'
export const supabase=p.get('tab')==='statistics'?{rpc:(name:string,args:unknown)=>({abortSignal:async(signal:AbortSignal)=>{
 const r=await fetch('/__statistics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,language:lang,state}),signal});return r.json()
}})}:null
export function useApp(){return {reviews:[],establishments:[{id:'fixture',name:state==='sparse-chart'?'TITO restaurant':state==='two-point-chart'?'Nhà hàng Green Home':'K.HOUSE Restaurant',currentRating:4.7,currentReviewCount:500},...(p.has('multiple')?[{id:'other',name:'Autre restaurant',currentRating:4,currentReviewCount:0}]:[])],notifications:[],toasts:[],demoMode:false,preferredLanguage:lang,currentUser:{id:'fixture-account',email:'test@example.test',initials:'FR'}}}
export function useHistoricalGeneration(){return {phase:state==='running'?'generating':state==='failed'?'failed':'idle',feedback:null,run:null,start:async()=>{throw Error('TEST_GENERATION_DISABLED')},abandon:async()=>{throw Error('TEST_GENERATION_DISABLED')}}}
