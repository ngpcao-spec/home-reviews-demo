import {useEffect, useRef, useState} from 'react'
import {supabase} from '../lib/supabase'
import {useI18n} from '../i18n'

type Job = {request_id: string; status: string}
type MenuResult = {
  counts: {received: number; excludedDrinks: number; retained: number}
  references: {sourceRow: number; classification: string; row: {
    name?: string; description?: string; category?: string; price?: number | null;
    currency?: string; priceText?: string
  }}[]
}
type Snapshot = {job: Job | null; canStart: boolean; result: MenuResult | null}
const active = (job?: Job | null) => ['queued','starting','running','unknown'].includes(job?.status ?? '')

export function RainminerMenuPanel({establishmentId, userId}: {establishmentId: string; userId: string}) {
  const {language} = useI18n()
  const vi = language === 'vi'
  const [snapshot, setSnapshot] = useState<Snapshot>()
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
          setSnapshot(data)
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
    setSending(true)
    setError(false)
    try {
      const requestId = localStorage.getItem(storageKey) ?? crypto.randomUUID()
      localStorage.setItem(storageKey, requestId)
      const {data, error} = await supabase.functions.invoke<{job: Job}>('rainminer-menu', {
        body:{action:'start', establishment_id:establishmentId, request_id:requestId},
      })
      if (error || !data) throw Error('MENU_START_FAILED')
      setSnapshot(current => current && {...current,job:data.job})
    } catch {
      setError(true)
    } finally {
      locked.current = false
      setSending(false)
    }
  }

  if (!supabase) return null
  const result = snapshot?.result
  return <section className="card" style={{padding:'1rem',overflowWrap:'anywhere'}} aria-label={vi?'Món ăn':'Plats du restaurant'}>
    <h2>{vi?'Món ăn':'Plats du restaurant'}</h2>
    <button className="secondary-button full-width" disabled={sending || !snapshot?.canStart || active(snapshot.job)} onClick={() => void start()}>
      {vi?'Lấy danh sách món ăn':'Récupérer les plats'}
    </button>
    <p role="status">{snapshot?.job?.status === 'unknown'
      ? (vi?'Cần xác minh lượt chạy Apify.':'Le lancement Apify doit être vérifié.')
      : active(snapshot?.job) ? (vi?'Đang lấy thực đơn…':'Extraction en cours…')
      : snapshot?.job?.status === 'failed' ? (vi?'Không thể lấy thực đơn.':'L’extraction a échoué.')
      : !snapshot ? (vi?'Đang tải…':'Chargement…') : ''}</p>
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
