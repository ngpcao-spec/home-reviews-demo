import {cpSync,readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
const root=resolve(process.env.RUNNER_TEMP,'home-reviews-isolated')
if(!root.includes('home-reviews-isolated')||!process.env.CI)throw Error('CI_ONLY')
const target=join(root,'supabase/functions');cpSync('supabase/functions',target,{recursive:true})
writeFileSync(join(target,'_shared/ci-isolated-fetch.ts'),readFileSync('tests/ci/isolated-fetch.ts'))
for(const name of readdirSync(target,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.name.startsWith('_')).map(x=>x.name)){
 const path=join(target,name,'index.ts')
 try{writeFileSync(path,"import '../_shared/ci-isolated-fetch.ts'\n"+readFileSync(path,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
}
writeFileSync(join(root,'test-functions.env'),['SHARED_RESTAURANTS_ENABLED=true','REVIEW_PROVIDER=apify','APIFY_API_TOKEN=synthetic-test-only','OPENAI_API_KEY=synthetic-test-only','REVIEW_REPLY_MODEL=gpt-6.1-sol'].join('\n'))
console.log('ISOLATED_EDGE_COPIES_READY')
