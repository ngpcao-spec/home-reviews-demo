import { expect, test } from '@playwright/test'

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.clear())})

test('parcours établissement → avis → réponse → traitement',async({page})=>{
  await page.goto('/connexion')
  await page.getByRole('button',{name:'Se connecter'}).click()
  await expect(page.getByText('avis nécessitent votre attention')).toBeVisible()
  await page.getByRole('link',{name:'Avis'}).click()
  await expect(page.getByRole('tab',{name:/À traiter/})).toHaveAttribute('aria-selected','true')
  await page.locator('.review-row').first().click()
  await expect(page.getByText('Résumé IA')).toBeVisible()
  await page.getByRole('button',{name:'Générer une réponse'}).click()
  await expect(page.getByLabel('Réponse suggérée')).toBeVisible()
  await page.getByRole('button',{name:'Marquer traité'}).click()
  await page.getByRole('link',{name:'Avis'}).click()
  await page.getByRole('tab',{name:/Traités/}).click()
  await expect(page.getByText('Avis marqués comme traités')).toHaveCount(0)
  await page.getByRole('link',{name:'Analyses'}).click()
  await expect(page.getByText('Évolution de la note moyenne')).toBeVisible()
  await expect(page.locator('.bottom-nav')).toBeVisible()
  const box=await page.locator('body').boundingBox();expect(box?.width).toBeLessThanOrEqual(1280)
})

test('ajoute un établissement avec le fournisseur mock',async({page})=>{
  await page.goto('/etablissements/ajouter')
  await page.getByPlaceholder('Nom, ville ou lien Google Maps').fill('Petit Hanoi')
  await page.getByRole('button',{name:'Rechercher'}).click()
  await page.getByRole('button',{name:/Le Petit Hanoi/}).click()
  await page.getByText('Je confirme gérer').click()
  await page.getByRole('button',{name:'Activer la surveillance'}).click()
  await expect(page.getByText('Tout est prêt')).toBeVisible({timeout:5000})
})

test('ne déborde pas horizontalement',async({page})=>{await page.goto('/');const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);expect(overflow).toBe(false)})
