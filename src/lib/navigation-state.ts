const ROUTE_KEY = 'home-reviews:last-route'
const UI_PREFIX = 'home-reviews:ui:'
export function restorableRoute(route: string) {
  if (!route.startsWith('/') || route.startsWith('//')) return false
  const [pathname, query = ''] = route.split('?')
  if (!/^(\/|\/etablissements(?:\/[\w-]+)?|\/avis(?:\/[\w-]+)?|\/analyses|\/notifications|\/plus(?:\/(?:jev-benchmark|gold-set|gold-check|representative-test))?)$/.test(pathname)
    || pathname === '/etablissements/ajouter') return false
  return !/(?:access_token|refresh_token|token|code|type)=/i.test(query)
}
export function savedRoute(userId: string) {
  try {
    const value = JSON.parse(localStorage.getItem(ROUTE_KEY) ?? 'null')
    return value?.userId === userId && typeof value.route === 'string' && restorableRoute(value.route) ? value.route as string : null
  } catch { return null }
}
export function saveRoute(userId: string, route: string) {
  if (!restorableRoute(route)) return
  try { localStorage.setItem(ROUTE_KEY, JSON.stringify({ userId, route })) } catch { /* optional storage */ }
}
export function readUiState<T>(userId: string, key: string): T | undefined {
  try { return JSON.parse(localStorage.getItem(`${UI_PREFIX}${userId}:${key}`) ?? 'null') ?? undefined } catch { return undefined }
}
export function saveUiState(userId: string, key: string, value: unknown) {
  try { localStorage.setItem(`${UI_PREFIX}${userId}:${key}`, JSON.stringify(value)) } catch { /* optional storage */ }
}
export function clearNavigationState(userId: string) {
  try {
    if (savedRoute(userId)) localStorage.removeItem(ROUTE_KEY)
    Object.keys(localStorage).filter(key => key.startsWith(`${UI_PREFIX}${userId}:`)).forEach(key => localStorage.removeItem(key))
  } catch { /* optional storage */ }
}
