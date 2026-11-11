import {cpSync,readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
const root=resolve(process.env.RUNNER_TEMP,'home-reviews-isolated')
if(!root.includes('home-reviews-isolated')||!process.env.CI)throw Error('CI_ONLY')
const target=join(root,'supabase/functions');cpSync('supabase/functions',target,{recursive:true})
// Preserve real static imports used by legacy workers when the CLI bundles functions.
for(const file of ['pilot-evidence-v3-gpt6-reserved40-reference-20261011.json','jev-economic-pilot-gpt6-posthoc-audit-20261011.json']){
 cpSync(join('docs',file),join(root,'docs',file),{recursive:true})
}
// Edge Runtime disallows Deno.env.set. Substitute only the endpoint in temporary
// source copies; the real service key, Auth and business logic stay unchanged.
for(const file of readdirSync(target,{recursive:true}).filter(name=>name.endsWith('.ts'))){
 const path=join(target,file)
 writeFileSync(path,readFileSync(path,'utf8').replace(/Deno\.env\.get\(['"]SUPABASE_URL['"]\)/g,"'https://home-reviews-ci.invalid'"))
}
writeFileSync(join(target,'_shared/ci-isolated-fetch.ts'),readFileSync('tests/ci/isolated-fetch.ts'))
for(const name of readdirSync(target,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.name.startsWith('_')).map(x=>x.name)){
 const path=join(target,name,'index.ts')
 try{writeFileSync(path,"import '../_shared/ci-isolated-fetch.ts'\n"+readFileSync(path,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
}
writeFileSync(join(root,'test-functions.env'),['SHARED_RESTAURANTS_ENABLED=true','REVIEW_PROVIDER=apify','APIFY_API_TOKEN=synthetic-test-only','OPENAI_API_KEY=synthetic-test-only','REVIEW_REPLY_MODEL=gpt-6.1-sol'].join('\n'))
console.log('ISOLATED_EDGE_COPIES_READY')
