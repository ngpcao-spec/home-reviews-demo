import type {ReactNode} from 'react'
import {useRef} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {useSearchParams} from 'react-router-dom'
import {useI18n} from '../i18n'
import {supabase} from '../lib/supabase'
import type {HistoricalReport} from '../lib/historical-report'
import {mapHistoricalReport,type HistoricalReportRow} from '../lib/historical-report'
import {ConsultantReport} from './ConsultantReport'
import {ReputationReport} from './ReputationReport'
import './parallel-reports.css'
type Section={category?:string;text:string;evidence_ids:string[]}
type Recommendation={title:string;category:string;evidence_ids:string[];observations:{text:string;evidence_id:string;quote:string}[];proposed_action:string;priority_reason:string}
interface ExperimentalResult {format_version:string;report:{categories:Section[];positive_aspects:Section[];negative_aspects:Section[];conclusion:Section;recommendations:Recommendation[]}}
export interface ParallelView {
 reference_report?:HistoricalReportRow|null;versions?:{id:string;reference_generation_id:string;created_at:string;generated_at:string|null;state:string}[]
 current:{id:string;generation_id:string;state:string;generated_at:string|null;source_reviews:number;text_reviews:number;source_fingerprint:string}
 corpus_reusable:boolean;unavailable_reason:string|null
 experimental:null|{id:string;state:string;error_code:string|null;generated_at:string|null;created_at:string;derived_report:ExperimentalResult|null;original_report:unknown;raw_response:unknown;corrections:unknown;
  source_reviews:{id:string;original_text:string;analysis_text:string|null}[];statistics:{scope:{source_reviews:number;analysed_text_reviews:number;textless_statistics_only:number};counts:{categories:Record<string,{positive_reviews:number;negative_reviews:number;distinct_mentioned_reviews:number}>}}|null;
  controls:{technical_checks_passed?:boolean;section_issues?:{path:string;reason:string}[];evidence?:{evidence_id:string;review_id:string;quote:string}[]}|null;usage:unknown;imported_derivative_id?:string}
 run:null|{id:string;status:string;stage:string;error_code:string|null};tasks:{id:string;phase:string;status:string;request_count:number}[];operation:unknown
}
export function ParallelReports({current,account,enabled,children}:{current:HistoricalReport|null;account:string;enabled:boolean;children:ReactNode}){
 const {language}=useI18n(),fr=language==='fr',client=useQueryClient(),[params,setParams]=useSearchParams()
 const experimental=params.get('variant')==='experimental'
 const comparison=params.get('comparison')??''
 const key=['parallel-reports',account,current?.organizationId,current?.id,current?.generationId,...(comparison?[comparison]:[])]
 const launched=useRef(new Set<string>()),launchScope=key.join(':')
 const q=useQuery({queryKey:key,enabled:enabled&&!!current?.generationId,retry:false,refetchInterval:query=>query.state.data?.run&&['queued','running'].includes(query.state.data.run.status)?4000:false,
  queryFn:async()=>{const r=await supabase!.functions.invoke<ParallelView>('parallel-reports',{body:{action:'read',report_id:current!.id,...(comparison?{comparison_id:comparison}:{})}});if(r.error||!r.data||'error' in r.data)throw Error('PARALLEL_READ_FAILED');return r.data}})
 const start=useMutation({retry:false,mutationFn:async()=>{const r=await supabase!.functions.invoke('parallel-reports',{body:{action:'start',report_id:current!.id,generation_id:current!.generationId,confirmed:true}});if(r.error||r.data?.error)throw Error(r.data?.error??'PARALLEL_START_UNCERTAIN');return r.data as ParallelView},
  onSuccess:data=>{client.setQueryData(key,data)},onError:()=>{void client.invalidateQueries({queryKey:key})}})
 const choose=(value:string)=>{const next=new URLSearchParams(params);next.set('variant',value);setParams(next)}
 const t={current:fr?'Rapport actuel':'Báo cáo hiện tại',experimental:fr?'Rapport expérimental':'Báo cáo thử nghiệm',generate:fr?'Générer le rapport expérimental':'Tạo báo cáo thử nghiệm',
  unavailable:fr?'Le corpus figé de ce rapport actuel n’est pas disponible. Aucun import ni autre rapport ne sera lancé automatiquement.':'Không có bộ đánh giá đã đóng băng của báo cáo hiện tại này. Hệ thống không tự nhập hoặc tạo báo cáo khác.',
  missing:fr?'Aucun rapport expérimental pour ce corpus.':'Chưa có báo cáo thử nghiệm cho bộ đánh giá này.',scope:fr?'Périmètre':'Phạm vi',text:fr?'Avis avec texte analysés':'Đánh giá có nội dung đã phân tích',status:fr?'État':'Trạng thái',date:fr?'Généré le':'Ngày tạo',
  note:fr?'Rapport expérimental : JEV puis Sol, sans Luna. Les classements sont automatiques. Les contrôles de références ne constituent pas une validation humaine de la justesse du contenu.':'Báo cáo thử nghiệm: JEV rồi Sol, không qua Luna. Phân loại là tự động. Kiểm tra liên kết không phải xác nhận của con người về tính đúng đắn của nội dung.',
  background:fr?'Vous pouvez quitter l’application : le traitement et la sauvegarde continuent côté serveur.':'Bạn có thể đóng ứng dụng: máy chủ tiếp tục xử lý và lưu kết quả.',
  error:fr?'Lecture ou lancement non confirmé. Vérifiez l’état enregistré ; aucune tentative fournisseur incertaine ne sera renvoyée.':'Chưa xác nhận được trạng thái đọc hoặc khởi chạy. Hãy kiểm tra trạng thái đã lưu; hệ thống không gửi lại lượt gọi nhà cung cấp chưa rõ kết quả.'}
 const date=(v:string|null|undefined)=>v?new Date(v).toLocaleString(fr?'fr-FR':'vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—'
 const states:Record<string,string>=fr?{queued:'En attente',running:'En cours',completed:'Terminé',needs_review:'À réexaminer',invalid_output:'Sortie invalide',blocked:'Bloqué',billing_uncertain:'Issue incertaine',authorization_expired:'Autorisation expirée',generating:'En cours',failed:'Échec'}:{queued:'Đang chờ',running:'Đang xử lý',completed:'Hoàn tất',needs_review:'Cần xem lại',invalid_output:'Kết quả không hợp lệ',blocked:'Bị chặn',billing_uncertain:'Chưa rõ kết quả',authorization_expired:'Ủy quyền hết hạn',generating:'Đang xử lý',failed:'Thất bại'}
 const data=q.data,row=data?.experimental,active=data?.run&&['queued','running'].includes(data.run.status),stats=row?.statistics
 const reference=data?.reference_report?mapHistoricalReport(data.reference_report):null
 const older=data?.versions?.filter(v=>v.reference_generation_id!==current?.generationId)??[]
 const analysed=stats?.scope.analysed_text_reviews??data?.tasks.filter(x=>x.phase==='jev'&&['completed','reused'].includes(x.status)).length??0
 const state=data?.run?.status??row?.state
 const meta=<dl className="parallel-metadata"><div><dt>{t.date}</dt><dd>{date(row?.generated_at)}</dd></div><div><dt>{t.scope}</dt><dd>{stats?.scope.source_reviews??data?.current.source_reviews??current?.storedReviewsCount??'—'}</dd></div><div><dt>{t.text}</dt><dd>{analysed} / {data?.current.text_reviews??'—'}</dd></div><div><dt>{t.status}</dt><dd>{state?states[state]??state:t.missing}</dd></div></dl>
 return <>
  {(older.length>0||comparison)&&<label className="parallel-corpus-label">{fr?'Corpus comparé':'Bộ đánh giá được so sánh'}<select value={comparison} onChange={e=>{const next=new URLSearchParams(params);if(e.target.value)next.set('comparison',e.target.value);else next.delete('comparison');setParams(next)}}><option value="">{fr?'Dernier rapport actuel':'Báo cáo hiện tại mới nhất'}</option>{comparison&&!data?.versions?.some(v=>v.id===comparison)&&<option value={comparison} disabled>{fr?'Archive indisponible':'Bản lưu chưa khả dụng'}</option>}{(data?.versions??[]).map(v=><option key={v.id} value={v.id}>{date(v.generated_at??v.created_at)} — {states[v.state]??v.state}</option>)}</select></label>}
  <div className="parallel-tabs" role="tablist" aria-label={fr?'Variantes du rapport':'Các phiên bản báo cáo'}>
   <button id="current-report-tab" role="tab" aria-selected={!experimental} aria-controls="current-report-panel" onClick={()=>choose('current')}>{t.current}</button>
   <button id="experimental-report-tab" role="tab" aria-selected={experimental} aria-controls="experimental-report-panel" onClick={()=>choose('experimental')}>{t.experimental}</button>
  </div>
  <div id="current-report-panel" role="tabpanel" aria-labelledby="current-report-tab" hidden={experimental}>
   <dl className="parallel-metadata"><div><dt>{t.date}</dt><dd>{date(reference?.generatedAt??current?.generatedAt)}</dd></div><div><dt>{t.scope}</dt><dd>{reference?.storedReviewsCount??current?.storedReviewsCount??'—'}</dd></div><div><dt>{t.text}</dt><dd>{data?.current.text_reviews??'—'}</dd></div><div><dt>{t.status}</dt><dd>{(reference??current)?states[(reference??current)!.aiStatus]??(reference??current)!.aiStatus:'—'}</dd></div></dl>
   {comparison?<>{reference&&(reference.consultant?<ConsultantReport report={reference.consultant}/>:<ReputationReport report={reference}/>)}<p>{fr?'Référence archivée du même corpus. Revenez au dernier rapport actuel pour sa génération.':'Báo cáo tham chiếu đã lưu của cùng bộ đánh giá. Chọn báo cáo hiện tại mới nhất để tạo báo cáo.'}</p></>:children}
  </div>
  <section id="experimental-report-panel" role="tabpanel" aria-labelledby="experimental-report-tab" hidden={!experimental} className="parallel-experimental">
   <h2>{t.experimental}</h2>{meta}
   <button className="primary-button full-width" disabled={!enabled||!data?.corpus_reusable||!!row||start.isPending||start.isError} onClick={()=>{if(!start.isPending&&!row&&!launched.current.has(launchScope)){launched.current.add(launchScope);start.mutate()}}}>{start.isPending||active?(fr?'Traitement en cours':'Đang xử lý'):t.generate}</button>
   {(!current?.generationId||data&&!data.corpus_reusable)&&<p role="status">{t.unavailable}</p>}
   {q.isPending&&enabled&&current?.generationId&&<p role="status">{fr?'Chargement…':'Đang tải…'}</p>}
   {(q.isError||start.isError)&&<p role="alert">{t.error}</p>}
   {active&&<p role="status">{t.background}</p>}
   {!row&&data&&data.corpus_reusable&&<p>{t.missing}</p>}
   {row&&(row.error_code||data?.run?.error_code)&&<p role="alert" className="parallel-audit-id">{row.error_code??data?.run?.error_code}</p>}
   {row&&analysed<(data?.current.text_reviews??analysed)&&<p role="status">{fr?'Couverture partielle : les résultats manquants ne sont pas classés comme neutres ou non mentionnés.':'Phạm vi phân tích chưa đầy đủ: kết quả còn thiếu không được tính là trung lập hoặc không đề cập.'}</p>}
   {row?.derived_report&&<ExperimentalContent row={row} fr={fr}/>}
   <aside className="card parallel-methodology">{t.note}{row?.imported_derivative_id&&<p>{fr?'Version dérivée importée ; le résultat historique invalid_output reste conservé.':'Phiên bản dẫn xuất được nhập; kết quả invalid_output cũ vẫn được giữ nguyên.'}</p>}</aside>
   {row&&<details className="card"><summary>{fr?'Traçabilité et réponse originale':'Nguồn gốc và phản hồi gốc'}</summary><p className="parallel-audit-id">{row.id}</p><details><summary>{fr?'Réponse originale et corrections':'Phản hồi gốc và chỉnh sửa liên kết'}</summary><pre>{JSON.stringify({raw_response:row.raw_response,original_report:row.original_report,corrections:row.corrections,controls:row.controls,usage:row.usage,operation:data?.operation},null,2)}</pre></details></details>}
  </section>
 </>
}
function ExperimentalContent({row,fr}:{row:NonNullable<ParallelView['experimental']>;fr:boolean}){
 const r=row.derived_report!.report,names:Record<string,string>=fr?{service:'Service',price:'Prix',quality:'Qualité des plats et boissons',ambiance:'Ambiance'}:{service:'Dịch vụ',price:'Giá cả',quality:'Chất lượng món ăn và đồ uống',ambiance:'Không gian'}
 const issue=(path:string)=>row.controls?.section_issues?.some(i=>i.path===path)
 const proofs=(ids:string[])=> <details><summary>{fr?'Consulter les avis sources':'Xem đánh giá nguồn'}</summary>{ids.map(id=>{const e=row.controls?.evidence?.find(e=>e.evidence_id===id),s=row.source_reviews.find(s=>s.id===e?.review_id);return <article key={id}><blockquote>{e?.quote??(fr?'Citation à réexaminer':'Cần xem lại trích dẫn')}</blockquote>{s&&<details><summary>{fr?'Avis complet et original':'Toàn bộ đánh giá và bản gốc'}</summary><p>{s.analysis_text}</p><p>{s.original_text}</p></details>}</article>})}</details>
 const section=(s:Section,path:string)=><article className="card parallel-section" key={path}>{s.category&&<h3>{names[s.category]}</h3>}{issue(path)?<p>{fr?'À réexaminer : couverture des preuves insuffisante.':'Cần xem lại: chưa đủ căn cứ.'}</p>:<p>{s.text}</p>}{proofs(s.evidence_ids)}</article>
 return <>
  {row.controls?.technical_checks_passed===false&&<p role="alert">{fr?'Certains contrôles restent non satisfaits. Les sections concernées sont signalées.':'Một số kiểm tra chưa đạt. Các phần liên quan được đánh dấu.'}</p>}
  {row.statistics&&<details className="card"><summary>{fr?'Comptages JEV sur les avis analysés':'Số liệu JEV trên các đánh giá đã phân tích'}</summary><p>{fr?'Un avis mixte contribue aux deux polarités mais reste un seul avis distinct. Ces nombres ne mesurent pas la fréquence d’un incident précis.':'Đánh giá hỗn hợp được tính ở cả hai chiều nhưng vẫn chỉ là một đánh giá riêng biệt. Các số liệu này không phải tần suất của một sự cố cụ thể.'}</p><pre>{JSON.stringify(row.statistics.counts.categories,null,2)}</pre></details>}
  {r.categories.map((s,i)=>section(s,`categories[${i}]`))}
  <h3>{fr?'Aspects positifs':'Điểm tích cực'}</h3>{r.positive_aspects.map((s,i)=>section(s,`positive_aspects[${i}]`))}
  <h3>{fr?'Points d’amélioration':'Điểm cần cải thiện'}</h3>{r.negative_aspects.map((s,i)=>section(s,`negative_aspects[${i}]`))}
  <h3>{fr?'Conclusion':'Kết luận'}</h3>{section(r.conclusion,'conclusion')}
  <h3>{fr?'Recommandations':'Khuyến nghị'}</h3>{r.recommendations.map((s,i)=><article className="card parallel-section" key={i}><h4>{s.title}</h4>{issue(`recommendations[${i}]`)?<p>{fr?'À réexaminer : rattachement des preuves insuffisant.':'Cần xem lại: liên kết căn cứ chưa đầy đủ.'}</p>:<>{s.observations.map((o,j)=><p key={j}><strong>{fr?'Constat rapporté : ':'Nhận xét của khách: '}</strong>{o.text}</p>)}<p><strong>{fr?'Action proposée : ':'Hành động đề xuất: '}</strong>{s.proposed_action}</p><p>{s.priority_reason}</p></>}{proofs(s.evidence_ids)}</article>)}
 </>
}
