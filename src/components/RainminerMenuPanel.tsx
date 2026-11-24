import {useEffect, useRef, useState} from 'react'
import {supabase} from '../lib/supabase'
import {useI18n} from '../i18n'

type Job = {request_id?: string; status: string; error_code?: string; trigger_kind?: string}
type MenuResult = {
  provenance?: {retrievedAt?: string; finishedAt?: string}
  counts: {received: number; excludedDrinks: number; retained: number}
  references: {sourceRow: number; classification: string; row: {
    name?: string; description?: string; category?: string; price?: number | null;
    currency?: string; priceText?: string
  }}[]
}
type Snapshot = {job: Job | null; canStart: boolean; result: MenuResult | null; maxCostUsd?: number; launchBlock?: string}
const active = (job?: Job | null) => ['queued','starting','running','unknown'].includes(job?.status ?? '')

export function RainminerMenuPanel({establishmentId, userId}: {establishmentId: string; userId: string}) {
  const {language} = useI18n()
  const vi = language === 'vi'
  const [loaded, setSnapshot] = useState<(Snapshot & {scope:string})>()
  const snapshot = loaded?.scope === establishmentId ? loaded : undefined
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)
  const locked = useRef(false)
  const storageKey = `rainminer-menu:${userId}:${establishmentId}`

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let disposed = false
    let timer: number
    async function refresh() {
      try {
        const {data, error} = await client.functions.invoke<Snapshot>('rainminer-menu', {
          body:{action:'status', establishment_id:establishmentId},
        })
        if (disposed) return
        if (!error && data) {
          setSnapshot({...data,scope:establishmentId})
          if (data.job && !active(data.job) && localStorage.getItem(storageKey) === data.job.request_id)
            localStorage.removeItem(storageKey)
        }
      } catch {
        // A failed read does not change the server job or clear its request ID.
      } finally {
        if (!disposed) timer = window.setTimeout(() => void refresh(), 5000)
      }
    }
    void refresh()
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [establishmentId, storageKey])

  async function start() {
    if (!supabase || locked.current || !snapshot?.canStart || active(snapshot.job)) return
    locked.current = true
    if (!window.confirm(vi
      ? `Bắt đầu một lượt trích xuất có tính phí, tối đa ${snapshot.maxCostUsd ?? 0.5} USD?`
      : `Lancer une nouvelle extraction payante, plafonnée à ${snapshot.maxCostUsd ?? 0.5} USD ?`)) {
      locked.current = false
      return
    }
    setSending(true)
    setError(false)
    try {
      const requestId = localStorage.getItem(storageKey) ?? crypto.randomUUID()
      localStorage.setItem(storageKey, requestId)
      const {data, error} = await supabase.functions.invoke<{job: Job}>('rainminer-menu', {
        body:{action:'start', establishment_id:establishmentId, request_id:requestId, confirm_paid:true},
      })
      if (error || !data) throw Error('MENU_START_FAILED')
      setSnapshot(current => current?.scope === establishmentId ? {...current,job:data.job} : current)
    } catch {
      setError(true)
    } finally {
      locked.current = false
      setSending(false)
    }
  }

  if (!supabase) return null
  const result = snapshot?.result
  const job = snapshot?.job
  const needsReview = job?.status === 'unknown' || ['MENU_PLACE_ID_REQUIRED','MENU_COST_CEILING_BREACHED'].includes(job?.error_code ?? '')
  const status = !snapshot ? (vi?'Đang tải…':'Chargement…')
    : needsReview ? (vi?'Cần xác minh':'Vérification nécessaire')
    : job?.status === 'queued' ? (vi?'Đang chờ':'En attente')
    : ['starting','running'].includes(job?.status ?? '') ? (vi?'Đang lấy thực đơn…':'Extraction en cours…')
    : job?.status === 'failed' ? (vi?'Trích xuất thất bại':'Extraction échouée')
    : result ? (result.counts.retained>0 ? (vi?'Đã có thực đơn':'Menu disponible') : (vi?'Không tìm thấy món ăn':'Aucun plat trouvé'))
    : (vi?'Chưa lấy thực đơn':'Menu non récupéré')
  const collectedAt = result?.provenance?.retrievedAt ?? result?.provenance?.finishedAt
  const blocked = job?.error_code ?? snapshot?.launchBlock
  return <section className="card" style={{padding:'1rem',overflowWrap:'anywhere'}} aria-label={vi?'Món ăn':'Plats du restaurant'}>
    <h2>{vi?'Món ăn':'Plats du restaurant'}</h2>
    <p role="status">{status}</p>
    {job?.status === 'unknown' && <p>{vi?'Lượt chạy phải được xác minh trước khi thử lại.':'Le lancement doit être vérifié avant toute relance.'}</p>}
    {job?.error_code === 'MENU_PLACE_ID_REQUIRED' && <p>{vi?'Chưa có mã Google Place ID hợp lệ.':'Identifiant Google Place ID absent ou invalide.'}</p>}
    {blocked === 'MENU_BUDGET_LIMIT' && <p>{vi?'Đã đạt hạn mức chi phí.':'Plafond de dépenses atteint.'}</p>}
    {blocked === 'MENU_COST_CEILING_UNVERIFIED' && <p>{vi?'Chưa xác minh được giới hạn chi phí. Đã chặn lượt chạy mới.':'Plafond fournisseur non vérifié. Nouveaux lancements bloqués.'}</p>}
    {job?.status === 'queued' && ['MENU_LAUNCHES_DISABLED','MENU_AUTOMATIC_DISABLED'].includes(blocked ?? '') && <p>{vi?'Tự động trích xuất đang tạm dừng.':'Lancement automatique en pause.'}</p>}
    {collectedAt && Number.isFinite(Date.parse(collectedAt)) && <p>{vi?'Ngày thu thập: ':'Récupéré le '}{new Intl.DateTimeFormat(vi?'vi-VN':'fr-FR',{dateStyle:'medium'}).format(new Date(collectedAt))}</p>}
    <button className="secondary-button full-width" disabled={sending || !snapshot?.canStart || active(snapshot.job)} onClick={() => void start()}>
      {vi?'Lấy danh sách món ăn':'Récupérer les plats'}
    </button>
    {error && <p role="alert">{vi?'Chưa xác nhận yêu cầu. Hãy thử lại.':'Demande non confirmée. Vous pouvez réessayer.'}</p>}
    {result && <>
      <p>{vi
        ? `${result.counts.received} dòng nhận được · ${result.counts.excludedDrinks} đồ uống loại bỏ · ${result.counts.retained} món giữ lại`
        : `${result.counts.received} lignes reçues · ${result.counts.excludedDrinks} boissons exclues · ${result.counts.retained} références conservées`}</p>
      <ul style={{paddingInlineStart:'1.25rem'}}>
        {result.references.map(({sourceRow,classification,row}) => <li key={sourceRow}>
          <strong>{row.name || (vi?'Chưa rõ tên':'Nom non renseigné')}</strong>
          {classification === 'review' && <small> · {vi?'Cần kiểm tra':'À examiner'}</small>}
          {row.category && <div>{row.category}</div>}
          {row.description && <div>{row.description}</div>}
          <div>{row.priceText || (row.price == null ? (vi?'Chưa có giá':'Prix non renseigné') : [row.price,row.currency].filter(value => value != null).join(' '))}</div>
        </li>)}
      </ul>
    </>}
  </section>
}
