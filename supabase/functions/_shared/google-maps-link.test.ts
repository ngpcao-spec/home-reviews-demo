import { describe, expect, it } from 'vitest'
import { apifyGoogleMapsUrl, normalizeGoogleMapsLink } from './google-maps-link'

describe('Google Maps iOS sharing links', () => {
  it.each(['https://maps.google.com','https://www.google.com/maps'])('converts ftid precisely from %s', base => {
    const result = new URL(apifyGoogleMapsUrl(`${base}?ftid=0x317067a3002ce2c1:0x49158083af30d8d5&q=Other+name&g_st=ipc`))
    expect(result.searchParams.get('cid')).toBe(BigInt('0x49158083af30d8d5').toString())
    expect([...result.searchParams.keys()]).toEqual(['cid'])
  })
  it('does not round 64-bit identifiers or rewrite canonical place URLs', () => {
    expect(apifyGoogleMapsUrl('https://www.google.com/maps?ftid=0x1:0xffffffffffffffff')).toBe('https://www.google.com/maps?cid=18446744073709551615')
    const place='https://www.google.com/maps/place/Mai+Huong/data=!4m2!3m1!1s0x1:0x2'
    expect(apifyGoogleMapsUrl(place)).toBe(place)
    const cid='https://www.google.com/maps?cid=18446744073709551615'
    expect(apifyGoogleMapsUrl(cid)).toBe(cid)
  })
  it('rejects malformed ftid instead of falling back to a name search', () => {
    expect(()=>apifyGoogleMapsUrl('https://www.google.com/maps?ftid=broken&q=Restaurant')).toThrow('INVALID_GOOGLE_MAPS_LINK')
  })
  it.each([
    'https://maps.app.goo.gl/6La6uPKKozVswAJ4A?g_st=ic',
    'https://maps.app.goo.gl/cxbMu5sF4YozN1Pd7?g_st=ipc',
    'https://www.google.com/maps/place/Mai+Hương+Restaurant/',
  ])('accepts %s without a network request', link => {
    expect(normalizeGoogleMapsLink(link)).toBe(new URL(link).href)
  })
  it.each(['', '&q=Mai+H%C6%B0%C6%A1ng+Restaurant'])('normalizes native iOS sharing, retaining the same ftid (%s)', suffix => {
    const ftid = '0x317067a3002ce2c1:0x49158083af30d8d5'
    const result = new URL(normalizeGoogleMapsLink(`https://maps.google.com?ftid=${ftid}${suffix}&g_st=ipc`)!)
    expect(result.origin + result.pathname).toBe('https://www.google.com/maps')
    expect(result.searchParams.get('ftid')).toBe(ftid)
    expect(result.searchParams.get('g_st')).toBe('ipc')
  })
  it.each([
    'http://maps.google.com?q=test',
    'https://maps.google.com.evil.example/?q=test',
    'https://google.com/redirect?next=/maps',
    'https://evil.example/maps',
    'https://user:password@maps.google.com?q=test',
    'https://maps.google.com:8443?q=test',
    'https://maps.google.com',
    'invalid',
  ])('rejects unrelated or unsafe URLs: %s', link => {
    expect(normalizeGoogleMapsLink(link)).toBeNull()
  })
})
