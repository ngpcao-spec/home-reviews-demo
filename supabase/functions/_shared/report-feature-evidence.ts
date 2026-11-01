/** Conservative interpretation of saved report clauses, never of the user's free text.
 * Unknowns and negated complaints are not evidence for the opposite property.
 * This is a bounded FR/VI/EN grammar, not a general natural-language parser. */
export type FeatureScope = {days: number[] | null; start: number | null; start_exclusive: boolean; end: number | null; unresolved: boolean};
export type FeatureSignal = {polarity: 'positive' | 'negative' | 'unknown'; scope: FeatureScope; applies: boolean | null};
export type FeatureVisit = {instant?: string; timezone?: string | null};
export const REPORT_FEATURE_PHRASES: Record<string, string[]> = {
  quiet: ['quiet', 'calm atmosphere', 'calme', 'yen tinh'],
  fast_service: ['fast service', 'quick service', 'service rapide', 'phuc vu nhanh', 'nhanh nhen'],
  sea_view: ['sea view', 'ocean view', 'vue sur la mer', 'vue mer', 'canh bien', 'view bien'],
  air_conditioning: ['air conditioning', 'air conditioned', 'climatisation', 'climatise', 'may lanh', 'dieu hoa'],
  private_room: ['private room', 'salle privee', 'phong rieng'],
};
const contrary: Record<string, string[]> = {
  quiet: ['noisy', 'noise', 'loud music', 'bruyant', 'bruyante', 'bruit', 'musique forte', 'musique est forte', 'tieng on', 'on ao', 'nhac to', 'nhac on'],
  fast_service: ['slow service', 'long wait', 'service lent', 'attente longue', 'cho mon lau', 'cho lau', 'phuc vu cham'],
};
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd')
  .replace(/week-ends?/g, 'weekend').replace(/[_-]/g, ' ').replace(/[’']/g, ' ').replace(/\bkhong (gian|khi)\b/g, '$1').replace(/[ \t\r]+/g, ' ').trim();
const words = (phrase: string) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unknown = /\b(?:inconnu\w*|non (?:documente|confirme|renseigne)\w*|pas (?:documente|confirme|renseigne)\w*|(?:ne |n )(?:confirme|documente|dit|mentionne|decrit|signale|rapporte)(?: \w+){0,3} pas|(?:aucun\w*|pas de|sans) (?:preuve|information|donnee)|no (?:evidence|information|data)|chua (?:ro|biet|duoc (?:ghi nhan|xac nhan)|ghi nhan|co (?:du lieu|thong tin))|khong (?:xac nhan|co (?:du lieu|thong tin))|unknown|undocumented|not (?:known|documented|confirmed)|pas forcement|pas toujours|not necessarily|not always|khong nhat thiet|khong phai luc nao|khong luon)\b/;
const wish = /\b(?:souhaite\w*|aimerait|voudrait|wish\w*|would prefer|mong|muon|uoc)\b/;
const negationBefore = /\b(?:pas(?: de)?|non|not|never|jamais|sans|aucun\w*|no|without|khong(?: co| phai)?|chua|thieu|manque de|absence (?:de|du))\s+(?:(?:un|une|de|du|le|la|salle|endroit|lieu|ambiance|atmosphere|restaurant|gian|noi|room|place|du tout|vraiment|tres|really|particularly)\s+){0,4}$/;
const negationAfter = /^\s+(?:(?:n est|est|is|was)\s+)?(?:pas|non|not|khong|chua|absent\w*)\b/;
const complaintDenial = /\b(?:aucun\w*|pas de|sans|no|without|khong co|absence de)\s+(?:(?:plainte\w*|signalement\w*|critique\w*|probleme\w*|problem\w*|complaint\w*|report\w*|phan anh|phan nan)\b)/;
const reportDenialAfter = /^\s+(?:(?:n est|est|is|was)\s+)?(?:pas |not |non )?(?:signale|rapporte|reported|documente)\w*\b/;
const dayNames = [
  /\b(?:dimanches?|sundays?|chu nhat)\b/, /\b(?:lundis?|mondays?|thu hai|thu 2)\b/,
  /\b(?:mardis?|tuesdays?|thu ba|thu 3)\b/, /\b(?:mercredis?|wednesdays?|thu tu|thu 4)\b/,
  /\b(?:jeudis?|thursdays?|thu nam|thu 5)\b/, /\b(?:vendredis?|fridays?|thu sau|thu 6)\b/,
  /\b(?:samedis?|saturdays?|thu bay|thu 7)\b/,
];
export const limitedScope = (s: FeatureScope) => s.days !== null || s.start !== null || s.end !== null || s.unresolved;
function daysFor(text: string): number[] | null {
  if (/\b(?:en semaine|ngay thuong|weekdays)\b/.test(text)) return [1, 2, 3, 4, 5];
  if (/\b(?:weekend|weekends|cuoi tuan)\b/.test(text)) return [0, 6];
  const named = dayNames.flatMap((pattern, day) => pattern.test(text) ? [day] : []);
  return named.length ? named : null;
}
function scopeFor(clause: string): FeatureScope {
  const exception = /\b(?:sauf|except|ngoai tru)\b/.exec(clause);
  let days = daysFor(exception ? clause.slice(0, exception.index) : clause);
  const excludedDays = exception ? daysFor(clause.slice(exception.index + exception[0].length)) : null;
  if (excludedDays) days = (days ?? [0, 1, 2, 3, 4, 5, 6]).filter(day => !excludedDays.includes(day));
  const clock = '(\\d{1,2})(?:\\s*[:h]\\s*(\\d{2}))?\\s*(?:h|heures?|gio)?';
  // Accent normalization merges Vietnamese sáu (Friday) and sau (after).
  // Keep the weekday for daysFor, but do not read its name as a clock qualifier.
  const clockClause=clause.replace(/\bthu sau\b/g,'thu 6');
  const before = new RegExp('\\b(?:avant|truoc|before)\\s+' + clock + '\\b').exec(clockClause);
  const after = new RegExp('\\b(?:apres|sau|after|a partir de|tu|from)\\s+' + clock + '\\b').exec(clockClause);
  const minutes = (m: RegExpExecArray | null) => m && Number(m[1]) < 24 && Number(m[2] ?? 0) < 60 ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null;
  const start = minutes(after), end = minutes(before);
  // Do not invent numeric hours for "dinner", "busy", "sometimes", etc.
  const unresolved = /\b(?:le matin|en matinee|morning|afternoon|apres midi|buoi sang|buoi trua|buoi chieu|le soir|en soiree|buoi toi|bua toi|diners?|dinner|evening|la nuit|night|buoi dem|jours? feries?|ngay le|holidays?|heures? de pointe|gio cao diem|peak hours|parfois|sometimes|doi khi|rarement|rarely|quand|lorsque|when|khi|certains|certaines)\b/.test(clause)
    || /\b(?:vers|autour de|environ|a|at|around|khoang|luc)\s+\d{1,2}(?:\s*[:h]|\s+gio\b)/.test(clause)
    || /\b(?:avant|apres|truoc|sau|before|after|a partir de|from)\b/.test(clockClause)&&!before&&!after
    || !!(before && end === null || after && start === null || exception && !excludedDays);
  return {days, start, start_exclusive:!!after&&/^(?:apres|sau|after)\b/.test(after[0]), end, unresolved};
}
function applies(scope: FeatureScope, visit: FeatureVisit): boolean | null {
  if (!limitedScope(scope)) return true;
  if (!visit.instant || !visit.timezone) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {parts = new Intl.DateTimeFormat('en-US', {timeZone: visit.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', second:'2-digit', hourCycle: 'h23'}).formatToParts(new Date(visit.instant));}
  catch {return null;}
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find(p => p.type === 'weekday')?.value ?? '');
  const minute = Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value)+Number(parts.find(p=>p.type==='second')?.value)/60;
  if (scope.days && !scope.days.includes(day)) return false;
  if (scope.start !== null && (scope.start_exclusive?minute<=scope.start:minute<scope.start) || scope.end !== null && minute >= scope.end) return false;
  return scope.unresolved ? null : true;
}
/** Semicolons/contrast/conjunctions delimit scope; a scoped unknown may refer to
 * the feature in the previous clause of THIS point, never another report point. */
export function reportFeatureSignals(text: string, feature: string, visit: FeatureVisit = {}): FeatureSignal[] {
  if (!Object.hasOwn(REPORT_FEATURE_PHRASES, feature)) return [];
  const result: FeatureSignal[] = [];
  let antecedent: boolean = false;
  const clauses = normalize(text).split(/[;.!?\n,]+|\b(?:mais|pourtant|nhung|tuy nhien|but|however|et|va|and)\b/).map(s => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    const scope = scopeFor(clause);
    let mentioned = false;
    for (const [phrases, opposite] of [[REPORT_FEATURE_PHRASES[feature], false], [contrary[feature] ?? [], true]] as const) {
      for (const phrase of phrases) for (const match of clause.matchAll(new RegExp('\\b' + words(phrase) + '\\b', 'g'))) {
        mentioned = true;
        const before = clause.slice(0, match.index), after = clause.slice(match.index! + match[0].length);
        const negated = negationBefore.test(before) || negationAfter.test(after);
        const notEvidence = unknown.test(clause) || wish.test(clause) || complaintDenial.test(clause)
          || opposite && (negated || /\b(?:aucun\w*|pas|not|khong|chua)\b/.test(clause) && reportDenialAfter.test(after));
        const polarity = notEvidence ? 'unknown' : opposite || negated ? 'negative' : 'positive';
        result.push({polarity, scope, applies: applies(scope, visit)});
      }
    }
    const inherited: boolean = !mentioned && antecedent && limitedScope(scope) && unknown.test(clause);
    if (inherited) result.push({polarity: 'unknown', scope, applies: applies(scope, visit)});
    antecedent = mentioned || inherited;
  }
  return result;
}
