/** Normalize the two iOS sharing formats without changing the place identifier. */
export function normalizeGoogleMapsLink(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase()
    if (host === 'maps.app.goo.gl' && url.pathname.length > 1) return url.href
    if (host === 'maps.google.com' && url.pathname === '/') {
      if (!['q', 'cid', 'ftid', 'query', 'query_place_id'].some(key => url.searchParams.get(key)?.trim())) return null
      url.hostname = 'www.google.com'
      url.pathname = '/maps'
      return url.href
    }
    if ((host === 'google.com' || host === 'www.google.com' || host === 'maps.google.com')
      && /^\/maps(?:\/|$)/.test(url.pathname)) return url.href
    return null
  } catch {
    return null
  }
}
