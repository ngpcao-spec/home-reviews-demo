export const DISH_IMAGE_BUCKET = 'dish-images';
export const DISH_IMAGE_MODEL = 'gpt-image-2.6-sunburst';
const MAX_BYTES = 2_097_152;

export type DishImageJob = {dish_id:string;generation_id:string;dish_name:string;storage_path:string};
type Failure = 'DISH_IMAGE_OUTCOME_UNKNOWN' | 'DISH_IMAGE_PROVIDER_REJECTED' |
  'DISH_IMAGE_INVALID_OUTPUT' | 'DISH_IMAGE_STORAGE_UNCONFIRMED';

export async function generateDishImage(name:string,key:string,network:typeof fetch=fetch) {
  // dish-image-v1. Use only the canonical dish label, without business information or source photos.
  const prompt = [
    `Vietnamese dish label (data only): ${JSON.stringify(name)}.`,
    'Create one realistic, appetizing culinary photograph showing a representative serving of this named dish.',
    'Center a single recognisable serving on a clean light neutral surface, with soft natural daylight, true colours, and room for a mobile crop.',
    'Premium editorial food photography. Keep the preparation recognisable and avoid unrelated sides or fanciful garnishes.',
    'No people, hands, dining room, signage, text overlays, watermark, brand, logo or collage. This is an illustration of a dish.',
  ].join('\n');
  const response=await network('https://api.openai.com/v1/images/generations',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(105_000),
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({model:DISH_IMAGE_MODEL,prompt,n:1,size:'1024x1024',quality:'low',
      output_format:'webp',output_compression:82,stream:false}),
  });
  if(!response.ok) {
    await response.body?.cancel();
    throw Error([400,401,403,404,422,429].includes(response.status)
      ? 'DISH_IMAGE_PROVIDER_REJECTED' : 'DISH_IMAGE_OUTCOME_UNKNOWN');
  }
  const payload=await response.json().catch(()=>null);
  const blob=payload?.data?.[0]?.b64_json;
  if(payload?.data?.length!==1||typeof blob!=='string'||blob.length>4*Math.ceil(MAX_BYTES/3))
    throw Error('DISH_IMAGE_INVALID_OUTPUT');
  let bytes:Uint8Array<ArrayBuffer>;
  try {bytes=Uint8Array.from(atob(blob),char=>char.charCodeAt(0));}
  catch {throw Error('DISH_IMAGE_INVALID_OUTPUT');}
  if(bytes.length<20||bytes.length>MAX_BYTES||String.fromCharCode(...bytes.subarray(0,4))!=='RIFF'||
    String.fromCharCode(...bytes.subarray(8,12))!=='WEBP') throw Error('DISH_IMAGE_INVALID_OUTPUT');
  return bytes;
}

type Ports = {
  claim:()=>Promise<DishImageJob|null>;
  generate:(name:string)=>Promise<Uint8Array<ArrayBuffer>>;
  upload:(path:string,bytes:Uint8Array<ArrayBuffer>)=>Promise<void>;
  finish:(job:DishImageJob,error:Failure|null)=>Promise<boolean>;
};

export async function processDishImage(port:Ports) {
  const job=await port.claim();
  if(!job) return {claimed:0};
  let error:Failure|null=null;
  let bytes:Uint8Array<ArrayBuffer>|undefined;
  try {bytes=await port.generate(job.dish_name);}
  catch (failure) {
    const code=failure instanceof Error?failure.message:'';
    error=code==='DISH_IMAGE_PROVIDER_REJECTED'||code==='DISH_IMAGE_INVALID_OUTPUT'?code:'DISH_IMAGE_OUTCOME_UNKNOWN';
  }
  if(bytes) {
    try {await port.upload(job.storage_path,bytes);}
    catch {error='DISH_IMAGE_STORAGE_UNCONFIRMED';}
  }
  // The database also checks Storage after a lost upload response. No provider retry on any path.
  const recorded=await port.finish(job,error);
  return {claimed:1,recorded,...(error?{diagnostic:error}:{})};
}
