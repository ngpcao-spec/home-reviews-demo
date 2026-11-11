// Imported only into temporary runner copies of the real Edge functions.
// Every application HTTP request is local or simulated; fail closed otherwise.
const actualFetch=globalThis.fetch.bind(globalThis)
const localSupabase=Deno.env.get('SUPABASE_URL')!
Deno.env.set('SUPABASE_URL','https://home-reviews-ci.invalid')
globalThis.fetch=(input:RequestInfo|URL,init?:RequestInit)=>{
 const source=input instanceof Request?input.url:String(input),url=new URL(source)
 let target:string
 if(url.hostname==='home-reviews-ci.invalid')target=localSupabase+url.pathname+url.search
 else if(url.hostname==='api.apify.com')target='http://host.docker.internal:4411/apify'+url.pathname+url.search
 else if(url.hostname==='api.openai.com')target='http://host.docker.internal:4411/openai'+url.pathname+url.search
 else if(new URL(localSupabase).host===url.host)target=source
 else throw Error('EXTERNAL_NETWORK_FORBIDDEN: '+url.hostname)
 return actualFetch(input instanceof Request?new Request(target,input):target,init)
}
