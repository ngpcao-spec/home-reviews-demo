// Synthetic HTTP providers only. No upstream forwarding and no credentials.
import {createServer} from 'node:http'
const placeId='ChIJTQBISo9ncDERyPcP3aY9kI4',cid='10272778536914778056'
let negative=false,aiCalls=0;const runs=[]
const base={cid,placeId,title:'K.HOUSE Restaurant',address:'Nha Trang — isolated fixture',totalScore:4.5,reviewsCount:1,originalLanguage:'fr',language:'fr',url:`https://www.google.com/maps?cid=${cid}`}
const old={...base,reviewId:'fixture-old',stars:5,text:'Très bon accueil.',publishedAtDate:'2026-11-01T10:00:00Z'}
const newer={...base,reviewsCount:2,reviewId:'fixture-negative',stars:1,text:'Le repas était froid et le service très lent.',publishedAtDate:'2026-11-11T00:00:00Z'}
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');let body='';for await(const b of req)body+=b
  const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))}
  if(url.pathname==='/control/status')return json({runs,aiCalls,negative})
  if(url.pathname==='/control/negative'&&req.method==='POST'){negative=true;return json({ok:true})}
  if(url.pathname==='/apify/v2/acts/compass~google-maps-reviews-scraper/runs'&&req.method==='POST'){
   const input=JSON.parse(body);if(!JSON.stringify(input.startUrls).includes(cid)&&!JSON.stringify(input.startUrls).includes(placeId))throw Error('UNEXPECTED_RESTAURANT')
   const id=`fixture-run-${runs.length+1}`,defaultDatasetId=`fixture-data-${runs.length+1}`
   const run={id,defaultDatasetId,status:'SUCCEEDED',actId:'Xb8osYTtOjlsgI6k9',buildId:'ZzXJ3FC9OUBCJxtza',input,negative,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),usageTotalUsd:0}
   runs.push(run);await new Promise(r=>setTimeout(r,350));return json({data:run})
  }
  if(url.pathname.startsWith('/apify/v2/actor-runs/')){const run=runs.find(r=>r.id===url.pathname.split('/').at(-1));if(!run)throw Error('RUN_NOT_FOUND');return json({data:run})}
  if(url.pathname.startsWith('/apify/v2/datasets/')){const run=runs.find(r=>r.defaultDatasetId===url.pathname.split('/')[4]);if(!run)throw Error('DATASET_NOT_FOUND');return json(run.negative?[newer,old]:[old])}
  if(url.pathname==='/openai/v1/responses'&&req.method==='POST'){
   aiCalls++;await new Promise(r=>setTimeout(r,700));return json({output_text:JSON.stringify({ai_suggested_reply:'Merci pour votre retour. Nous regrettons que le repas ait été froid et le service lent. Nous allons examiner ces points avec notre équipe.',detected_language:'fr'}),usage:{input_tokens:100,output_tokens:35,total_tokens:135}})
  }
  res.statusCode=404;return json({error:'UNEXPECTED_PROVIDER_REQUEST',path:url.pathname})
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}))}
}).listen(4411,'0.0.0.0',()=>console.log('SYNTHETIC_PROVIDERS_READY'))
