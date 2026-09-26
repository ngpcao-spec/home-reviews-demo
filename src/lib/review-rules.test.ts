import { describe, expect, it } from 'vitest'
import { canAddEstablishment, classifyByRating, deterministicReviewKey, normalizeCategory, previousPeriod, transitionReview } from './review-rules'

describe('classification des avis',()=>{
  it('force les avis 1★ et 2★ à traiter',()=>{expect(classifyByRating(1)).toEqual({requiresAction:true,status:'to_process',needsAnalysis:true});expect(classifyByRating(2,false).requiresAction).toBe(true)})
  it('attend l’IA pour un 3★ puis applique sa décision',()=>{expect(classifyByRating(3).status).toBe('new');expect(classifyByRating(3,true).status).toBe('to_process');expect(classifyByRating(3,false).status).toBe('ignored')})
  it('ignore le workflow d’action pour les avis positifs',()=>{expect(classifyByRating(5)).toEqual({requiresAction:false,status:'ignored',needsAnalysis:false})})
})

describe('transitions et entitlements',()=>{
  it('traite puis rouvre un avis',()=>{expect(transitionReview('to_process','process')).toBe('processed');expect(transitionReview('processed','reopen')).toBe('to_process')})
  it('respecte la limite d’établissements',()=>{expect(canAddEstablishment(4,5)).toBe(true);expect(canAddEstablishment(5,5)).toBe(false)})
})

describe('cohérence des données',()=>{
  it('déduplique avec ID externe ou hash stable',()=>{expect(deterministicReviewKey('e1','mock','r1')).toBe('e1:mock:r1');expect(deterministicReviewKey('e1','mock',undefined,['a','b'])).toBe(deterministicReviewKey('e1','mock',undefined,['a','b']))})
  it('calcule la période précédente de même longueur',()=>{const result=previousPeriod(new Date('2026-09-01'),new Date('2026-10-01'));expect(result.end.toISOString()).toContain('2026-09-01');expect(result.start.toISOString()).toContain('2026-08-02')})
  it('normalise les catégories fournisseur',()=>{expect(normalizeCategory('Food')).toBe('product_quality');expect(normalizeCategory('hygiene')).toBe('cleanliness');expect(normalizeCategory('inconnu')).toBe('other')})
})
