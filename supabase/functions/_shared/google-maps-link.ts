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

/** Apify rejects bare /maps?ftid= links. The second hex component is the CID.
 * BigInt is required: Google IDs exceed Number.MAX_SAFE_INTEGER.
 * Preserve /maps/place URLs (including their canonical name) unchanged.
 */
export function apifyGoogleMapsUrl(input: string): string {
  const normalized = normalizeGoogleMapsLink(input)
  if (!normalized) throw new Error('INVALID_GOOGLE_MAPS_LINK')
  const url = new URL(normalized)
  if (!/^\/maps\/?$/.test(url.pathname)) return normalized
  const ftid = url.searchParams.get('ftid')
  if (!ftid) return normalized
  const match = ftid.match(/^0x[0-9a-f]+:(0x[0-9a-f]+)$/i)
  if (!match) throw new Error('INVALID_GOOGLE_MAPS_LINK')
  const cid = BigInt(match[1]).toString(10)
  // Identifier wins over q/name and tracking parameters; never broaden to a name search.
  return `https://www.google.com/maps?cid=${cid}`
}
