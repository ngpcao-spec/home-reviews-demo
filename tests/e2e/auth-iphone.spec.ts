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
  await page.goto('/tests/e2e/fixtures/auth-iphone.html#access_token='+header+'.'+payload+'.fixture_signature&refresh_token=fixture_refresh&expires_in=3600&token_type=bearer&sb=')
  await expect(page.getByRole('heading',{name:'Session connected'})).toBeVisible();await expect(page.getByText('Route: /',{exact:true})).toBeVisible();expect(page.url()).not.toMatch(/access_token|refresh_token/)
  await page.reload();await expect(page.getByRole('heading',{name:'Session connected'})).toBeVisible()
  // An already signed-in user reopening an old broken callback needs no new login.
  await page.goto('about:blank');await page.goto('/tests/e2e/fixtures/auth-iphone.html#sb=')
  await expect(page.getByRole('heading',{name:'Session connected'})).toBeVisible();await expect(page.getByText('Route: /',{exact:true})).toBeVisible()
  expect(page.url()).not.toContain('#sb=');expect(real).toEqual([])
})
test('old PKCE callback without its verifier gives safe recovery instead of an invisible login loop',async({page})=>{
  await page.goto('/tests/e2e/fixtures/auth-iphone.html?code=fixture_old_code')
  await expect(page.getByRole('alert')).toContainText('recommencer ici');expect(page.url()).not.toContain('code=');await page.getByRole('button',{name:'Start mock Google'}).click();await expect(page.getByText('No local PKCE verifier required')).toBeVisible()
})

for(const language of ['vi','fr'] as const)test(`new ${language} account reaches the actual home screen after language selection`,async({page},testInfo)=>{
  let preferredLanguage:string|null=null
  const unexpected:string[]=[]
  await page.route(/https:\/\/.*/,async route=>{
    const url=new URL(route.request().url()),path=url.pathname
    if(url.origin!=='https://auth-fixture.supabase.co'){unexpected.push(url.origin+path);return route.abort()}
    let data:unknown=[]
    if(path==='/auth/v1/user')data={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'fixture@example.test',app_metadata:{},user_metadata:{},created_at:'2026-11-15T09:58:02Z'}
    else if(path==='/rest/v1/profiles'){
      if(route.request().method()==='PATCH')preferredLanguage=route.request().postDataJSON().preferred_language
      data=[{preferred_language:preferredLanguage}]
    }else if(path==='/rest/v1/organizations')data=[{id:'22222222-2222-4222-8222-222222222222',monitoring_interval_hours:12}]
    else if(path==='/rest/v1/notification_preferences')data=[{notification_onboarding_seen:true,notification_permission_status:'denied'}]
    else if(!['/rest/v1/establishments','/rest/v1/reviews','/rest/v1/notifications','/rest/v1/initial_import_jobs'].includes(path)){unexpected.push(path);return route.abort()}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
  })
  await page.routeWebSocket(/wss:\/\/.*/,socket=>socket.close())
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
  const payload=Buffer.from(JSON.stringify({sub:'11111111-1111-4111-8111-111111111111',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),role:'authenticated'})).toString('base64url')
  await page.goto('/tests/e2e/fixtures/auth-app.html#access_token='+header+'.'+payload+'.fixture_signature&refresh_token=fixture_refresh&expires_in=3600&token_type=bearer&sb=')
  await page.getByRole('button',{name:language==='vi'?'Tiếng Việt':'Français',exact:true}).click()
  await expect(page.getByRole('heading',{name:'HOME Reviews',exact:true})).toBeVisible()
  await expect(page.getByText('Cette page n’existe pas')).toHaveCount(0)
  expect(preferredLanguage).toBe(language)
  expect(new URL(page.url()).hash).toMatch(/^(#\/)?$/)
  await page.screenshot({path:testInfo.outputPath(`new-account-${language}.png`),fullPage:true})
  await page.reload()
  await expect(page.getByRole('heading',{name:'HOME Reviews',exact:true})).toBeVisible()
  await expect(page.getByText('Cette page n’existe pas')).toHaveCount(0)
  expect(unexpected).toEqual([])
})

for (const existing of [true, false]) test(`${existing ? 'existing' : 'new'} restaurant account uses the expected onboarding path`, async ({ page }) => {
  let hasOrganization = existing
  let provisioningCalls = 0
  let signOutCalls = 0
  let authorizationCalls = 0
  const unexpected: string[] = []
  const id = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'
  const user = {
    id, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test',
    app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.'
    + encode({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' }) + '.fixture'
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
  await page.route(/https:\/\/.*/, async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const reply = (json: unknown) => route.fulfill({
      status: 200, json, headers: { 'access-control-allow-origin': '*' },
    })
    if (url.origin !== 'https://auth-fixture.supabase.co') {
      unexpected.push(url.origin + path)
      return route.abort()
    }
    if (path === '/auth/v1/authorize') {
      authorizationCalls += 1
      expect(url.searchParams.get('provider')).toBe('google')
      const callback = new URL(url.searchParams.get('redirect_to')!)
      expect(callback.origin).toBe('http://127.0.0.1:4174')
      callback.hash = new URLSearchParams({ access_token: token, refresh_token: 'fixture-refresh',
        expires_in: '3600', token_type: 'bearer', sb: '' }).toString()
      return route.fulfill({
        contentType: 'text/html', body: '<script>location.replace(' + JSON.stringify(callback.href) + ')</script>',
      })
    }
    if (path === '/auth/v1/user') return reply(user)
    if (path === '/auth/v1/logout') {
      signOutCalls += 1
      expect(url.searchParams.get('scope')).toBe('local')
      return reply({})
    }
    if (path === '/rest/v1/rpc/ensure_home_user') {
      expect(request.method()).toBe('POST')
      expect(request.postDataJSON()).toEqual({})
      expect(request.headers().authorization).toBe('Bearer ' + token)
      provisioningCalls += 1
      hasOrganization = true
      return reply(organizationId)
    }
    if (path === '/rest/v1/organizations') {
      return reply(hasOrganization ? [{ id: organizationId, monitoring_interval_hours: 12 }] : [])
    }
    if (path === '/rest/v1/organization_members') return reply(hasOrganization ? [{ organization_id: organizationId, user_id: id, role: 'owner' }] : [])
    if (path === '/rest/v1/profiles') return reply(hasOrganization ? [{ preferred_language: 'fr' }] : [])
    if (path === '/rest/v1/notification_preferences') {
      return reply([{ notification_onboarding_seen: true, notification_permission_status: 'denied' }])
    }
    if (['establishments', 'reviews', 'notifications', 'initial_import_jobs'].some(name => path === '/rest/v1/' + name)) {
      return reply([])
    }
    unexpected.push(path)
    return route.abort()
  })
  await page.routeWebSocket(/wss:\/\/.*/, socket => socket.close())

  const connect = () => page.getByRole('button', { name: /Continuer avec Google/ })
  const home = () => page.getByRole('heading', { name: 'HOME Reviews', exact: true })
  await page.goto('/')
  await connect().click()
  await expect(home()).toBeVisible()
  expect(provisioningCalls).toBe(existing ? 0 : 1)
  await page.reload()
  await expect(home()).toBeVisible()
  expect(provisioningCalls).toBe(existing ? 0 : 1)

  await page.locator('a[href="#/plus"]').click()
  await page.getByRole('button', { name: /Se déconnecter/ }).click()
  await expect(connect()).toBeVisible()
  expect(signOutCalls).toBe(1)
  await connect().click()
  await expect(home()).toBeVisible()
  expect(authorizationCalls).toBe(2)
  expect(provisioningCalls).toBe(existing ? 0 : 1)
  expect(unexpected).toEqual([])
})
