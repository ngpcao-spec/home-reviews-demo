import {readFileSync,existsSync} from 'node:fs'
export const required=['real-auth','simultaneous-add','existing-data-and-proofs','shared-negative-sync','single-analysis','private-isolation','unsubscribe','outside-pilot','disable-and-rollback','language-provider-reuse','publication-only-evidence']
required.push('edited-review-date-and-checkpoints')
required.push('source-format-orders-replay-and-real-edit')
const path=process.env.CI_BROWSER_RECEIPT
if(!path)throw Error('BROWSER_RECEIPT_REQUIRED')
const result=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{passed:[]}
const missing=required.filter(name=>!result.passed?.includes(name))
if(missing.length)throw Error('REQUIRED_BROWSER_SCENARIOS_NOT_EXECUTED: '+missing.join(', '))
console.log('ALL_REQUIRED_BROWSER_SCENARIOS_PASSED',required.join(', '))
