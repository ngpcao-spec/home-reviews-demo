import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { useI18n } from '../i18n'
import type { Establishment } from '../types/domain'

export function ReviewCollectionAlert({ establishment }: { establishment: Establishment }) {
  const { retryEstablishmentImport, refreshInitialImports } = useApp()
  const { messages } = useI18n()
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const locked = useRef(false)
  const pending = establishment.reviewCollection?.status === 'retrying'
  const partial = establishment.reviewCollection?.status === 'partial'

  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => { void refreshInitialImports() }, 3_000)
    return () => window.clearInterval(timer)
  }, [pending, refreshInitialImports])

  async function retry() {
    if (locked.current || pending || !establishment.initialImportJobId) return
    locked.current = true
    setSending(true)
    setFailed(false)
    try {
      await retryEstablishmentImport(establishment.initialImportJobId)
    } catch {
      // Native errors stay in server logs. Locale is evaluated at render time.
      setFailed(true)
    } finally {
      locked.current = false
      setSending(false)
    }
  }

  if ((!partial && !pending) || ['queued','running','failed'].includes(establishment.reviewReload?.status ?? '')) return null
  return <section className="card sync-panel" aria-live="polite">
    {pending
      ? <div role="status"><LoaderCircle className="spin" /><p>{messages.add.importing}</p><p>{messages.add.importContinues}</p></div>
      : <p className="field-error" role="alert">{messages.add.importError}</p>}
    {failed && pending && <p role="alert">{messages.add.importError}</p>}
    <button className="primary-button full-width" disabled={sending || pending || !establishment.initialImportJobId} onClick={() => void retry()}>
      {sending ? <LoaderCircle className="spin" /> : null}
      {sending || pending ? messages.add.retrying : messages.add.retryImport}
    </button>
  </section>
}
