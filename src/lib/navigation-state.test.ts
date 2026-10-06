import { beforeEach, describe, expect, it } from 'vitest'
import { clearNavigationState, readUiState, restorableRoute, savedRoute, saveRoute, saveUiState } from './navigation-state'
beforeEach(()=>localStorage.clear())
describe('persisted navigation',()=>{
  it('restores the human annotation route per account after a cold PWA restart, without permitting auth URLs',()=>{
    saveRoute('human','/plus/gold-set?id=99999999-9999-4999-8999-999999999999')
    expect(savedRoute('human')).toBe('/plus/gold-set?id=99999999-9999-4999-8999-999999999999');expect(savedRoute('other')).toBeNull()
    expect(restorableRoute('/plus/gold-set?access_token=secret')).toBe(false)
  })
  it.each(['/connexion','/test/notifications/reset','/etablissements/ajouter','//other.test','/avis?access_token=secret','/?type=recovery'])('never restores %s',route=>{
    expect(restorableRoute(route)).toBe(false)
  })
  it('isolates account routes and clears scroll/selection on sign-out',()=>{
    saveRoute('a','/analyses?establishment=artisan&mode=historical')
    saveUiState('a','analytics-scroll:artisan',1234)
    expect(savedRoute('a')).toContain('artisan')
    expect(savedRoute('b')).toBeNull()
    clearNavigationState('a')
    expect(savedRoute('a')).toBeNull()
    expect(readUiState('a','analytics-scroll:artisan')).toBeUndefined()
  })
})
