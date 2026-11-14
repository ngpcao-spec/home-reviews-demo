const p=new URLSearchParams(location.search)
export const lang=p.get('language')==='vi'?'vi':'fr'
export const state=p.get('state')||'fresh'
export const supabase=null
export function useApp(){return {reviews:[],establishments:[{id:'fixture',name:'K.HOUSE Restaurant',currentRating:4.7,currentReviewCount:500}],notifications:[],toasts:[],demoMode:false,preferredLanguage:lang,currentUser:{id:'fixture-account',email:'test@example.test',initials:'FR'}}}
export function useHistoricalGeneration(){return {phase:state==='running'?'generating':state==='failed'?'failed':'idle',feedback:null,run:null,start:async()=>{throw Error('TEST_GENERATION_DISABLED')},abandon:async()=>{throw Error('TEST_GENERATION_DISABLED')}}}
