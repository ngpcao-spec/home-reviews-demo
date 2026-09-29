function currentLanguage() { return typeof document !== 'undefined' && document.documentElement.lang === 'vi' ? 'vi' : 'fr' }

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60_000))
  const language = currentLanguage()
  if (minutes < 60) return language === 'vi' ? `${minutes} phút trước` : `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return language === 'vi' ? `${hours} giờ trước` : `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  return language === 'vi' ? `${days} ngày trước` : `il y a ${days} j`
}

export function fullDate(iso: string) {
  return new Intl.DateTimeFormat(currentLanguage() === 'vi' ? 'vi-VN' : 'fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso))
}

export function timeUntil(iso: string, now = Date.now()) {
  const diffMinutes = Math.ceil((new Date(iso).getTime() - now) / 60_000)
  const language = currentLanguage()
  if (!Number.isFinite(diffMinutes) || diffMinutes <= 0) return language === 'vi' ? 'Sẵn sàng kiểm tra' : 'Éligible au prochain contrôle'
  if (diffMinutes < 60) return language === 'vi' ? `Khoảng ${diffMinutes} phút nữa` : `Dans environ ${diffMinutes} min`
  const hours = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60
  return language === 'vi' ? `Khoảng ${hours} giờ${minutes ? ` ${minutes} phút` : ''} nữa` : `Dans environ ${hours} h${minutes ? ` ${minutes} min` : ''}`
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat(currentLanguage() === 'vi' ? 'vi-VN' : 'fr-FR', { notation: value > 999 ? 'compact' : 'standard' }).format(value)
}
