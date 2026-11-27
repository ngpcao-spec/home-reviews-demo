import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {json} from '../_shared/cors.ts';
import {DISH_IMAGE_BUCKET,DISH_IMAGE_MODEL,generateDishImage,processDishImage,type DishImageJob} from '../_shared/dish-image.ts';

Deno.serve(async(request)=>{
  if(request.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  const token=request.headers.get('x-home-reviews-scheduler');
  if(!token) return json({error:'UNAUTHORIZED'},401);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const auth=await admin.rpc('verify_review_scheduler_token',{p_token:token});
  if(auth.error||auth.data!==true) return json({error:'UNAUTHORIZED'},401);
  const key=Deno.env.get('OPENAI_API_KEY')?.trim();
  if(!key) return json({error:'DISH_IMAGE_PROVIDER_UNCONFIGURED'},503);
  try {
    if(new URL(request.url).searchParams.get('preflight')==='1'){
      const model=await fetch('https://api.openai.com/v1/models/'+DISH_IMAGE_MODEL,{
        headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(8000),
      });
      const available=model.ok&&(await model.json()).id===DISH_IMAGE_MODEL;
      return json({model:DISH_IMAGE_MODEL,available,provider_status:model.status},available?200:503);
    }
    const result=await processDishImage({
      claim:async()=>{
        const result=await admin.rpc('claim_dish_image');
        if(result.error) throw Error('DISH_IMAGE_CLAIM_FAILED');
        return (result.data as DishImageJob[])[0]??null;
      },
      generate:(name)=>generateDishImage(name,key),
      upload:async(path,bytes)=>{
        const result=await admin.storage.from(DISH_IMAGE_BUCKET).upload(path,bytes,{
          contentType:'image/webp',cacheControl:'31536000',upsert:false,
        });
        if(result.error) throw Error('DISH_IMAGE_STORAGE_UNCONFIRMED');
      },
      finish:async(job,error,receipt)=>{
        if(receipt) console.info('DISH_IMAGE_GENERATION_RECEIPT',{dish_id:job.dish_id,generation_id:job.generation_id,...receipt});
        const result=await admin.rpc('finish_dish_image',{p_dish:job.dish_id,p_generation:job.generation_id,p_error:error,p_receipt:receipt});
        if(result.error) throw Error('DISH_IMAGE_FINISH_UNCONFIRMED');
        return result.data===true;
      },
    });
    return json(result);
  } catch {
    return json({error:'DISH_IMAGE_WORKER_FAILED'},500);
  }
});
