/** Exact PostgreSQL JSON numerics. No floating point is used to rank scores. */
export type Rational = {n: bigint; d: bigint};
export function exactJson(text: string): unknown {
  JSON.parse(text); // Reject malformed JSON before preserving its number tokens.
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (token, number: string | undefined) => number === undefined ? token : JSON.stringify(number)));
}
export function rational(value: string): Rational {
  if (value.length > 200) throw Error('INVALID_SCORE_NUMBER');
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!m) throw Error('INVALID_SCORE_NUMBER');
  const scale = (m[3]?.length ?? 0) - Number(m[4] ?? 0);
  if (Math.abs(scale) > 200) throw Error('INVALID_SCORE_NUMBER');
  const n = BigInt(m[1] + m[2] + (m[3] ?? ''));
  return scale >= 0 ? {n, d: 10n ** BigInt(scale)} : {n: n * 10n ** BigInt(-scale), d: 1n};
}
export const compare = (a: Rational, b: Rational) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
export const subtract = (a: Rational, b: Rational): Rational => ({n: a.n * b.d - b.n * a.d, d: a.d * b.d});
export const add = (a: Rational, b: Rational): Rational => ({n: a.n * b.d + b.n * a.d, d: a.d * b.d});
export function quotient(numerator: string, denominator: string): Rational {
  const a = rational(numerator), b = rational(denominator);
  if (b.n <= 0n) throw Error('INVALID_SCORE_DENOMINATOR');
  return {n: a.n * b.d, d: a.d * b.n};
}
