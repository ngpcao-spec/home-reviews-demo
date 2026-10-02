// Remove only a redundant heading, never the subject of a complete sentence.
export function axisSummaryText(summary: string, title: string): string {
  const text = summary.trim()
  if (text.slice(0, title.length).toLocaleLowerCase() !== title.toLocaleLowerCase()) return text
  const remainder = text.slice(title.length)
  return /^\s*[:：–—-]\s*\S/u.test(remainder)
    ? remainder.replace(/^\s*[:：–—-]\s*/u, '')
    : text
}
