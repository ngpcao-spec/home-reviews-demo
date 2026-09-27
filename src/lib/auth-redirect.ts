export function getOAuthRedirectUrl(
  origin = window.location.origin,
  baseUrl = import.meta.env.BASE_URL,
) {
  return new URL(baseUrl, origin).toString()
}
