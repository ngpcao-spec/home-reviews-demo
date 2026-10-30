import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,Navigate} from 'react-router-dom';
import {useApp} from '../app/AppContext';
import {PageHeader} from '../components/ui/PageHeader';
import {useI18n} from '../i18n';
import {recommendationMessages,recommendationCuisineLabels} from '../i18n/recommendations';
import {recommendationTestApi,type Proposal,type RecommendationTestInput,type RecommendationTestResponse} from '../lib/recommendation-test';
import './RecommendationTestPage.css';
import type {AiSelection,AiExplanation} from '../../supabase/functions/_shared/recommendation-ai-contract';

export function RecommendationTestPage(){
 const {currentUser,isAuthenticated,demoMode}=useApp(),{language}=useI18n(),m=recommendationMessages[language];
 const [options,setOptions]=useState<RecommendationTestResponse|null>(null),[response,setResponse]=useState<RecommendationTestResponse|null>(null);
 const [organization,setOrganization]=useState(''),[cuisine,setCuisine]=useState(''),[maximum,setMaximum]=useState(''),[service,setService]=useState(false);
 const [preference,setPreference]=useState(''),[required,setRequired]=useState<string[]>([]),[comparing,setComparing]=useState(false);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const epoch=useRef({value:0}).current,pending=useRef<number|null>(null);
 const errorText=(code:string)=>code==='UNAUTHORIZED'?m.auth:code==='FORBIDDEN'?m.forbidden:code==='INVALID_RECOMMENDATION_REQUEST'?m.invalid:code==='RECOMMENDATION_CLIENT_UPDATE_REQUIRED'?m.updateRequired:code==='ACCOUNT_LANGUAGE_CHANGED'?m.languageChanged:m.unavailable;
 useEffect(()=>{
  const version=++epoch.value;pending.current=null;setBusy(false);setComparing(false);setOptions(null);setResponse(null);setError('');setCuisine('');setRequired([]);setPreference('');setLoading(true);
  if(!isAuthenticated||demoMode){setError('UNAUTHORIZED');setLoading(false);return;}
  void recommendationTestApi({action:'options',...(organization?{organization_id:organization}:{})}).then(data=>{
   if(version!==epoch.value)return;
   if(data.language!==language)throw Error('ACCOUNT_LANGUAGE_CHANGED');
   setOptions(data);
  }).catch(e=>{if(version===epoch.value)setError(e instanceof Error?e.message:'');}).finally(()=>{if(version===epoch.value)setLoading(false);});
  return()=>{++epoch.value;};
 },[currentUser.id,isAuthenticated,demoMode,language,organization,retry,epoch]);
 const change=()=>{++epoch.value;setResponse(null);setError('');};
 async function search(removeBudget=false,compare=false){
  if(!options||pending.current)return;
  const value=maximum.trim();
  if(!removeBudget&&value&&(!Number.isSafeInteger(Number(value))||Number(value)<0)){setError('INVALID_RECOMMENDATION_REQUEST');return;}
  const version=++epoch.value;pending.current=version;setBusy(true);setComparing(compare);setResponse(null);setError('');
  if(removeBudget)setMaximum('');
  const input:RecommendationTestInput={action:compare?'compare':'recommend',organization_id:options.organization_id,...(cuisine?{cuisine}:{}),
   ...(compare?{preference_mode:'free_text_v2' as const}:{}),
   ...(required.length?{required_features:required}:{}),...(compare&&preference.trim()?{preference:preference.trim()}:{}),
   ...(!removeBudget&&value?{maximum_vnd:Number(value)}:{}),...(service?{service_priority:true}:{})};
  try{
   const data=await recommendationTestApi(input);
   if(version!==epoch.value)return;
   if(data.language!==language)throw Error('ACCOUNT_LANGUAGE_CHANGED');
   if(!data.result)throw Error('RECOMMENDATION_TEST_UNAVAILABLE');
   setResponse(data);
  }catch(e){if(version===epoch.value)setError(e instanceof Error?e.message:'');}
  finally{if(pending.current===version){pending.current=null;setBusy(false);setComparing(false);}}
 }
 const submit=(e:FormEvent)=>{e.preventDefault();void search();};
 if(!isAuthenticated||demoMode)return <Navigate to="/connexion" replace/>;
 return <><PageHeader title={m.title} back/><section className="recommendation-test" aria-busy={busy||loading}>
  <header className="recommendation-intro"><span className="eyebrow">{m.private}</span><h1>{m.menu}</h1><p>{m.intro}</p><p className="recommendation-muted">{m.scope}</p></header>
  {loading&&<p role="status">{m.loading}</p>}
  {options&&<form className="recommendation-filters card" onSubmit={submit} noValidate>
   {options.organizations.length>1&&<label>{m.organization}<select aria-label={m.organization} value={options.organization_id} onChange={e=>{change();setOrganization(e.target.value);}}>{options.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
   <details><summary>{m.filters}</summary><div className="recommendation-filter-fields">
    <label>{m.cuisine}<select aria-label={m.cuisine} value={cuisine} onChange={e=>{change();setCuisine(e.target.value);}}><option value="">{m.allCuisines}</option>{options.cuisines.map(c=><option key={c} value={c}>{recommendationCuisineLabels[c]?.[language]??c}</option>)}</select></label>
    <label>{m.maximum}<input aria-label={m.maximum} type="number" min="0" step="1" inputMode="numeric" value={maximum} onChange={e=>{change();setMaximum(e.target.value);}} placeholder="200000" aria-describedby="recommendation-budget-hint"/><small id="recommendation-budget-hint">{m.maximumHint}</small></label>
    <label className="recommendation-check"><input type="checkbox" checked={service} onChange={e=>{change();setService(e.target.checked);}}/>{m.service}</label><small>{m.serviceHint}</small>
    <fieldset className="recommendation-required"><legend>{m.mandatory}</legend><p className="recommendation-muted">{m.mandatoryHint}</p>{options.features?.map(f=><label className="recommendation-check" key={f.id}><input type="checkbox" checked={required.includes(f.id)} onChange={e=>{change();setRequired(e.target.checked?[...required,f.id]:required.filter(id=>id!==f.id));}}/>{f.label}</label>)}</fieldset>
   </div></details>
   <label>{m.preference}<textarea aria-label={m.preference} value={preference} maxLength={500} placeholder={m.preferencePlaceholder} onChange={e=>{change();setPreference(e.target.value);}}/><small>{m.preferenceHint} {m.freeTextHint}</small></label>
   <button type="submit" className="primary-button full-width" disabled={busy||loading}>{busy&&!comparing?m.searching:m.search}</button>
   <button type="button" className="secondary-button full-width recommendation-compare" disabled={busy||loading} onClick={()=>void search(false,true)}>{comparing?m.comparing:m.compare}</button><small>{m.aiHint} {m.aiLimited}</small>
  </form>}
  {error&&<div role="alert" className="recommendation-notice card"><p>{errorText(error)}</p>{isAuthenticated&&!demoMode&&<button className="secondary-button" onClick={()=>options?void search():setRetry(n=>n+1)}>{m.retry}</button>}</div>}
  {response?.result&&<section aria-label={m.results} aria-live="polite">
   {response.comparison&&<h2>{m.engineSelection}</h2>}
   <p className="recommendation-muted">{m.scale}</p>
   {!response.result.proposals.length?<div className="recommendation-notice card"><h2>{m.empty}</h2>{maximum.trim()&&<><p>{m.budgetEmpty}</p><button className="secondary-button" onClick={()=>void search(true)} disabled={busy}>{m.removeBudget}</button></>}</div>
    :<>{response.result.proposals.length<3&&<p className="recommendation-muted">{m.limited}</p>}<div className="recommendation-results">{response.result.proposals.map(p=><RecommendationCard key={p.establishment_id} proposal={p}/>)}</div></>}
   {response.result.excluded.length>0&&<p className="recommendation-muted">{m.excluded} : {response.result.excluded.length}</p>}
   {response.comparison&&<section className="recommendation-ai" aria-label={m.aiSelection}><h2>{m.aiSelection}</h2>
    <p className="recommendation-origin" data-recommendation-origin={response.comparison.status}>{response.comparison.status==='completed'?m.originValidated:response.comparison.status==='cached'?m.originCached:response.comparison.status==='pending'?m.originPending:m.originFallback}</p>
    {response.comparison.status==='cached'&&<p className="recommendation-muted">{m.cachedMetrics}</p>}
    {['completed','cached'].includes(response.comparison.status)?<>{response.comparison.status==='cached'&&<p className="recommendation-muted">{m.aiCached}</p>}<p className="recommendation-muted">{m.aiSource}</p><div className="recommendation-results">{response.comparison.selections.map(s=><RecommendationCard key={s.proposal.establishment_id} proposal={s.proposal} selection={s}/>)}</div></>
     :<p className="recommendation-notice card" role="status">{response.comparison.status==='pending'?m.aiPending:m.aiFallback}</p>}
    <details className="recommendation-details"><summary>{m.aiMetrics}</summary><p>{m.aiModel} : {response.comparison.model}</p>{response.comparison.attempt_id&&<p className="recommendation-attempt">{m.attemptReference} : {response.comparison.attempt_id}</p>}{response.comparison.metrics&&<><p>{m.aiTokens} : {response.comparison.metrics.input_tokens??'—'} / {response.comparison.metrics.output_tokens??'—'}</p><p>{m.aiCache} : {response.comparison.metrics.cache_read_tokens??'—'} / {response.comparison.metrics.cache_write_tokens??'—'}</p><p>{m.aiDuration} : {response.comparison.metrics.duration_ms} ms</p><p>{response.comparison.metrics.cost_usd===null?m.aiUnknownCost:`${response.comparison.metrics.cost_usd} USD`}</p></>}</details>
   </section>}
  </section>}
 </section></>;
}

function RecommendationCard({proposal:p,selection}:{proposal:Proposal;selection?:AiSelection}){
 const {language}=useI18n(),m=recommendationMessages[language],locale=language==='vi'?'vi-VN':'fr-FR';
 const score=(s:Proposal['scores']['global'])=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(Number(s.value));
 const date=(s:string)=>new Date(s).toLocaleDateString(locale);
 const price=p.budget.establishment,range=price.range;
 const amount=(n:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(n);
 const chosen=p.reasons.find(r=>r.code==='CATEGORY_PREFERENCE'&&r.category==='service'&&r.citations?.length)
  ??p.reasons.find(r=>r.code==='REPORT_STRENGTH'&&r.citations?.length);
 const citation=chosen?.citations?.[0],caution=p.reservations[0];
 const displayedCaution=selection?selection.caution:caution;
 const second=citation?chosen?.code==='CATEGORY_PREFERENCE'?m.serviceReason:m.reportReason:p.budget_match==='google_range'?m.budgetReason:p.cuisines.values.length?m.cuisineReason:m.corpusReason;
 return <article className="recommendation-card card">
  <header><div><h2>{p.name}</h2>{p.cuisines.values.length>0&&<p className="recommendation-muted">{p.cuisines.values.map(c=>recommendationCuisineLabels[c]?.[language]??c).join(' · ')}</p>}</div><div className="recommendation-global"><span>{m.global}</span><strong>{score(p.scores.global)}<small> / 6</small></strong></div></header>
  <dl className="recommendation-scores">{(['quality','service','ambiance'] as const).map(c=><div key={c}><dt>{c==='quality'?m.quality:c==='service'?m.serviceScore:m.ambiance}</dt><dd>{score(p.scores[c])}<small> / 6</small></dd></div>)}</dl>
  <section className="recommendation-price"><h3>{m.indicative}</h3><p>{range?`${amount(range.minimum)}–${amount(range.maximum)} ${range.currency}`:price.status==='known'?price.level!==null?`${m.level} : ${price.level}/4`:price.label:m.unknownPrice}{price.unit==='per_person'?` · ${m.perPerson}`:` · ${m.unitUnknown}`}</p><small>{m.notGuaranteed}</small></section>
  <h3>{m.reasons}</h3><ul className="recommendation-reasons">{selection?selection.reasons.map(r=><li key={r.ref}>{r.display_kind==='report_extract'&&<small>{m.reportExtract}</small>}<p className="recommendation-excerpt recommendation-saved-excerpt">{r.text}</p><ExplanationNotes explanation={r}/></li>):<><li>{m.scoreReason}</li><li>{second}{citation&&<blockquote className="recommendation-excerpt">{citation.text}</blockquote>}</li></>}</ul>
  {displayedCaution&&<section className="recommendation-caution"><h3>{m.caution}</h3>{selection?.caution?.display_kind==='report_extract'&&<small>{m.reportExtract}</small>}<blockquote className={selection?'recommendation-excerpt recommendation-saved-excerpt':'recommendation-excerpt'}>{displayedCaution.text}</blockquote>{selection?.caution&&<ExplanationNotes explanation={selection.caution}/>}</section>}
  <p className="recommendation-report-date">{m.reportDate} {date(p.report.generated_at)}</p>
  {p.report.freshness==='corpus_changed'&&<p className="recommendation-freshness">{m.stale}</p>}
  <details className="recommendation-details"><summary>{m.details}</summary><div>
   <p>{m.corpus} : {String(p.report.corpus.total_reviews)}</p>{price.status==='known'&&price.source&&<p>{m.source}{price.observed_at?` · ${m.observed.toLowerCase()} ${date(price.observed_at)}`:''}</p>}
   <p>{price.unit_label} · {m.notGuaranteed}</p>
   {selection?<>{selection.reasons.map((r,i)=><ExplanationDetails key={r.ref} explanation={r} label={`${m.reasonSource} ${i+1}`}/>)}{selection.caution&&<ExplanationDetails explanation={selection.caution} label={m.cautionSource}/>}</>
    :(citation||caution)&&<><h3>{m.reportSource}</h3>{citation&&<blockquote>{citation.text}</blockquote>}{caution&&<blockquote>{caution.text}</blockquote>}</>}
   <small>{m.reference} : {p.report.id}</small>
  </div></details>
  <Link className="secondary-button full-width recommendation-open" to={`/etablissements/${encodeURIComponent(p.establishment_id)}`}>{m.view}</Link>
 </article>;
}

function ExplanationNotes({explanation}:{explanation:AiExplanation}){
 const {language}=useI18n(),m=recommendationMessages[language];
 return <>{explanation.notes?.map(note=><p className="recommendation-source-note" key={note}>{note==='google_not_noise_measurement'?m.googleLimit:note==='recurrence_requires_source_check'?m.recurrenceLimit:m.sourceUnavailable}</p>)}</>;
}
function ExplanationDetails({explanation:e,label}:{explanation:AiExplanation;label:string}){
 const {language}=useI18n(),m=recommendationMessages[language],locale=language==='vi'?'vi-VN':'fr-FR';
 const date=(v:string)=>new Date(v).toLocaleString(locale);
 const category=(c:string)=>c==='quality'?m.quality:c==='service'?m.serviceScore:c==='ambiance'?m.ambiance:c==='global'?m.global:c==='price'?m.priceCategory:c;
 return <section className="recommendation-bound-source"><h3>{label}</h3><small>{m.selectedReference} : {e.ref}</small>
  {e.sources?.map((s,i)=><div key={i} className="recommendation-source-entry">{s.kind==='google_maps'?<>
   <p>{m.googleDeclaration}{s.observed_at?` · ${m.observed} ${date(s.observed_at)}`:''}</p><blockquote>« {s.label} » : {s.value?m.sourceYes:m.sourceNo}</blockquote><code>{s.field}</code>
   {s.url&&<a href={s.url} target="_blank" rel="noopener noreferrer">{m.openGoogleSource}</a>}
  </>:s.kind==='report'?<><p>{m.reportSource} · {category(s.category)} · {m.sourcePoint} {s.index+1} · {date(s.generated_at)}</p><blockquote>{s.text}</blockquote><small>{m.reference} : {s.report_id}</small><small>{m.sourceReferences} : {s.evidence_ids.length}</small></>
   :<><p>{m.internalScoreSource} · {category(s.category)} : {s.score}/6</p><small>{m.reference} : {s.report_id} · {date(s.generated_at)}</small></>}</div>)}
  {!e.sources?.length&&<p>{e.display_kind==='saved_metadata'?m.metadataSource:m.sourceUnavailable}</p>}
  <ExplanationNotes explanation={e}/>
 </section>;
}
