import { expect, test } from '@playwright/test'

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.clear())})

test('parcours accueil → avis → réponse → analyses',async({page})=>{
  await page.goto('/')
  await expect(page.getByText('avis nécessitent votre attention')).toBeVisible()
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
