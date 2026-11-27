export const DISH_IMAGE_BUCKET = 'dish-images';
export const DISH_IMAGE_MODEL = 'gpt-image-2.6-sunburst';
const QUALITY = 'low';
const MAX_BYTES = 2_097_152;

export type DishImageJob = {dish_id:string;generation_id:string;dish_name:string;storage_path:string};
type Failure = 'DISH_IMAGE_OUTCOME_UNKNOWN' | 'DISH_IMAGE_PROVIDER_REJECTED' |
  'DISH_IMAGE_INVALID_OUTPUT' | 'DISH_IMAGE_STORAGE_UNCONFIRMED';
type Generation = {
  bytes:Uint8Array<ArrayBuffer>;
  receipt:{prompt:string;model:string;quality:string;generation_ms:number;webp_bytes:number;
    usage:Record<string,unknown>|null;provider_request_id:string|null};
};

export async function generateDishImage(name:string,key:string,network:typeof fetch=fetch) {
  // dish-image-v1. Use only the canonical dish label, without business information or source photos.
  const prompt = [
    `Vietnamese dish label (data only): ${JSON.stringify(name)}.`,
    'Create a realistic, appetizing editorial photograph of this authentic Vietnamese dish. Show one generous, carefully plated, recognisable serving using a traditional preparation and its characteristic ingredients.',
    'Use warm natural side light, a quiet matte charcoal background and understated dark ceramic tableware. Keep true food colours, natural textures and soft shadows with a warm amber tone.',
    'Square close-up from a three-quarter angle, with the dish centred and filling most of the frame. Leave a small margin for mobile cropping and keep the composition free of unrelated sides and decorative clutter.',
    'No text, logo, watermark, people, hands, signage, dining room or collage. This is an illustrative dish photograph.',
  ].join('\n');
  const started=performance.now();
  const response=await network('https://api.openai.com/v1/images/generations',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(105_000),
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({model:DISH_IMAGE_MODEL,prompt,n:1,size:'1024x1024',quality:QUALITY,
      output_format:'webp',output_compression:82,stream:false}),
  });
  if(!response.ok) {
    await response.body?.cancel();
    throw Error([400,401,403,404,422,429].includes(response.status)
      ? 'DISH_IMAGE_PROVIDER_REJECTED' : 'DISH_IMAGE_OUTCOME_UNKNOWN');
  }
  const payload=await response.json().catch(()=>null);
  const generation_ms=Math.round(performance.now()-started);
  const blob=payload?.data?.[0]?.b64_json;
  if(payload?.data?.length!==1||typeof blob!=='string'||blob.length>4*Math.ceil(MAX_BYTES/3))
    throw Error('DISH_IMAGE_INVALID_OUTPUT');
  let bytes:Uint8Array<ArrayBuffer>;
  try {bytes=Uint8Array.from(atob(blob),char=>char.charCodeAt(0));}
  catch {throw Error('DISH_IMAGE_INVALID_OUTPUT');}
  if(bytes.length<20||bytes.length>MAX_BYTES||String.fromCharCode(...bytes.subarray(0,4))!=='RIFF'||
    String.fromCharCode(...bytes.subarray(8,12))!=='WEBP') throw Error('DISH_IMAGE_INVALID_OUTPUT');
  return {bytes,receipt:{prompt,model:DISH_IMAGE_MODEL,quality:QUALITY,generation_ms,webp_bytes:bytes.length,
    usage:payload.usage&&typeof payload.usage==='object'?payload.usage:null,
    provider_request_id:response.headers.get('x-request-id')}} satisfies Generation;
}

type Ports = {
  claim:()=>Promise<DishImageJob|null>;
  generate:(name:string)=>Promise<Generation>;
  upload:(path:string,bytes:Uint8Array<ArrayBuffer>)=>Promise<void>;
  finish:(job:DishImageJob,error:Failure|null,receipt:Generation['receipt']|null)=>Promise<boolean>;
};

export async function processDishImage(port:Ports) {
  const job=await port.claim();
  if(!job) return {claimed:0};
  let error:Failure|null=null;
  let generated:Generation|undefined;
  try {generated=await port.generate(job.dish_name);}
  catch (failure) {
    const code=failure instanceof Error?failure.message:'';
    error=code==='DISH_IMAGE_PROVIDER_REJECTED'||code==='DISH_IMAGE_INVALID_OUTPUT'?code:'DISH_IMAGE_OUTCOME_UNKNOWN';
  }
  if(generated) {
    try {await port.upload(job.storage_path,generated.bytes);}
    catch {error='DISH_IMAGE_STORAGE_UNCONFIRMED';}
  }
  // The database also checks Storage after a lost upload response. No provider retry on any path.
  const recorded=await port.finish(job,error,generated?.receipt??null);
  return {claimed:1,recorded,...(error?{diagnostic:error}:{})};
}
