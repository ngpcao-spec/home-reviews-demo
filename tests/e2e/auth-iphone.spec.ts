import {test,expect} from '@playwright/test'
test('installed iPhone context starts client-only OAuth and accepts the returned session with no shared verifier',async({page})=>{
  const real:string[]=[];page.on('request',r=>{if(/ihuztjkblywzjdruusdj|accounts\.google\.com|api\.openai|api\.typesafe/.test(r.url()))real.push(r.url())})
  await page.route('https://auth-fixture.supabase.co/**',async route=>{
    expect(route.request().url()).toContain('/auth/v1/user')
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'fixture@example.test',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'})})
  })
  await page.goto('/tests/e2e/fixtures/auth-iphone.html');await expect(page.getByText('Flow: implicit',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Start mock Google'}).click();await expect(page.getByText('No local PKCE verifier required')).toBeVisible()
  await page.evaluate(()=>localStorage.clear())
  // OAuth comes back from another origin as a new document, not a hash-only SPA navigation.
  await page.goto('about:blank')
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({sub:'11111111-1111-4111-8111-111111111111',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),role:'authenticated'})).toString('base64url')
  await page.goto('/tests/e2e/fixtures/auth-iphone.html#access_token='+header+'.'+payload+'.fixture_signature&refresh_token=fixture_refresh&expires_in=3600&token_type=bearer')
  await expect(page.getByRole('heading',{name:'Session connected'})).toBeVisible();await expect(page.getByText('Route: /',{exact:true})).toBeVisible();expect(page.url()).not.toMatch(/access_token|refresh_token/)
  await page.reload();await expect(page.getByRole('heading',{name:'Session connected'})).toBeVisible();expect(real).toEqual([])
})
test('old PKCE callback without its verifier gives safe recovery instead of an invisible login loop',async({page})=>{
  await page.goto('/tests/e2e/fixtures/auth-iphone.html?code=fixture_old_code')
  await expect(page.getByRole('alert')).toContainText('recommencer ici');expect(page.url()).not.toContain('code=');await page.getByRole('button',{name:'Start mock Google'}).click();await expect(page.getByText('No local PKCE verifier required')).toBeVisible()
})
