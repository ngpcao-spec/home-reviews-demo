/** Extractive preview only. Full source remains available verbatim in the detail. */
export function summaryPreview(text: string) {
  const sentences = text.split(/(?<=[.!?])(?=\s)/u)
  // Only explicit methodological sentences are omitted, never rewritten.
  const business = sentences.filter(sentence => !/^\s*(?:l[’']analyse (?:est |repose |se base )|analyse basée |(?:cet |l[’'])échantillon |les mentions (?:ne sont|peuvent)|rapport généré |phân tích (?:này )?(?:dựa trên|được thực hiện trên)|mẫu (?:dữ liệu|phân tích) |các lượt đề cập |báo cáo được tạo )/iu.test(sentence)).join('').trim()
  if (!business) return ''
  if (business.length <= 450) return business
  const prefix = business.slice(0, 450)
  const sentenceEnd = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('! '), prefix.lastIndexOf('? '))
  const end = sentenceEnd >= 300 ? sentenceEnd + 1 : prefix.lastIndexOf(' ')
  return `${prefix.slice(0, end > 0 ? end : 450).trimEnd()}…`
}
