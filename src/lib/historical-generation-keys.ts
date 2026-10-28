/** A committed corpus replacement retires previous report request IDs server-side.
 * Keep their client intents separate, without changing any server reservation. */
export function historicalGenerationKeys(establishmentId: string, language: string | null, reloadCompletedAt?: string) {
  const reportKey = `historical:${establishmentId}:${language}`
  const suffix = reloadCompletedAt ? `:reload:${reloadCompletedAt}` : ''
  return { reportKey, controllerKey: reportKey + suffix,
    storageKey: `historical-run-recent-text-100-6m-v1:${establishmentId}:${language}` + suffix }
}
