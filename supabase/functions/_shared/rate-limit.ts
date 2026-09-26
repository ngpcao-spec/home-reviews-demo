const buckets=new Map<string,{count:number;resetAt:number}>()
export function enforceRateLimit(key:string,limit:number,windowMs:number){const now=Date.now();const bucket=buckets.get(key);if(!bucket||bucket.resetAt<=now){buckets.set(key,{count:1,resetAt:now+windowMs});return}if(bucket.count>=limit)throw new Error('RATE_LIMITED');bucket.count++}
