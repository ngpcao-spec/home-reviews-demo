import {useEffect,type ReactNode} from 'react'
import {useQuery} from '@tanstack/react-query'
import {useSearchParams} from 'react-router-dom'
import {useI18n} from '../i18n'
import {supabase} from '../lib/supabase'
import {mapHistoricalReport,type HistoricalReport,type HistoricalReportRow} from '../lib/historical-report'
import type {ParallelView} from './ParallelReports'
import {ExperimentalReport} from './ExperimentalReport'
import {ConsultantReport} from './ConsultantReport'
import {ReputationReport} from './ReputationReport'
import './parallel-reports.css'
export interface CurrentReportsView {
 routing:{engine:'jev_sol_v2'|'sol_legacy';updated_at:string};legacy_report:HistoricalReportRow|null;
 versions:{id:string;created_at:string;generated_at:string|null;state:string;current_source_run_id:string|null}[];
 experimental:ParallelView['experimental'];run:ParallelView['run'];tasks:ParallelView['tasks'];operation:unknown
}
export function CurrentReports({establishmentId,account,enabled,languageKey,current,generating,generationRevision,generationAction,children}:{
 establishmentId:string;account:string;enabled:boolean;languageKey:string|null;current:HistoricalReport|null;generating:boolean;generationRevision?:string;
 generationAction:ReactNode;children:ReactNode}){
 const {language}=useI18n(),fr=language==='fr',[params,setParams]=useSearchParams(),comparison=params.get('comparison')??'';
 const archive=params.get('variant')==='legacy'||!!comparison;
 const q=useQuery<CurrentReportsView>({queryKey:['current-reports',account,establishmentId,languageKey,comparison],enabled:enabled&&!!languageKey,retry:false,
  refetchInterval:query=>generating||query.state.data?.run&&['queued','running','retry'].includes(query.state.data.run.status)?4000:false,
  queryFn:async()=>{const r=await supabase!.functions.invoke('parallel-reports',{body:{action:'read_current',establishment_id:establishmentId,...(comparison?{comparison_id:comparison}:{})}});if(r.error||!r.data||r.data.error)throw Error('CURRENT_REPORT_READ_FAILED');return r.data}})
 useEffect(()=>{if(enabled)void q.refetch()},[enabled,generationRevision]) // eslint-disable-line react-hooks/exhaustive-deps
 const data=q.data,row=data?.experimental,v2=data?.routing.engine==='jev_sol_v2',legacy=data?.legacy_report?mapHistoricalReport(data.legacy_report):current;
 const date=(value:string|null|undefined)=>value?new Date(value).toLocaleString(fr?'fr-FR':'vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
 const statuses:Record<string,string>=fr?{queued:'En attente',running:'En cours',completed:'Terminé',needs_review:'À réexaminer',invalid_output:'Sortie invalide',blocked:'Bloqué',failed:'Échec',billing_uncertain:'Issue incertaine',authorization_expired:'Autorisation expirée'}:{queued:'Đang chờ',running:'Đang xử lý',completed:'Hoàn tất',needs_review:'Cần xem lại',invalid_output:'Kết quả không hợp lệ',blocked:'Bị chặn',failed:'Thất bại',billing_uncertain:'Chưa rõ kết quả',authorization_expired:'Ủy quyền hết hạn'};
 const stages:Record<string,string>=fr?{preparing:'Préparation du corpus et du lancement',jev:'Classification JEV',prepare_evidence:'Préparation des preuves',sol:'Rédaction Sol',validate_sol:'Contrôles et sauvegarde'}:{preparing:'Chuẩn bị bộ đánh giá và khởi chạy',jev:'Phân loại JEV',prepare_evidence:'Chuẩn bị bằng chứng',sol:'Soạn báo cáo Sol',validate_sol:'Kiểm tra và lưu'};
 const switchTab=(old:boolean)=>{const next=new URLSearchParams(params);next.delete('comparison');next.set('variant',old?'legacy':'current');setParams(next)};
 const choose=(id:string)=>{const next=new URLSearchParams(params);next.set('variant','legacy');if(id)next.set('comparison',id);else next.delete('comparison');setParams(next)};
 const method=fr?'JEV (classements automatiques), puis Sol compact, sans Luna. Les contrôles techniques ne constituent pas une validation humaine du contenu.':'JEV phân loại tự động, sau đó Sol với bộ dữ liệu gọn, không qua Luna. Kiểm tra kỹ thuật không phải xác nhận nội dung của con người.';
 const legacyReport=legacy?.consultant?<ConsultantReport report={legacy.consultant}/>:legacy?<ReputationReport report={legacy}/>:children;
 const meta=(source:NonNullable<typeof row>)=><dl className="parallel-metadata"><div><dt>{fr?'Généré le':'Ngày tạo'}</dt><dd>{date(source.generated_at)}</dd></div><div><dt>{fr?'Avis du corpus':'Đánh giá trong bộ dữ liệu'}</dt><dd>{source.statistics?.scope.source_reviews??source.source_reviews.length}</dd></div><div><dt>{fr?'Textes analysés':'Nội dung đã phân tích'}</dt><dd>{source.statistics?.scope.analysed_text_reviews??'—'} / {source.source_reviews.filter(r=>r.analysis_text?.trim()).length}</dd></div><div><dt>{fr?'État':'Trạng thái'}</dt><dd>{statuses[data?.run?.status??source.state]??source.state}</dd></div></dl>;
 if(!enabled&&!data)return <>{generationAction}{children}</>;
 return <>
  {generationAction}
  {q.isError&&<div role="alert"><p>{fr?'Impossible de lire les rapports enregistrés. Aucun lancement automatique.':'Không thể đọc báo cáo đã lưu. Không tự động khởi chạy.'}</p><button className="secondary-button" onClick={()=>void q.refetch()}>{fr?'Actualiser l’état (sans appel IA)':'Làm mới trạng thái (không gọi AI)'}</button></div>}
  {!data&&current&&<section><h2>{fr?'Rapport précédent conservé':'Báo cáo trước đây đã lưu'}</h2>{children}</section>}
  {q.isPending&&<p role="status">{fr?'Lecture des rapports…':'Đang tải báo cáo…'}</p>}
  {data&&<>
   <p className="v5-muted">{v2?(fr?'Parcours courant V2 : JEV court → Sol compact, sans Luna.':'Quy trình hiện tại V2: JEV ngắn → Sol với bộ dữ liệu gọn, không qua Luna.'):(fr?'Parcours de retour arrière : Sol seul. Aucun basculement automatique en cas d’erreur.':'Quy trình dự phòng: chỉ Sol. Không tự động chuyển quy trình khi có lỗi.')}</p>
   <div className="parallel-tabs" role="tablist" aria-label={fr?'Versions du rapport':'Các phiên bản báo cáo'}>
    <button id="current-report-tab" role="tab" aria-selected={!archive} aria-controls="current-report-panel" onClick={()=>switchTab(false)}>{fr?'Rapport courant':'Báo cáo hiện tại'}{v2?' · V2':' · Sol'}</button>
    <button id="archive-report-tab" role="tab" aria-selected={archive} aria-controls="archive-report-panel" onClick={()=>switchTab(true)}>{fr?'Rapports précédents':'Báo cáo trước đây'}</button>
   </div>
   <section id="current-report-panel" role="tabpanel" aria-labelledby="current-report-tab" hidden={archive}>
    {!v2?legacyReport:<>
     {row&&meta(row)}
     {data.run&&['queued','running','retry'].includes(data.run.status)&&<p role="status">{stages[data.run.stage]??(fr?'Traitement serveur':'Máy chủ đang xử lý')}. {fr?'Vous pouvez fermer l’application.':'Bạn có thể đóng ứng dụng.'}</p>}
     {data.run?.error_code&&<p role="alert">{statuses[data.run.status]??data.run.status} : <span className="parallel-audit-id">{data.run.error_code}</span></p>}
     {!row&&!data.run&&<p>{fr?'Aucun rapport V2 pour cet établissement. Les rapports précédents sont conservés dans l’autre onglet.':'Cơ sở này chưa có báo cáo V2. Báo cáo trước đây vẫn được lưu ở thẻ bên cạnh.'}</p>}
     {row&&<><p className="v5-muted">{row.current_source_run_id?(fr?'Génération V2 courante.':'Báo cáo được tạo theo V2 hiện tại.'):(fr?'Génération expérimentale V2 antérieure, conservée sans recalcul.':'Bản V2 thử nghiệm trước đây, giữ nguyên không tính lại.')}</p><ExperimentalReport key={row.id} row={row} operation={data.operation} methodology={method}/></>}
    </>}
   </section>
   <section id="archive-report-panel" role="tabpanel" aria-labelledby="archive-report-tab" hidden={!archive}>
    <label className="parallel-corpus-label">{fr?'Version archivée':'Phiên bản đã lưu'}<select aria-label={fr?'Version archivée':'Phiên bản đã lưu'} value={comparison} onChange={e=>choose(e.target.value)}><option value="">{fr?'Ancien rapport · Sol seul':'Báo cáo cũ · chỉ Sol'}</option>{data.versions.map(v=><option value={v.id} key={v.id}>{v.current_source_run_id?'V2':fr?'Essai V2 archivé':'V2 thử nghiệm đã lưu'} — {date(v.generated_at??v.created_at)} — {statuses[v.state]??v.state}</option>)}</select></label>
    {comparison&&row?<>{meta(row)}<ExperimentalReport key={'archive:'+row.id} row={row} operation={data.operation} methodology={method}/>{!row.current_source_run_id&&row.source_report?.consultant_report&&<details className="card"><summary>{fr?'Rapport Sol de référence du même corpus':'Báo cáo Sol tham chiếu của cùng bộ đánh giá'}</summary><ConsultantReport report={row.source_report.consultant_report}/></details>}</>:<><p className="v5-muted">{fr?'Rapport historique Sol, conservé avec sa provenance.':'Báo cáo Sol cũ được giữ nguyên cùng nguồn gốc.'} {date(legacy?.generatedAt)}</p>{legacyReport}</>}
   </section>
  </>}
 </>
}
