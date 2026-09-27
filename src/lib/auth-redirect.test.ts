import { describe, expect, it } from 'vitest'
import { getGoogleOAuthOptions, getOAuthRedirectUrl } from './auth-redirect'

describe('OAuth Google', () => {
  it('uses the deployed GitHub Pages base path', () => {
    expect(getOAuthRedirectUrl('https://ngpcao-spec.github.io', '/home-reviews-demo/'))
      .toBe('https://ngpcao-spec.github.io/home-reviews-demo/')
  })

  it('uses localhost only for development', () => {
    expect(getOAuthRedirectUrl('http://localhost:5173', '/'))
      .toBe('http://localhost:5173/')
  })

  it('asks Google to show the account selector for a manual OAuth start', () => {
    expect(getGoogleOAuthOptions('https://ngpcao-spec.github.io', '/home-reviews-demo/')).toEqual({
      redirectTo: 'https://ngpcao-spec.github.io/home-reviews-demo/',
      queryParams: { prompt: 'select_account' },
    })
  })
})
