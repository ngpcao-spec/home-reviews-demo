export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60_000))
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  return `il y a ${days} j`
}

export function fullDate(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso))
}

export function timeUntil(iso: string, now = Date.now()) {
  const diffMinutes = Math.ceil((new Date(iso).getTime() - now) / 60_000)
  if (!Number.isFinite(diffMinutes) || diffMinutes <= 0) return 'Éligible au prochain contrôle'
  if (diffMinutes < 60) return `Dans environ ${diffMinutes} min`
  const hours = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60
  return `Dans environ ${hours} h${minutes ? ` ${minutes} min` : ''}`
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { notation: value > 999 ? 'compact' : 'standard' }).format(value)
}
