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
  await expect(page.locator('.featured-establishment')).toBeVisible()
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
