import { expect, test } from '@playwright/test'

test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!sessionStorage.getItem('preserve-demo-state'))localStorage.clear()})})

test('parcours accueil → avis → réponse → analyses',async({page})=>{
  await page.goto('/')
  await expect(page.locator('.home-feature-grid')).toBeVisible()
  await expect(page.getByText('Bon retour sur HOME Reviews.')).toHaveCount(0)
  await expect(page.getByText(/avis nécessitent votre attention/)).toHaveCount(0)
  await page.getByRole('link',{name:'Avis'}).click()
  await expect(page.getByRole('tab',{name:/À traiter/})).toHaveAttribute('aria-selected','true')
  await page.locator('.review-row').first().click()
  await expect(page.getByText('Résumé IA')).toBeVisible()
  await expect(page.getByLabel('Réponse proposée')).toBeVisible()
  await page.getByRole('link',{name:'Avis'}).click()
  await page.getByRole('link',{name:'Analyses'}).click()
  await expect(page.getByText('Évolution de la note')).toBeVisible()
  await expect(page.locator('.bottom-nav')).toBeVisible()
  const box=await page.locator('body').boundingBox();expect(box?.width).toBeLessThanOrEqual(1280)
})

test('ajoute un établissement avec le fournisseur mock',async({page})=>{
  await page.goto('/etablissements/ajouter')
  await page.getByPlaceholder('Lien Google Maps').fill('https://maps.app.goo.gl/demo')
  await page.getByRole('button',{name:"Rechercher l’établissement"}).click()
  await expect(page.getByText('Confirmer l’établissement')).toBeVisible()
  await page.getByRole('button',{name:'Ajouter cet établissement'}).click()
  await expect(page.getByText(/Établissement ajouté/)).toBeVisible({timeout:5000})
  await expect(page.getByRole('button',{name:'Voir les avis'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Retour aux établissements'})).toBeVisible()
})

test('ne déborde pas horizontalement',async({page})=>{await page.goto('/');const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);expect(overflow).toBe(false)})

test('garde l’accueil lisible pendant le défilement',async({page})=>{
  await page.goto('/')
  const header=page.locator('.brand-header')
  const nav=page.locator('.bottom-nav')
  await expect(page.locator('.quick-actions')).toBeVisible()
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))
  await page.waitForFunction(()=>window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-2)
  await expect(header).toBeInViewport()
  const headerStyle=await header.evaluate((element)=>getComputedStyle(element).backgroundColor)
  expect(headerStyle).toBe('rgb(17, 17, 15)')
  const labelsFit=await nav.locator('.nav-item > span:last-child').evaluateAll((labels)=>labels.every((label)=>label.scrollWidth<=label.clientWidth))
  expect(labelsFit).toBe(true)
  const quickLabelsFit=await page.locator('.quick-action strong').evaluateAll((labels)=>labels.every((label)=>label.scrollWidth<=label.clientWidth))
  expect(quickLabelsFit).toBe(true)
  const bottomClearance=await page.evaluate(()=>{
    const rows=Array.from(document.querySelectorAll('.review-row'))
    const last=rows.at(-1)?.getBoundingClientRect()
    const navigation=document.querySelector('.bottom-nav')?.getBoundingClientRect()
    return last&&navigation ? navigation.top-last.bottom : 0
  })
  expect(bottomClearance).toBeGreaterThanOrEqual(0)
})

test('affiche le vrai prochain contrôle de l’établissement mis en avant',async({page})=>{
  await page.goto('/')
  await expect(page.locator('.featured-slide[aria-current="true"] .featured-establishment')).toBeVisible()
  await page.evaluate(()=>{
    const key='home-reviews-demo-v1'
    const stored=localStorage.getItem(key)
    if(!stored) throw new Error('État de démonstration absent')
    const state=JSON.parse(stored)
    state.establishments[0].nextSyncAt=new Date(Date.now()+72*60_000).toISOString()
    localStorage.setItem(key,JSON.stringify(state))
    sessionStorage.setItem('preserve-demo-state','1')
  })
  await page.reload()
  await expect(page.locator('.home-sync-card')).toContainText('Prochain contrôle')
  await expect(page.locator('.home-sync-card')).toContainText(/Dans environ 1 h 1[12] min/)
})

test('parcourt tous les établissements sans mélanger leurs données',async({page},testInfo)=>{
  await page.goto('/')
  await expect(page.locator('.featured-slide')).toHaveCount(4)
  const summary=await page.locator('.home-summary').textContent()
  await page.evaluate(()=>{
    const key='home-reviews-demo-v1'
    const state=JSON.parse(localStorage.getItem(key) as string)
    state.establishments[0].nextSyncAt=new Date(Date.now()+60*60_000).toISOString()
    state.establishments[1].nextSyncAt=new Date(Date.now()+120*60_000).toISOString()
    state.establishments[1].syncStatus='error'
    localStorage.setItem(key,JSON.stringify(state))
    sessionStorage.setItem('preserve-demo-state','1')
  })
  await page.reload()
  const viewport=page.locator('.featured-carousel-viewport')
  const current=()=>page.locator('.featured-slide[aria-current="true"]')
  const featureBoxes=()=>page.evaluate(()=>{
    const carousel=document.querySelector('.featured-carousel')!.getBoundingClientRect()
    const surveillance=document.querySelector('.home-sync-card')!.getBoundingClientRect()
    return {
      viewportWidth:window.innerWidth,
      carousel:{top:carousel.top,bottom:carousel.bottom,height:carousel.height},
      surveillance:{top:surveillance.top,bottom:surveillance.bottom,height:surveillance.height},
    }
  })
  await expect(current()).toContainText('Le Petit Hanoi')
  await expect(current().locator('.featured-position')).toHaveText('1 / 4')
  const initialBoxes=await featureBoxes()
  expect(Math.abs(initialBoxes.carousel.height-initialBoxes.surveillance.height)).toBeLessThanOrEqual(1)
  if(initialBoxes.viewportWidth>370){
    expect(Math.abs(initialBoxes.carousel.top-initialBoxes.surveillance.top)).toBeLessThanOrEqual(1)
    expect(Math.abs(initialBoxes.carousel.bottom-initialBoxes.surveillance.bottom)).toBeLessThanOrEqual(1)
  }

  if(testInfo.project.name==='desktop'){
    await page.getByRole('button',{name:'Établissement suivant'}).click()
  }else{
    await viewport.evaluate((element)=>element.scrollTo({left:element.clientWidth,behavior:'auto'}))
  }
  await expect(current()).toContainText('Saigon Bistro')
  await expect(current()).toContainText('4.5')
  await expect(current()).toContainText('(186 avis)')
  await expect(current()).toContainText('1 avis à traiter')
  await expect(current().locator('img')).toHaveAttribute('src',/saigon\.png/)
  await expect(current().locator('.featured-position')).toHaveText('2 / 4')
  await expect(page.locator('.home-sync-card')).toContainText('Erreur')
  await expect(page.locator('.home-sync-card')).toContainText(/Dans environ 2 h/)
  expect(await page.locator('.home-summary').textContent()).toBe(summary)
  const nextBoxes=await featureBoxes()
  expect(Math.abs(nextBoxes.carousel.height-initialBoxes.carousel.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(nextBoxes.surveillance.height-initialBoxes.surveillance.height)).toBeLessThanOrEqual(1)

  await viewport.evaluate((element)=>element.scrollTo({left:-element.clientWidth,behavior:'auto'}))
  await expect(current()).toContainText('Le Petit Hanoi')
  await viewport.evaluate((element)=>element.scrollTo({left:element.scrollWidth*2,behavior:'auto'}))
  await expect(current()).toContainText("L'Indochine")
  await expect(current().locator('.featured-position')).toHaveText('4 / 4')
  await viewport.evaluate((element)=>element.scrollTo({left:element.clientWidth,behavior:'auto'}))
  await expect(current()).toContainText('Saigon Bistro')

  const beforeSwipe=page.url()
  await viewport.evaluate((element)=>{
    const card=element.querySelector('.featured-slide[aria-current="true"] .featured-establishment') as HTMLButtonElement
    element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:250,clientY:150,pointerType:'touch'}))
    element.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:120,clientY:153,pointerType:'touch'}))
    element.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:120,clientY:153,pointerType:'touch'}))
    card.click()
  })
  expect(page.url()).toBe(beforeSwipe)
  await page.waitForTimeout(20)
  await current().locator('.featured-establishment').click()
  await expect(page).toHaveURL(/\/etablissements\/est-2$/)
})

test('gère une carte unique, une photo absente et l’état vide',async({page})=>{
  await page.goto('/')
  await page.evaluate(()=>{
    const key='home-reviews-demo-v1'
    const state=JSON.parse(localStorage.getItem(key) as string)
    state.establishments=state.establishments.slice(0,1)
    state.establishments[0].name='Établissement avec un nom volontairement très long pour le mobile'
    delete state.establishments[0].photoUrl
    localStorage.setItem(key,JSON.stringify(state))
    sessionStorage.setItem('preserve-demo-state','1')
  })
  await page.reload()
  await expect(page.locator('.featured-slide')).toHaveCount(1)
  await expect(page.locator('.featured-position')).toHaveCount(0)
  await expect(page.locator('.featured-carousel-control')).toHaveCount(0)
  await expect(page.locator('.featured-photo-placeholder')).toBeVisible()
  await expect(page.locator('.featured-slide[aria-current="true"] .featured-copy > strong')).toHaveText('Établissement avec un nom volontairement très long pour le mobile')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false)

  await page.evaluate(()=>{
    const key='home-reviews-demo-v1'
    const state=JSON.parse(localStorage.getItem(key) as string)
    state.establishments=[]
    localStorage.setItem(key,JSON.stringify(state))
  })
  await page.reload()
  await expect(page.getByText('Ajoutez votre premier établissement')).toBeVisible()
  await expect(page.locator('.featured-carousel')).toHaveCount(0)
})
