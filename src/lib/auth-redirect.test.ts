import { describe, expect, it } from 'vitest'
import { getOAuthRedirectUrl } from './auth-redirect'

describe('getOAuthRedirectUrl', () => {
  it('uses the deployed GitHub Pages base path', () => {
    expect(getOAuthRedirectUrl('https://ngpcao-spec.github.io', '/home-reviews-demo/'))
      .toBe('https://ngpcao-spec.github.io/home-reviews-demo/')
  })

  it('uses localhost only for development', () => {
    expect(getOAuthRedirectUrl('http://localhost:5173', '/'))
      .toBe('http://localhost:5173/')
  })
})
