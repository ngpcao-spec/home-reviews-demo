// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {distanceMetres,prices,recommendRestaurants,type Request,type SheetRow} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {exactJson} from '../../supabase/functions/_shared/restaurant-recommendation-numbers';
import {recommendationSheet as sheet} from '../fixtures/restaurant-recommendation-catalogue';
const request: Request = {origin:{latitude:12,longitude:109},area:{kind:'radius',metres:10000}};
const run = (rows: SheetRow[], changes: Partial<Request> = {}) => recommendRestaurants(rows,'org-a','vi',{...request,...changes});
const ids = (r: ReturnType<typeof run>) => r.proposals.map(x => x.establishment_id);
beforeEach(() => {vi.stubGlobal('fetch',vi.fn(() => {throw Error('NETWORK_FORBIDDEN');}));});
afterEach(() => {expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});

describe('geography, explicit criteria and access',() => {
  it('uses straight-line great-circle distances, radius boundaries and coordinates rather than names',() => {
    expect(distanceMetres({latitude:0,longitude:0},{latitude:0,longitude:1})).toBeCloseTo(111195.08,1);
    const r=run([sheet('near'),sheet('far',{latitude:13})]);expect(ids(r)).toEqual(['near']);expect(r.excluded[0].reasons).toContain('OUTSIDE_AREA');
    expect(r.proposals[0]).toMatchObject({distance_metres:0,distance_kind:'straight_line'});
  });
  it('supports a rectangular zone crossing the date line and rejects missing context',() => {
    const rows=[sheet('east',{latitude:0,longitude:179}),sheet('west',{latitude:0,longitude:-179}),sheet('outside',{latitude:0,longitude:10})];
    expect(ids(run(rows,{origin:{latitude:0,longitude:180},area:{kind:'bounds',south:-1,north:1,west:170,east:-170}})).sort()).toEqual(['east','west']);
    expect(() => run([],{origin:{latitude:NaN,longitude:0}})).toThrow('POSITION_REQUIRED');
    expect(() => run([],{area:{kind:'radius',metres:-1}})).toThrow('INVALID_AREA');
  });
  it('does not reveal or count sheets from another organization or language, and rejects duplicates',() => {
    const a=sheet('secret');a.organization_id='org-b';const fr=sheet('fr');fr.language='fr';
    const r=run([a,fr,sheet('ok')]);expect(ids(r)).toEqual(['ok']);expect(r.excluded).toEqual([]);expect(JSON.stringify(r)).not.toContain('secret');
    expect(run([sheet('same'),sheet('same')]).proposals).toHaveLength(0);
  });
  it('requires explicit documented cuisines without inferring cuisine from restaurant names',() => {
    const r=run([sheet('pizza-name'),sheet('documented',{cuisines:['italian']})],{cuisines:['italien']});
    expect(ids(r)).toEqual(['documented']);expect(r.excluded[0].reasons).toContain('CUISINE_NOT_DOCUMENTED');
    expect(run([sheet('any')]).proposals).toHaveLength(1);
    const bbq=sheet('bbq-name');expect(run([bbq],{cuisines:['bbq']}).proposals).toHaveLength(0);
    (bbq.metadata.google_metadata as Record<string,unknown>).google_categories=['Nhà hàng món nướng'];
    expect(ids(run([bbq],{specialties:['bbq']}))).toEqual(['bbq-name']);
    expect(run([bbq]).proposals[0].cuisines.values).toEqual([]);
    expect(run([bbq]).proposals[0].specialties).toEqual(['barbecue']);
  });
  it('never fills three places if only one or two candidates qualify',() => {
    expect(run([sheet('a')]).proposals).toHaveLength(1);expect(run([sheet('a'),sheet('b')]).proposals).toHaveLength(2);
    expect(run(Array.from({length:8},(_,i) => sheet(String(i)))).proposals).toHaveLength(3);
  });
});
describe('frozen V2 scores, freshness and report evidence',() => {
  it('retains coherent dated scores when only the corpus changed, with an explicit freshness notice',()=>{
    const a=sheet('dated',{stale:true});a.stale_reason='CORPUS_CHANGED';a.publication!.stale_reason='CORPUS_CHANGED';
    const before=structuredClone(a),r=run([a]);expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].report).toMatchObject({id:a.report_id,generated_at:a.report_generated_at,freshness:'corpus_changed',corpus:a.corpus});
    expect(r.proposals[0].reasons).toContainEqual({code:'DATED_REPORT_NEW_REVIEWS_NOT_COVERED'});expect(a).toEqual(before);
    a.publication!.stale_reason='PUBLICATION_INVALID';expect(run([a]).proposals).toHaveLength(0);
    a.publication!.stale_reason='CORPUS_CHANGED';a.calculation_text='{}';expect(run([a]).proposals).toHaveLength(0);
  });
  it('excludes stale, invalid, missing-score and old-version sheets with explicit reasons',() => {
    const old=sheet('old');old.calculation_version='internal-recommendation-v1';const missing=sheet('missing');missing.calculation_text='{}';
    const mismatch=sheet('mismatch');mismatch.publication!.report_id='other';const noPoint=sheet('no-point');noPoint.metadata.google_metadata={};
    const r=run([sheet('stale',{stale:true}),old,missing,mismatch,noPoint]);expect(r.proposals).toEqual([]);
    expect(r.excluded.flatMap(x => x.reasons)).toEqual(expect.arrayContaining(['STALE_SHEET','UNSUPPORTED_SCORE_VERSION','MISSING_OR_INCONSISTENT_SCORES','INVALID_OR_MISMATCHED_REPORT','MISSING_COORDINATES']));
  });
  it('rejects a mixed corpus, broken global, or report sections copied from another report',() => {
    const a=sheet('a');a.publication!.scope.fingerprint='wrong';const b=sheet('b');const c=JSON.parse(b.calculation_text);c.global_score_numerator='4';b.calculation_text=JSON.stringify(c);
    const d=sheet('d');d.report_sections={...d.report_sections,positive_aspects:[]};expect(run([a,b,d]).proposals).toHaveLength(0);
  });
  it('ranks on exact V2 fractions and never Google stars or rounded display values',() => {
    const rows=[sheet('worse',{score:'4.89999999999999999999999999999'}),sheet('better',{score:'5'})];
    rows[0].metadata.google_rating=5;rows[1].metadata.google_rating=1;
    expect(ids(run(rows))).toEqual(['better','worse']);
    expect(exactJson('{"n":123456789012345678901,"quoted":"12345"}')).toEqual({n:'123456789012345678901',quoted:'12345'});
  });
  it('groups scores within .10 from the group leader, avoiding non-transitive pairwise ties',() => {
    const rows=[sheet('high',{score:'5.10',latitude:12.02}),sheet('middle',{score:'5.04',latitude:12.01}),sheet('low',{score:'4.98'})];
    expect(ids(run(rows))).toEqual(['middle','high','low']);expect(ids(run([...rows].reverse()))).toEqual(ids(run(rows)));
    expect(ids(run([sheet('a',{score:'5.10',latitude:12.01}),sheet('b',{score:'5'})]))).toEqual(['b','a']);
  });
  it('uses category preferences within comparable globals and includes exact report reasons and reservations',() => {
    const a=sheet('a',{score:'5.04',positive:'Fresh food.',reservation:'One guest found the dish cold.'}),b=sheet('b',{score:'5.03',latitude:12.01});
    const c=JSON.parse(b.calculation_text);c.categories.quality={score:'5.5',score_numerator:'55',score_denominator:'10'};
    c.categories.service={score:'4.56',score_numerator:'456',score_denominator:'100'};b.calculation_text=JSON.stringify(c);
    const r=run([a,b],{preferences:{categories:['quality']}});expect(ids(r)[0]).toBe('b');
    expect(r.proposals[1].reservations[0]).toMatchObject({report_id:a.report_id,text:'One guest found the dish cold.',section:'reservations',evidence_ids:['b'.repeat(64)]});
    expect(r.proposals[1].reasons).toContainEqual(expect.objectContaining({code:'CATEGORY_PREFERENCE',category:'quality',citations:expect.any(Array)}));
  });
  it('leaves inputs, stale flags, scores and reports untouched',() => {const rows=[sheet('a'),sheet('old',{stale:true})],before=structuredClone(rows);run(rows);expect(rows).toEqual(before);});
});
describe('budget and supported refinements',() => {
  it('does not pretend an unknown price meets an explicit budget, even with customer spending and value praise',() => {
    const a=sheet('unknown',{positive:'Excellent value and inexpensive.'});(a.metadata.budget as Record<string,unknown>).customer_spend_per_person={source:'frozen_report_review_context',ranges:[{value:'100000–200000 VND',review_count:100}]};
    expect(ids(run([a]))).toEqual(['unknown']);expect(run([a]).notices).toContain('ESTABLISHMENT_BUDGET_UNKNOWN');
    const r=run([a],{budget:{kind:'amount',currency:'VND',maximum:500000}});expect(r.proposals).toEqual([]);expect(r.excluded[0].reasons).toContain('BUDGET_UNKNOWN');
  });
  it('distinguishes levels, closed currency ranges and client spending without FX or a currency guess',() => {
    const a=sheet('level',{level:2});expect(ids(run([a],{budget:{kind:'price_level',allowed:[1,2]}}))).toEqual(['level']);
    expect(run([a],{budget:{kind:'amount',currency:'USD',maximum:50}}).proposals).toHaveLength(0);
    const b=sheet('range');(b.metadata.budget as Record<string,unknown>).establishment_price={source:'google_maps_import',status:'provided',observed_at:'2026-10-28T00:00:00Z',price_range:'100000–200000 VND'};
    expect(ids(run([b],{budget:{kind:'amount',currency:'VND',maximum:200000}}))).toEqual(['range']);
    expect(run([b],{budget:{kind:'amount',currency:'USD',maximum:200000}}).proposals).toHaveLength(0);
    expect(prices({budget:{establishment_price:{source:'google_maps_import',status:'provided',observed_at:'2026-10-28',price_range:'10–20 $'}}}).establishment.status).toBe('unknown');
    expect(prices({budget:{establishment_price:{source:'google_maps_import',status:'provided',observed_at:'2026-10-28',price:'2'}}}).establishment.level).toBeNull();
  });
  it('diversifies known budgets only among similarly scored, similarly located candidates',() => {
    const rows=[sheet('a',{level:2}),sheet('b',{level:2,latitude:12.0001}),sheet('c',{level:1,latitude:12.0002}),sheet('d',{level:3,latitude:12.0003})];
    expect(ids(run(rows))).toEqual(['a','c','d']);
    rows[2].metadata.google_metadata={coordinates:{latitude:12.04,longitude:109}};expect(ids(run(rows))[1]).toBe('d');
    expect(run(rows).refinements.every(x => !x.kind.includes('quiet'))).toBe(true);
    expect(run([sheet('a'),sheet('b'),sheet('c'),sheet('d')]).refinements.filter(x => x.kind.includes('price'))).toEqual([]);
  });
  it('offers a cheaper refinement only when an eligible comparable alternative documents a lower price',() => {
    const rows=[sheet('a',{level:3}),sheet('b',{level:2}),sheet('c',{level:1}),sheet('d',{level:0})];
    const r=run(rows);expect(r.refinements).toContainEqual({kind:'lower_price_level',from_id:'a',alternative_id:'d'});
    rows[3].stale=true;expect(run(rows).refinements.some(x => x.alternative_id==='d')).toBe(false);
  });
  it('does not call overlapping ranges or different currencies a demonstrated budget diversity',() => {
    const ranges=[['a',100,200,'VND'],['b',110,210,'VND'],['c',10,20,'USD'],['d',300,400,'VND']] as const;
    const rows=ranges.map(([id,minimum,maximum,currency],i) => {const r=sheet(id,{latitude:12+i*0.0001});(r.metadata.budget as Record<string,unknown>).establishment_price={source:'google_maps_import',status:'provided',observed_at:'2026-10-28',price_range:{minimum,maximum,currency}};return r;});
    expect(ids(run(rows))).toEqual(['a','d','b']);
  });
});
describe('documented characteristics without semantic invention',() => {
  it('does not infer calm or speed from ambiance/service scores and leaves unsupported soft preferences optional',() => {
    const r=run([sheet('a',{score:'6'})],{preferences:{features:['quiet','fast_service','open_now']}});
    expect(ids(r)).toEqual(['a']);expect(r.proposals[0].features.quiet.status).toBe('not_documented');expect(r.proposals[0].features.fast_service.status).toBe('not_documented');
    expect(r.notices).toContain('UNSUPPORTED_FEATURE:open_now');expect(run([sheet('a')],{required_features:['quiet']}).proposals).toEqual([]);
  });
  it('requires literal positive report support, rejects negation and flags contradictory reservations',() => {
    const yes=sheet('yes',{positive:'A quiet dining room.',category:'ambiance'}),no=sheet('no',{positive:'Not quiet.',category:'ambiance'}),conflict=sheet('conflict',{positive:'Quiet atmosphere.',reservation:'The room is not quiet.',category:'ambiance'});
    expect(ids(run([no,yes,conflict],{required_features:['quiet']}))).toEqual(['yes']);
    const r=run([conflict],{preferences:{features:['quiet']}});expect(r.proposals[0].features.quiet.status).toBe('conflicted');
    expect(r.proposals[0].reasons.some(x => x.code==='REPORTED_FEATURE')).toBe(false);
    expect(r.refinements).toEqual([]);
    const noisy=sheet('noisy',{positive:'Quiet room.',reservation:'Loud music and a noisy terrace.',category:'ambiance'});
    expect(run([noisy],{required_features:['quiet']}).proposals).toEqual([]);
  });
  it('recognizes only explicit FR/VI/EN supported phrases, with citations, rather than word length',() => {
    for(const text of ['Service rapide.','Phục vụ nhanh, chu đáo.','Quick service.']) {
      const r=run([sheet('a',{positive:text,category:'service'})],{required_features:['fast_service']});expect(ids(r)).toEqual(['a']);expect(r.proposals[0].features.fast_service.citations[0].text).toBe(text);
    }
    const vi=run([sheet('a',{positive:'Không gian yên tĩnh và có máy lạnh.',category:'ambiance'})],{required_features:['quiet','air_conditioning']});expect(ids(vi)).toEqual(['a']);
  });
  it('treats prototype names as unsupported criteria, without unsafe dictionary lookups',() => {
    const r=run([sheet('a')],{preferences:{features:['constructor','__proto__']}});expect(ids(r)).toEqual(['a']);expect(r.notices).toContain('UNSUPPORTED_FEATURE:constructor');
    expect(run([sheet('a')],{required_features:['__proto__']}).proposals).toHaveLength(0);
  });
});
