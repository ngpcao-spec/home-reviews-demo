import {useEffect,type ReactNode} from 'react'
import {useQuery} from '@tanstack/react-query'
import {useSearchParams} from 'react-router-dom'
import {useI18n} from '../i18n'
import {supabase} from '../lib/supabase'
import type {HistoricalRun} from '../lib/historical-generation'
import {mapHistoricalReport,type HistoricalReport,type HistoricalReportRow} from '../lib/historical-report'
import type {ParallelView} from './ParallelReports'
import {ExperimentalReport} from './ExperimentalReport'
import {ConsultantReport} from './ConsultantReport'
import {ReputationReport} from './ReputationReport'
import './parallel-reports.css'
export interface CurrentReportsView {
 retention?:{policy:{version:string;enabled:boolean};state:{retained_count:number;period_start:string|null;period_end:string|null}|null;scope:{as_of:string;review_count:number;period_start:string;period_end:string;stale:boolean}|null;retired:{generated_at:string|null;review_count:number;period_start:string|null;period_end:string|null;reason:string}|null}|null;
 routing:{engine:'jev_sol_v2'|'sol_legacy';jev_transport?:'individual'|'batch_initial_v1';updated_at:string};current_transport?:'individual'|'batch_initial_v1';legacy_report:HistoricalReportRow|null;
 versions:{id:string;created_at:string;generated_at:string|null;state:string;current_source_run_id:string|null;configuration_version?:string}[];
 batch_progress?:{run_id:string;completed_batches:number;total_batches:number;completed_reviews:number;total_reviews:number;unknown_batches:number;can_resume:boolean;sol_attempts:number}|null;
 request_run?:HistoricalRun|null;
 experimental:ParallelView['experimental'];run:ParallelView['run'];tasks:ParallelView['tasks'];operation:unknown
}
export function CurrentReports({establishmentId,account,enabled,languageKey,current,generating,generationRevision,generationAction,children}:{
 establishmentId:string;account:string;enabled:boolean;languageKey:string|null;current:HistoricalReport|null;generating:boolean;generationRevision?:string;
 generationAction:ReactNode;children:ReactNode}){
 const {language}=useI18n(),fr=language==='fr',[params,setParams]=useSearchParams(),comparison=params.get('comparison')??'';
 const q=useQuery<CurrentReportsView>({queryKey:['current-reports',account,establishmentId,languageKey,comparison],enabled:enabled&&!!languageKey,retry:false,
  refetchInterval:query=>generating||[query.state.data?.request_run,query.state.data?.run].some(r=>r&&['queued','running','retry'].includes(r.status))?4000:query.state.data?.retention?30000:false,
  queryFn:async()=>{const r=await supabase!.functions.invoke('parallel-reports',{body:{action:'read_current',establishment_id:establishmentId,...(comparison?{comparison_id:comparison}:{})}});if(r.error||!r.data||r.data.error)throw Error('CURRENT_REPORT_READ_FAILED');return r.data}})
 useEffect(()=>{if(enabled)void q.refetch()},[enabled,generationRevision]) // eslint-disable-line react-hooks/exhaustive-deps
 const data=q.data,row=data?.experimental,v2=data?.routing.engine==='jev_sol_v2',legacy=data?.legacy_report?mapHistoricalReport(data.legacy_report):current,retention=data?.retention;
 const archive=!retention&&(params.get('variant')==='legacy'||!!comparison);
 const date=(value:string|null|undefined)=>value?new Date(value).toLocaleString(fr?'fr-FR':'vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
 const statuses:Record<string,string>=fr?{queued:'En attente',running:'En cours',completed:'Terminé',needs_review:'À réexaminer',invalid_output:'Sortie invalide',blocked:'Bloqué',failed:'Échec',billing_uncertain:'Issue incertaine',authorization_expired:'Autorisation expirée'}:{queued:'Đang chờ',running:'Đang xử lý',completed:'Hoàn tất',needs_review:'Cần xem lại',invalid_output:'Kết quả không hợp lệ',blocked:'Bị chặn',failed:'Thất bại',billing_uncertain:'Chưa rõ kết quả',authorization_expired:'Ủy quyền hết hạn'};
 const stages:Record<string,string>=fr?{preparing:'Préparation du corpus et du lancement',jev:'Classification JEV',prepare_evidence:'Préparation des preuves',measure_sol:'Préparation du rapport',sol:'Rédaction Sol',validate_sol:'Contrôles et sauvegarde',completed:'Rapport enregistré'}:{preparing:'Chuẩn bị bộ đánh giá và khởi chạy',jev:'Phân loại JEV',prepare_evidence:'Chuẩn bị bằng chứng',measure_sol:'Chuẩn bị báo cáo',sol:'Soạn báo cáo Sol',validate_sol:'Kiểm tra và lưu',completed:'Đã lưu báo cáo'};
 const switchTab=(old:boolean)=>{const next=new URLSearchParams(params);next.delete('comparison');next.set('variant',old?'legacy':'current');setParams(next)};
 const choose=(id:string)=>{const next=new URLSearchParams(params);next.set('variant','legacy');if(id)next.set('comparison',id);else next.delete('comparison');setParams(next)};
 const currentRun=data?.request_run??data?.run;
 const requestRun=data?.request_run;
 const batch=archive||!requestRun?data?.batch_progress:requestRun.progress_unit==='jev_batches'?{
  run_id:requestRun.batch_run_id!,completed_batches:requestRun.progress,total_batches:requestRun.total_steps??0,
  completed_reviews:requestRun.completed_reviews??0,total_reviews:requestRun.total_reviews??0,
  unknown_batches:requestRun.unknown_batches??0,can_resume:requestRun.can_resume===true,sol_attempts:requestRun.sol_attempts??0}:null;
 const progressRun=archive?data?.run:currentRun;
 const batchProgress=batch&&<div role="status" data-request-id={archive?undefined:requestRun?.request_id} data-batch-run-id={batch.run_id}><p>{!archive||row?.current_source_run_id?(fr?'JEV par lots · prompt initial':'JEV theo nhóm · hướng dẫn ban đầu'):(fr?'Essai JEV par lots · prompt initial':'Thử nghiệm JEV theo nhóm · hướng dẫn ban đầu')} : {batch.completed_batches} / {batch.total_batches} {fr?'lots':'nhóm'} · {batch.completed_reviews} / {batch.total_reviews} {fr?'avis':'đánh giá'}. {progressRun?.stage&&stages[progressRun.stage]}</p>{batch.unknown_batches>0&&<p>{fr?'Une tentative au résultat inconnu est conservée sans renvoi automatique.':'Lượt gọi chưa rõ kết quả được giữ nguyên, không tự gửi lại.'}</p>}{batch.can_resume&&<button className="secondary-button" onClick={async()=>{await supabase!.functions.invoke('jev-batch-experiment',{body:{action:'resume',run_id:batch.run_id}});void q.refetch()}}>{fr?'Poursuivre les étapes non commencées':'Tiếp tục các bước chưa bắt đầu'}</button>}</div>;
 const method=fr?'JEV (classements automatiques), puis Sol compact, sans Luna. Les contrôles techniques ne constituent pas une validation humaine du contenu.':'JEV phân loại tự động, sau đó Sol với bộ dữ liệu gọn, không qua Luna. Kiểm tra kỹ thuật không phải xác nhận nội dung của con người.';
 const legacyReport=legacy?.consultant?<ConsultantReport report={legacy.consultant}/>:legacy?<ReputationReport report={legacy}/>:children;
 const meta=(source:NonNullable<typeof row>)=><dl className="parallel-metadata" data-report-id={source.id} data-source-run-id={source.current_source_run_id??undefined}><div><dt>{fr?'Généré le':'Ngày tạo'}</dt><dd>{date(source.generated_at)}</dd></div><div><dt>{fr?'Avis du corpus daté':'Đánh giá trong bộ dữ liệu đã chốt'}</dt><dd>{source.statistics?.scope.source_reviews??source.source_reviews.length}</dd></div><div><dt>{fr?'Textes analysés à cette date':'Nội dung đã phân tích tại thời điểm đó'}</dt><dd>{source.statistics?.scope.analysed_text_reviews??'—'} / {retention?.scope?.review_count??source.source_reviews.length}</dd></div><div><dt>{fr?'État du rapport disponible':'Trạng thái báo cáo hiện có'}</dt><dd>{retention?.scope?.stale?(fr?'À actualiser':'Cần cập nhật'):statuses[source.state]??source.state}</dd></div></dl>;
 if(!enabled&&!data)return <>{generationAction}{children}</>;
 return <>
  {generationAction}
  {q.isError&&<div role="alert"><p>{fr?'Impossible de lire les rapports enregistrés. Aucun lancement automatique.':'Không thể đọc báo cáo đã lưu. Không tự động khởi chạy.'}</p><button className="secondary-button" onClick={()=>void q.refetch()}>{fr?'Actualiser l’état (sans appel IA)':'Làm mới trạng thái (không gọi AI)'}</button></div>}
  {q.isPending&&<p role="status">{fr?'Lecture des rapports…':'Đang tải báo cáo…'}</p>}
  {data&&<>
   {row&&retention?.scope?.stale&&<p role="status" className="card">{fr?'À actualiser — ce rapport daté décrit son ancien corpus, pas les avis actuellement disponibles. Il reste consultable jusqu’à une nouvelle génération réussie.':'Cần cập nhật — báo cáo có ngày này mô tả bộ đánh giá cũ, không phải nội dung hiện có. Báo cáo được giữ đến khi tạo báo cáo mới thành công.'}</p>}
   {retention&&<section className="card" aria-label={fr?'Périmètre du corpus':'Phạm vi bộ đánh giá'}><p>{fr?'Les 150 derniers avis uniques, avec ou sans texte, toutes notes confondues, sans limite d’ancienneté.':'150 đánh giá duy nhất mới nhất, có hoặc không có nội dung, mọi mức sao, không giới hạn thời gian.'}</p><p>{fr?'Corpus disponible':'Bộ đánh giá hiện có'} : {retention.state?.retained_count??0} {fr?'avis':'đánh giá'} · {date(retention.state?.period_start)} → {date(retention.state?.period_end)}.</p>{retention.scope&&<p>{fr?'Rapport figé au':'Báo cáo chốt lúc'} {date(retention.scope.as_of)} · {retention.scope.review_count} {fr?'avis publiés du':'đánh giá đăng từ'} {date(retention.scope.period_start)} → {date(retention.scope.period_end)}. {retention.scope.stale&&(fr?'Le corpus a changé : ce rapport n’est pas actualisé automatiquement.':'Bộ đánh giá đã thay đổi; báo cáo này không tự cập nhật.')}</p>}{(retention.scope?.review_count??retention.state?.retained_count??0)<10&&<p>{fr?'Peu de témoignages : les constats sont limités à ces retours et ne représentent pas tous les clients.':'Ít phản hồi: nhận định chỉ giới hạn trong những lời kể này, không đại diện cho mọi khách hàng.'}</p>}{!retention.state?.retained_count&&<p>{fr?'Aucun avis disponible.':'Chưa có đánh giá.'}</p>}{retention.retired&&!row&&<p>{fr?'Le périmètre du dernier rapport a expiré ; son contenu a été supprimé. Rapport du':'Phạm vi báo cáo trước đã hết hạn; nội dung đã được xóa. Báo cáo ngày'} {date(retention.retired.generated_at)} · {retention.retired.review_count} {fr?'avis':'đánh giá'} · {date(retention.retired.period_start)} → {date(retention.retired.period_end)}.</p>}<small>{fr?'Les statistiques portent uniquement sur ce corpus. JEV analyse les commentaires textuels ; les notes par rubrique comptent seulement les valeurs renseignées.':'Thống kê chỉ thuộc bộ đánh giá này. JEV chỉ phân tích nội dung; điểm theo nhóm chỉ tính giá trị được cung cấp.'}</small></section>}
   <p className="v5-muted">{v2?(data.current_transport==='batch_initial_v1'?(fr?'Parcours V2 de cette demande : JEV par lots → Sol compact, sans Luna.':'Quy trình V2 của yêu cầu này: JEV theo nhóm → Sol với bộ dữ liệu gọn, không qua Luna.'):(fr?'Parcours courant V2 : JEV court → Sol compact, sans Luna.':'Quy trình hiện tại V2: JEV ngắn → Sol với bộ dữ liệu gọn, không qua Luna.')):(fr?'Parcours de retour arrière : Sol seul. Aucun basculement automatique en cas d’erreur.':'Quy trình dự phòng: chỉ Sol. Không tự động chuyển quy trình khi có lỗi.')}</p>
   <div className="parallel-tabs" role="tablist" aria-label={fr?'Versions du rapport':'Các phiên bản báo cáo'}>
    <button id="current-report-tab" role="tab" aria-selected={!archive} aria-controls="current-report-panel" onClick={()=>switchTab(false)}>{fr?'Rapport courant':'Báo cáo hiện tại'}{v2?' · V2':' · Sol'}</button>
    {!retention&&<button id="archive-report-tab" role="tab" aria-selected={archive} aria-controls="archive-report-panel" onClick={()=>switchTab(true)}>{fr?'Rapports précédents':'Báo cáo trước đây'}</button>}
   </div>
   <section id="current-report-panel" role="tabpanel" aria-labelledby="current-report-tab" hidden={archive}>
    {!v2?legacyReport:<>
     {row&&meta(row)}
     {row&&requestRun&&row.current_source_run_id!==requestRun.source_run_id&&<p className="v5-muted">{fr?'Rapport précédent disponible. Il est distinct de la nouvelle demande ci-dessous.':'Báo cáo trước đây vẫn có sẵn, tách biệt với yêu cầu mới bên dưới.'}</p>}
     {requestRun?.request_id&&<p className="v5-muted" data-current-request-id={requestRun.request_id}>{fr?'Demande':'Yêu cầu'} {requestRun.request_id.slice(0,8)} · {date(requestRun.created_at)} · {statuses[requestRun.status]??requestRun.status}</p>}
     {!archive&&batchProgress}
     {currentRun&&['queued','running','retry'].includes(currentRun.status)&&<p role="status">{currentRun.stage&&stages[currentRun.stage]||(fr?'Traitement serveur':'Máy chủ đang xử lý')}. {fr?'Vous pouvez fermer l’application.':'Bạn có thể đóng ứng dụng.'}</p>}
     {currentRun?.error_code&&<p role="alert">{statuses[currentRun.status]??currentRun.status} : <span className="parallel-audit-id">{currentRun.error_code}</span></p>}
     {!row&&!currentRun&&<p>{fr?'Aucun rapport disponible pour ce corpus.':'Chưa có báo cáo cho bộ đánh giá này.'}</p>}
     {row&&<><p className="v5-muted">{row.controls?.dated_publication?(fr?'Dernier rapport V2 daté, conservé sans actualisation automatique.':'Báo cáo V2 có ngày gần nhất, không tự động cập nhật.'):row.current_source_run_id?(fr?'Génération V2 courante.':'Báo cáo được tạo theo V2 hiện tại.'):(fr?'Génération expérimentale V2 antérieure, conservée sans recalcul.':'Bản V2 thử nghiệm trước đây, giữ nguyên không tính lại.')}</p><ExperimentalReport key={row.id} row={row} operation={data.operation} methodology={method}/></>}
    </>}
   </section>
   {!retention&&<section id="archive-report-panel" role="tabpanel" aria-labelledby="archive-report-tab" hidden={!archive}>
    <label className="parallel-corpus-label">{fr?'Version archivée':'Phiên bản đã lưu'}<select aria-label={fr?'Version archivée':'Phiên bản đã lưu'} value={comparison} onChange={e=>choose(e.target.value)}><option value="">{fr?'Ancien rapport · Sol seul':'Báo cáo cũ · chỉ Sol'}</option>{data.versions.map(v=><option value={v.id} key={v.id}>{v.configuration_version==='jev-multi-review-initial-v1'?(v.current_source_run_id?(fr?'V2 · JEV par lots':'V2 · JEV theo nhóm'):(fr?'Essai JEV par lots':'Thử nghiệm JEV theo nhóm')):v.current_source_run_id?'V2':fr?'Essai V2 archivé':'V2 thử nghiệm đã lưu'} — {date(v.generated_at??v.created_at)} — {statuses[v.state]??v.state}</option>)}</select></label>
    {comparison&&row?<>{meta(row)}{batchProgress}<ExperimentalReport key={'archive:'+row.id} row={row} operation={data.operation} methodology={method}/>{!row.current_source_run_id&&row.source_report?.consultant_report&&<details className="card"><summary>{fr?'Rapport Sol de référence du même corpus':'Báo cáo Sol tham chiếu của cùng bộ đánh giá'}</summary><ConsultantReport report={row.source_report.consultant_report}/></details>}</>:<><p className="v5-muted">{fr?'Rapport historique Sol, conservé avec sa provenance.':'Báo cáo Sol cũ được giữ nguyên cùng nguồn gốc.'} {date(legacy?.generatedAt)}</p>{legacyReport}</>}
   </section>}
  </>}
 </>
}

