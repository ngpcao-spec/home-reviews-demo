import {readFileSync,statSync} from 'node:fs'
import assert from 'node:assert/strict'
const folder='test-results/dishes-auth',r=JSON.parse(readFileSync(folder+'/receipt.json','utf8'))
for(const name of ['two-real-auth-sessions-read-scope-and-shared-fr-vi','manual-confirmation-shared-across-languages','manual-correction-survives-reprocessing-raw-preserved','viewer-anonymous-direct-rpc-and-private-tables-denied','normalized-general-precise-search-proposals-not-availability','zero-provider-calls-and-no-production-access'])assert(r.passed.includes(name),name)
for(const name of ['specialty-fr','specialty-vi','confirmation-fr','confirmation-vi','correction-fr','correction-vi','search-pho-fr','search-pho-ga-fr','search-banh-can-vi']){
 assert(r.captures.includes(name+'.png'),name);assert(statSync(folder+'/'+name+'.png').size>1000,name)
}
assert.equal(r.providerCalls,0);assert.equal(r.productionModified,false)
console.log('ALL_DISH_AUTH_SCENARIOS_AND_MOBILE_CAPTURES_PASSED')
