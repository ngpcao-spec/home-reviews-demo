export function formatNaturalList(items: string[], language: 'fr' | 'vi'): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')}${language === 'fr' ? ' et ' : ' và '}${items.at(-1)}`
}
