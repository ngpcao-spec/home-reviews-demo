import { beforeEach, describe, expect, it } from 'vitest'
import { clearNavigationState, readUiState, restorableRoute, savedRoute, saveRoute, saveUiState } from './navigation-state'
beforeEach(()=>localStorage.clear())
describe('persisted navigation',()=>{
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
