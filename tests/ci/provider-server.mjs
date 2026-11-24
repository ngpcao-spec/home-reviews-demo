// Synthetic HTTP providers only. No upstream forwarding and no credentials.
import {createServer} from 'node:http'
const placeId='ChIJTQBISo9ncDERyPcP3aY9kI4',cid='10272778536914778056'
let negative=false,aiCalls=0;const runs=[],menuRuns=[]
const base={cid,placeId,title:'K.HOUSE Restaurant',address:'Nha Trang — isolated fixture',totalScore:4.5,reviewsCount:1,originalLanguage:'fr',language:'fr',url:`https://www.google.com/maps?cid=${cid}`}
const old={...base,reviewId:'fixture-old',stars:5,text:'Très bon accueil.',publishedAtDate:'2026-11-01T10:00:00Z'}
const newer={...base,reviewsCount:2,reviewId:'fixture-negative',stars:1,text:'Le repas était froid et le service très lent.',publishedAtDate:'2026-11-11T00:00:00Z'}
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');let body='';for await(const b of req)body+=b
  const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))}
  if(url.pathname==='/control/status')return json({runs,menuRuns,aiCalls,negative})
  if(url.pathname==='/apify/v2/acts/rainminer~google-maps-menu-scraper')return json({data:{id:'8GGZ9N7j2JhqnQ3oT',notice:'NONE',pricingInfos:[{startedAt:'2020-01-01',pricingModel:'PAY_PER_EVENT',minimalMaxTotalChargeUsd:0}]}})
  if(url.pathname==='/apify/v2/acts/rainminer~google-maps-menu-scraper/runs'&&req.method==='POST'){
   const input=JSON.parse(body)
   if(input.placeIds?.length!==1||!input.placeIds[0].startsWith('ChIJ')||url.searchParams.get('maxTotalChargeUsd')!=='0.5'||url.searchParams.get('restartOnError')!=='false')throw Error('UNSAFE_MENU_INPUT')
   const id='menu-run-'+(menuRuns.length+1)
   const run={id,defaultDatasetId:id+'-data',defaultKeyValueStoreId:id+'-input',actId:'8GGZ9N7j2JhqnQ3oT',status:'SUCCEEDED',input,buildNumber:'synthetic',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),usageTotalUsd:0.03,
    options:{maxTotalChargeUsd:.5,isMaxTotalChargeUsdSetByUser:true,restartOnError:false},pricingInfo:{pricingModel:'PAY_PER_EVENT',isPPEPlatformUsagePaidByUser:false}}
   menuRuns.push(run);await new Promise(r=>setTimeout(r,500));return json({data:run})
  }
  const menu=menuRuns.find(r=>url.pathname.includes(r.id))
  if(menu){
   if(url.pathname.endsWith('/INPUT'))return json(menu.input)
   if(url.pathname.endsWith('/items'))return json([
    {placeId:menu.input.placeIds[0],name:'Riz aux légumes',category:'Food',description:'Riz et légumes',price:null},
    {placeId:menu.input.placeIds[0],name:'Riz aux légumes',category:'Food',price:null},
    {placeId:menu.input.placeIds[0],name:'Chef spécial',category:'Chef',price:null},
    {placeId:menu.input.placeIds[0],name:'Green tea',category:'Tea - Coffee',price:20},
   ])
   if(url.pathname.includes('/datasets/'))return json({data:{itemCount:4}})
   if(url.pathname.includes('/actor-runs/'))return json({data:menu})
  }
  if(url.pathname==='/control/negative'&&req.method==='POST'){negative=true;return json({ok:true})}
  if(url.pathname==='/apify/v2/acts/compass~google-maps-reviews-scraper/runs'&&req.method==='POST'){
   const input=JSON.parse(body);if(!JSON.stringify(input.startUrls).includes(cid)&&!JSON.stringify(input.startUrls).includes(placeId))throw Error('UNEXPECTED_RESTAURANT')
   const id=`fixture-run-${runs.length+1}`,defaultDatasetId=`fixture-data-${runs.length+1}`
   const run={id,defaultDatasetId,status:'SUCCEEDED',actId:'Xb8osYTtOjlsgI6k9',buildId:'ZzXJ3FC9OUBCJxtza',input,negative,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),usageTotalUsd:0}
   runs.push(run);await new Promise(r=>setTimeout(r,2000));return json({data:run})
  }
  if(url.pathname.startsWith('/apify/v2/actor-runs/')){const run=runs.find(r=>r.id===url.pathname.split('/').at(-1));if(!run)throw Error('RUN_NOT_FOUND');return json({data:run})}
  if(url.pathname.startsWith('/apify/v2/datasets/')){const run=runs.find(r=>r.defaultDatasetId===url.pathname.split('/')[4]);if(!run)throw Error('DATASET_NOT_FOUND');return json((run.negative?[newer,old]:[old]).map(review=>run.input.language==='vi'?{...review,textTranslated:review.reviewId==='fixture-negative'?'Bữa ăn nguội và phục vụ chậm.':'Đón tiếp tốt.',translatedLanguage:'vi'}:review))}
  if(url.pathname==='/openai/v1/responses'&&req.method==='POST'){
   aiCalls++;await new Promise(r=>setTimeout(r,700));return json({output_text:JSON.stringify({ai_suggested_reply:'Merci pour votre retour. Nous regrettons que le repas ait été froid et le service lent. Nous allons examiner ces points avec notre équipe.',detected_language:'fr'}),usage:{input_tokens:100,output_tokens:35,total_tokens:135}})
  }
  res.statusCode=404;return json({error:'UNEXPECTED_PROVIDER_REQUEST',path:url.pathname})
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}))}
}).listen(4411,'0.0.0.0',()=>console.log('SYNTHETIC_PROVIDERS_READY'))
