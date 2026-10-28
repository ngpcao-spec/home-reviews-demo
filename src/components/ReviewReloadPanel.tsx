import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { useI18n } from '../i18n'
import type { Establishment } from '../types/domain'

export function ReviewReloadPanel({ establishment }: { establishment: Establishment }) {
  const { reloadEstablishmentReviews, refreshInitialImports, currentUser, demoMode } = useApp()
  const { messages } = useI18n()
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const locked = useRef(false)
  const requestId = useRef<string | undefined>(undefined)
  const state = establishment.reviewReload
  const pending = state?.status === 'queued' || state?.status === 'running'
  const storageKey = `review-reload:${currentUser.id}:${establishment.id}`

  useEffect(() => {
    if (pending) return
    if (state?.requestId && (state.status === 'completed' || state.status === 'failed')) {
      if (localStorage.getItem(storageKey) === state.requestId) localStorage.removeItem(storageKey)
    }
  }, [pending, state?.requestId, state?.status, storageKey])
  useEffect(() => {
    if (!pending && !waiting) return
    // Read only: server workers continue independently of this screen.
    const timer = window.setInterval(() => { void refreshInitialImports() }, 3_000)
    return () => window.clearInterval(timer)
  }, [pending, waiting, refreshInitialImports])
  useEffect(() => {
    if (pending || state?.requestId && state.requestId === requestId.current) setWaiting(false)
  }, [pending, state?.requestId, waiting])

  async function reload() {
    if (locked.current || pending || demoMode) return
    locked.current = true
    setSending(true); setFailed(false)
    try {
      const key = localStorage.getItem(storageKey) ?? crypto.randomUUID()
      localStorage.setItem(storageKey, key)
      requestId.current = key
      await reloadEstablishmentReviews(establishment.id, key)
      setWaiting(true)
    } catch {
      setFailed(true)
      // Keep this intent after a lost HTTP response: Retry joins it, never silently
      // creates a second run. A known terminal state clears it in the effect above.
    } finally { locked.current = false; setSending(false) }
  }
  const busy = sending || pending || waiting && !failed
  return <section className="card sync-panel" aria-live="polite">
    <h2>{messages.reload.title}</h2><p>{messages.reload.description}</p>
    {busy && <div role="status"><LoaderCircle className="spin" />{messages.reload.pending}<p>{messages.add.importContinues}</p></div>}
    {!busy && (failed || state?.status === 'failed') && <p role="alert" className="field-error">{messages.add.importError}</p>}
    {!busy && state?.status === 'completed' && <p role="status">{establishment.currentReviewCount === 0 ? messages.reload.emptySuccess : messages.reload.success.replace('{count}', String(establishment.currentReviewCount))}</p>}
    <button className="secondary-button full-width" disabled={busy || demoMode} onClick={() => void reload()}>
      {failed || state?.status === 'failed' ? messages.add.retryImport : messages.reload.title}
    </button>
  </section>
}
