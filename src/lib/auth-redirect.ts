export function getOAuthRedirectUrl(
  origin = window.location.origin,
  baseUrl = import.meta.env.BASE_URL,
) {
  return new URL(baseUrl, origin).toString()
}

export function getGoogleOAuthOptions(
  origin = window.location.origin,
  baseUrl = import.meta.env.BASE_URL,
) {
  return {
    redirectTo: getOAuthRedirectUrl(origin, baseUrl),
    queryParams: {
      prompt: 'select_account',
    },
  } as const
}
