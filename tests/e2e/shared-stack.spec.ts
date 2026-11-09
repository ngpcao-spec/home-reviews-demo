import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
test('two real Supabase Auth sessions reach the actual application independently',async({browser})=>{
 const fixture=JSON.parse(readFileSync(process.env.CI_AUTH_FIXTURE!,'utf8'))
 const contexts=await Promise.all([0,1].map(()=>browser.newContext()))
 try{
  for(let i=0;i<2;i++){
   const page=await contexts[i].newPage()
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort('blockedbyclient')
    return route.continue()
   })
   await page.goto('http://127.0.0.1:4173')
   const identity=await page.evaluate(async({email,password})=>{
    // Vite serves the real client; GoTrue signs and validates the actual session.
    const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts')
    const result=await supabase.auth.signInWithPassword({email,password})
    if(result.error)throw Error(result.error.message)
    return (await supabase.auth.getUser()).data.user.id
   },fixture.users[i])
   expect(identity).toBe(fixture.users[i].id)
   await page.goto('http://127.0.0.1:4173/')
   await expect(page.getByRole('link',{name:'Établissements',exact:true})).toBeVisible()
   const memberships=await page.evaluate(async()=>{
    const {supabase}=await import(/* @vite-ignore */'/src/lib/supabase.ts')
    const {data,error}=await supabase.from('organization_members').select('organization_id')
    if(error)throw Error(error.message)
    return data.map(row=>row.organization_id)
   })
   expect(memberships).toEqual([fixture.users[i].organizationId])
   await page.reload()
   await expect(page.getByRole('link',{name:'Établissements',exact:true})).toBeVisible()
  }
 }finally{await Promise.all(contexts.map(c=>c.close()))}
})
