// Narrow textual support for disclosure review, never arithmetic or legal proof.
export const JLS_DISCLOSURE_VALIDATOR = "jls-prioritized-disclosure-v1.1";
export const JLS_LEGACY_VALIDATOR = "jls-prioritized-disclosure-v1";
export function legacyFeeDisclosure(quote: string) {
  return /\b(?:fee|charge|vat|tax|surcharge|bill)\b/i.test(quote) &&
    /\b(?:not (?:announced|mentioned|disclosed)|no (?:mention|notice)|hidden|without (?:notice|warning)|didn.t (?:see|know)|unannounced)/i.test(quote);
}
export function explicitFeeDisclosureComplaint(quote: string) {
  const s = quote.replace(/[’‘ʼ]/g, "'").toLowerCase();
  const fees = /\b(?:fees?|charges?|vat|tax(?:es)?|surcharges?|bill)\b/;
  if (!fees.test(s)) return false;
  // Questions, speculation and denied accusations are not explicit complaints.
  if (/\?|\b(?:if|maybe|perhaps|might|would|could|hypothetically|suppose|not sure|unsure|unclear|can't say|cannot say|don't know whether|do not know whether)\b/.test(s)) return false;
  if (/\b(?:not unannounced|not hidden|not without notice|not true|never said)\b/.test(s)) return false;
  // An explicit disclosure before ordering contradicts a proposed missing notice.
  if (/\b(?:clearly|explicitly) (?:announced|disclosed|stated|shown)|\b(?:explained|announced|disclosed|shown|informed|told).{0,60}\b(?:before (?:we |i )?(?:ordered|ordering)|in advance)\b/.test(s)) return false;
  const clauses = s.split(/[.!;\n]+/).map(x => x.trim()).filter(Boolean);
  return clauses.some((c, i) => {
    const direct = /\b(?:not (?:announced|mentioned|disclosed)|(?:wasn't|weren't|was not|were not) (?:announced|mentioned|disclosed)|no (?:mention|notice|announcement)|without (?:notice|warning)|unannounced|hidden (?:fee|charge|surcharge))/;
    if (fees.test(c) && direct.test(c)) return true;
    const unseen = /\b(?:i|we)\s+(?:(?:have|had|did) not|haven't|hadn't|didn't)\s+(?:see|seen|notice|noticed|find|found)\s+(?:any\s+|a\s+|the\s+)?(?:note|notice|announcement|information|mention|warning|sign)\b/;
    const match = unseen.exec(c);
    if (!match) return false;
    const tail = c.slice(match.index + match[0].length);
    if (fees.test(tail)) return true;
    // A note about an unrelated subject cannot become a fee complaint.
    if (/\babout\b/.test(tail) && !/\babout (?:that|this|these|those)\b/.test(tail)) return false;
    if (fees.test(c)) return true;
    // Resolve only an explicit nearby anaphor referring back to a fee clause.
    return /\babout (?:that|this|these|those)\b/.test(c) && i > 0 &&
      clauses[i - 1].length <= 220 && fees.test(clauses[i - 1]);
  });
}
