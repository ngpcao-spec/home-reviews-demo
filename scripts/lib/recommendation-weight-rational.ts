// Independent audit arithmetic: no SQL calculator, float rounding or network.
export type Fraction={n:bigint;d:bigint};
export function decimal(value:string):Fraction{
 const m=value.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);if(!m)throw Error('INVALID_EXACT_NUMBER');
 const scale=(m[3]?.length??0)-Number(m[4]??0),n=BigInt((m[1]??'')+m[2]+(m[3]??''));
 return scale>=0?{n,d:10n**BigInt(scale)}:{n:n*10n**BigInt(-scale),d:1n};
}
export interface CategoryInputs{rating_sum:string|null;rating_count:string;positive:string|null;negative:string|null;denominator:string;classifications_coherent:string;ratings_coherent:string}
export function independentScore(c:CategoryInputs,negativeWeight:2|4):Fraction|null{
 if(c.rating_sum===null||c.positive===null||c.negative===null||c.classifications_coherent!=='true'||c.ratings_coherent!=='true')return null;
 const r=BigInt(c.rating_count),t=BigInt(c.denominator),p=BigInt(c.positive),n=BigInt(c.negative);
 if(r<=0n||t<=0n||p<0n||n<0n||p+n>t)return null;
 const sum=decimal(c.rating_sum),den=r*t*sum.d,num=sum.n*t+(p-BigInt(negativeWeight)*n)*r*sum.d;
 return {n:num<0n?0n:num>6n*den?6n*den:num,d:den};
}
export function mean(scores:(Fraction|null)[]):Fraction|null{
 if(scores.length!==3||scores.some(s=>s===null))return null;const [a,b,c]=scores as Fraction[];
 return {n:a.n*b.d*c.d+b.n*a.d*c.d+c.n*a.d*b.d,d:3n*a.d*b.d*c.d};
}
export function agrees(expected:Fraction|null,numerator:string|null,denominator:string|null):boolean{
 if(!expected)return numerator===null&&denominator===null;
 if(numerator===null||denominator===null)return false;const n=decimal(numerator),d=decimal(denominator);
 return d.n>0n&&expected.n*n.d*d.n===n.n*d.d*expected.d;
}
export const fractionText=(f:Fraction|null)=>f?`${f.n}/${f.d}`:null;
