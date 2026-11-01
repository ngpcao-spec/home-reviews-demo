// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {recommendRestaurants,type Request,type SheetRow} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {reportFeatureSignals} from '../../supabase/functions/_shared/report-feature-evidence';
import {placeProfile} from '../../supabase/functions/_shared/google-place-profile';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {prepareAi} from '../../supabase/functions/_shared/recommendation-ai';

const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function sheet(language:'fr'|'vi',positive:string,reservation?:string,google?:boolean,timezone=true):SheetRow {
  const row=recommendationSheet('example',{category:'ambiance',positive,reservation});
  row.language=language; row.publication!.language=language;
  row.metadata.google_place_profile={...placeProfile([{cid:'123',language,scrapedAt:'2026-10-28T00:00:00Z',countryCode:timezone?'VN':null,
    reviews:[],openingHours:weekdays.map(day=>({day,hours:'00:00–00:00'})),
    additionalInfo:google===undefined?{}:{Atmosphere:[{Quiet:google}]}}],
    {google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language}),
    binding:{establishment_id:row.establishment_id,organization_id:row.organization_id}};
  return row;
}
function run(row:SheetRow,request:Partial<Request>={}) {
  return recommendRestaurants([row],row.organization_id,row.language,{geography:'not_requested',preferences:{features:['quiet']},...request} as Request);
}
const fact=(row:SheetRow,request:Partial<Request>={})=>run(row,request).proposals[0].features.quiet;
const required=(row:SheetRow,visit_at?:string)=>run(row,{required_features:['quiet'],...(visit_at?{visit_at}:{})});
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});

describe.each(['fr','vi'] as const)('scoped report feature evidence (%s)',language=>{
  const text=(fr:string,vi:string)=>language==='fr'?fr:vi;
  it('does not confuse missing weekend information with weekday criticism',()=>{
    const row=sheet(language,text('Calme en semaine ; les week-ends ne sont pas documentés.',
      'Không gian yên tĩnh vào ngày thường; cuối tuần chưa được ghi nhận.'),undefined,true);
    const original=structuredClone(row);
    expect(fact(row)).toMatchObject({status:'not_documented',context:{status:'unresolved'}});
    expect(run(row).proposals[0].contradictions).toEqual([]);
    expect(required(row).proposals).toHaveLength(0); // No date: do not promise every day.
    const monday='2026-11-02T12:00:00Z',saturday='2026-10-31T12:00:00Z';
    expect(required(row,monday).proposals).toHaveLength(1);
    expect(fact(row,{visit_at:monday})).toMatchObject({status:'reported',context:{status:'matched'}});
    expect(required(row,saturday).proposals).toHaveLength(0);
    expect(fact(row,{visit_at:saturday})).toMatchObject({status:'not_documented',context:{status:'unresolved'}});
    expect(row).toEqual(original);
  });
  it('does not turn a wish for seats and a denial of noise complaints into a conflict',()=>{
    const row=sheet(language,text('La décoration est appréciée.','Khách khen cách bài trí.'),
      text('Un client donnant cinq étoiles souhaite davantage de places ; il ne signale aucun bruit.',
        'Một khách cho 5 sao mong có thêm chỗ ngồi; không có phản ánh về tiếng ồn.'),true);
    expect(fact(row)).toMatchObject({status:'reported',citations:[]});
    expect(fact(row).google).toBeDefined();
    expect(run(row).proposals[0].contradictions).toEqual([]);
    expect(required(row).proposals).toHaveLength(1);
  });
  it('never uses absence of complaints as positive report support',()=>{
    const row=sheet(language,text('La décoration est appréciée.','Khách khen cách bài trí.'),
      text('Aucun bruit signalé.','Không có phản ánh về tiếng ồn.'));
    expect(fact(row)).toMatchObject({status:'not_documented',citations:[]});
    expect(required(row).proposals).toHaveLength(0);
  });
  it('keeps explicit noise and direct negation as incompatible with required quiet',()=>{
    for(const reservation of [text('La salle est bruyante et la musique forte.','Không gian ồn ào và nhạc to.'),
      text('La salle n’est pas calme.','Không gian không yên tĩnh.'),
      text('Ce n’est pas un endroit calme.','Không phải nơi yên tĩnh.')]){
      const row=sheet(language,text('Les plats sont appréciés.','Món ăn được khen.'),reservation,true);
      expect(fact(row).status).toBe('conflicted');
      expect(run(row).proposals[0].contradictions).toHaveLength(1);
      expect(required(row).proposals).toHaveLength(0);
    }
  });
  it('keeps Google false versus an actual positive report as a contradiction',()=>{
    const row=sheet(language,text('La salle est calme.','Không gian yên tĩnh.'),undefined,false);
    expect(fact(row).status).toBe('conflicted');
    expect(run(row).proposals[0].contradictions).toHaveLength(1);
    expect(required(row).proposals).toHaveLength(0);
  });
  it('does not let an unrelated negation contaminate a positive clause',()=>{
    const row=sheet(language,text('La salle est calme ; le parking n’est pas documenté.',
      'Không gian yên tĩnh; chưa có thông tin về bãi đỗ xe.'));
    expect(fact(row).status).toBe('reported');
    expect(required(row).proposals).toHaveLength(1);
  });
  it('does not turn an explicitly unconfirmed quiet claim into noise',()=>{
    for(const positive of [text('Le calme n’est pas confirmé.','Chưa có thông tin xác nhận nơi này yên tĩnh.'),
      text('Aucune preuve que le lieu soit calme.','Không có dữ liệu xác nhận nơi này yên tĩnh.'),
      text('Le rapport ne dit pas que la salle est calme.','Chưa được xác nhận là yên tĩnh.'),
      text('Ce n’est pas toujours calme.','Không phải lúc nào cũng yên tĩnh.')]){
      const row=sheet(language,positive);
      expect(fact(row).status).toBe('not_documented');
      expect(required(row).proposals).toHaveLength(0);
    }
  });
  it('does not let negated noise hide real noise in another clause',()=>{
    const row=sheet(language,text('La décoration est appréciée.','Khách khen cách bài trí.'),
      text('Aucun bruit signalé en semaine ; la musique est forte le samedi.',
        'Không có phản ánh về tiếng ồn ngày thường; nhạc to vào thứ bảy.'),true);
    expect(fact(row,{visit_at:'2026-10-31T12:00:00Z'}).status).toBe('conflicted');
    expect(required(row,'2026-10-31T12:00:00Z').proposals).toHaveLength(0);
  });
  it('keeps a real dated Google/report disagreement visible outside the requested day',()=>{
    const row=sheet(language,'Good food.',text('La salle est bruyante le vendredi.','Không gian ồn ào vào thứ sáu.'),true);
    const result=run(row,{visit_at:'2026-10-31T12:00:00Z'});
    expect(result.proposals[0].features.quiet).toMatchObject({status:'reported',context:{status:'outside'},citations:[]});
    expect(result.proposals[0].contradictions).toHaveLength(1);
    expect(result.proposals[0].contradictions[0].citations[0].text).toBe((row.report_sections.reservations as {text:string}[])[0].text);
  });
  it('uses explicit local clock boundaries and preserves unknown later hours',()=>{
    const row=sheet(language,text('Calme avant 19h ; après 19h le calme est inconnu.',
      'Không gian yên tĩnh trước 19 giờ; sau 19 giờ chưa rõ mức yên tĩnh.'),undefined,true);
    expect(required(row,'2026-11-02T11:00:00Z').proposals).toHaveLength(1); // local 18:00
    expect(required(row,'2026-11-02T13:00:00Z').proposals).toHaveLength(0); // local 20:00
    expect(fact(row,{visit_at:'2026-11-02T13:00:00Z'}).status).toBe('not_documented');
    expect(run(row).proposals[0].scores).toEqual(run(sheet(language,'Other text.')).proposals[0].scores);
  });
  it('does not call two different time contexts a contradiction within a report',()=>{
    const row=sheet(language,text('Calme avant 19h ; musique forte après 20h.',
      'Yên tĩnh trước 19 giờ; nhạc to sau 20 giờ.'));
    expect(fact(row).status).toBe('not_documented');
    expect(run(row).proposals[0].contradictions).toEqual([]);
    expect(required(row,'2026-11-02T11:00:00Z').proposals).toHaveLength(1);
    expect(fact(row,{visit_at:'2026-11-02T14:00:00Z'}).status).toBe('conflicted');
  });
  it('respects the exact boundary of after/before rather than including the excluded instant',()=>{
    const row=sheet(language,text('Calme après 19h.','Yên tĩnh sau 19 giờ.'),undefined,true);
    expect(required(row,'2026-11-02T12:00:00Z').proposals).toHaveLength(0);
    expect(required(row,'2026-11-02T12:00:30Z').proposals).toHaveLength(1);
  });
  it('does not invent hours for a dinner claim or a timezone for a weekday claim',()=>{
    const dinner=sheet(language,text('Calme lors de dîners en semaine.','Yên tĩnh trong bữa tối ngày thường.'),undefined,true);
    expect(required(dinner,'2026-11-02T12:00:00Z').proposals).toHaveLength(0);
    const noZone=sheet(language,text('Calme en semaine.','Yên tĩnh ngày thường.'),undefined,true,false);
    // No visit criterion needed here: inspect evidence directly to isolate timezone uncertainty from opening hours.
    expect(reportFeatureSignals(text('Calme en semaine.','Yên tĩnh ngày thường.'),'quiet',{instant:'2026-11-02T12:00:00Z',timezone:null})[0].applies).toBeNull();
    expect(required(noZone).proposals).toHaveLength(0);
  });
  it('does not confirm qualified negations or wishes',()=>{
    for(const positive of [text('Pas forcément calme.','Không nhất thiết yên tĩnh.'),text('Le client souhaite un lieu calme.','Khách muốn nơi này yên tĩnh.')]){
      expect(fact(sheet(language,positive)).status).toBe('not_documented');
    }
  });
  it('does not invert an exception into positive evidence for the excluded days',()=>{
    const row=sheet(language,text('Calme sauf le week-end.','Yên tĩnh ngoại trừ cuối tuần.'),undefined,true);
    expect(required(row,'2026-11-02T12:00:00Z').proposals).toHaveLength(1);
    expect(required(row,'2026-10-31T12:00:00Z').proposals).toHaveLength(0);
    expect(run(row).proposals[0].contradictions).toEqual([]);
  });
  it('does not generalize a single approximate observation hour',()=>{
    for(const positive of [text('Calme vers 19h.','Yên tĩnh khoảng 19 giờ.'),text('Calme le matin.','Yên tĩnh buổi sáng.')]){
      const row=sheet(language,positive,undefined,true);
      expect(required(row).proposals).toHaveLength(0);
      expect(required(row,'2026-11-02T13:00:00Z').proposals).toHaveLength(0);
    }
  });
  it('does not attribute a negated complaint to the report as evidence of quiet in AI facts',()=>{
    const row=sheet(language,'Good food.',text('Aucun bruit signalé.','Không có phản ánh về tiếng ồn.'),true);
    const p=prepareAi({organizationId:row.organization_id,language,rows:[row],establishments:[]},{geography:'not_requested'},'');
    const wire=JSON.parse(p.request.input).candidates[0];
    expect(wire.facts.find((f:{ref:string})=>f.ref==='feature_quiet')).toMatchObject({value:{status:'reported'},source:'google_maps_practical'});
    expect(p.proposals[0].features.quiet.citations).toEqual([]);
  });
  it('preserves matched time qualifiers in compact AI facts without copying raw text',()=>{
    const row=sheet(language,text('Calme avant 19h.','Yên tĩnh trước 19 giờ.'),undefined,true);
    const p=prepareAi({organizationId:row.organization_id,language,rows:[row],establishments:[]},
      {geography:'not_requested',visit_at:'2026-11-02T11:00:00Z'},'');
    const f=JSON.parse(p.request.input).candidates[0].facts.find((f:{ref:string})=>f.ref==='feature_quiet');
    expect(f.value).toMatchObject({status:'reported',context:{status:'matched',scopes:[{end:1140}]}});
    expect(f.value.context).not.toHaveProperty('text');
  });
});

it('keeps the existing English behavior and scopes newline-separated unknowns',()=>{
  expect(reportFeatureSignals('Not quiet.','quiet')[0].polarity).toBe('negative');
  expect(reportFeatureSignals('No noise complaints.','quiet')[0].polarity).toBe('unknown');
  const s=reportFeatureSignals('Quiet on weekdays.\nWeekends are unknown.','quiet');
  expect(s.map(x=>x.polarity)).toEqual(['positive','unknown']);
  expect(s[1].scope.days).toEqual([0,6]);
  expect(reportFeatureSignals('Air-conditioned private-room.','air_conditioning')[0].polarity).toBe('positive');
  expect(reportFeatureSignals('Điều hòa.','air_conditioning')[0].polarity).toBe('positive');
  expect(reportFeatureSignals('Quiet before 7pm.','quiet')[0].scope.unresolved).toBe(true);
});
