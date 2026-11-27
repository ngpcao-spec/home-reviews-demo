import { useEffect } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useApp } from '../app/AppContext'
import { useI18n } from '../i18n'
import type { Establishment } from '../types/domain'

export function ReviewReloadPanel({ establishment }: { establishment: Establishment }) {
  const { refreshInitialImports, currentUser } = useApp()
  const { messages } = useI18n()
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
    if (!pending) return
    // Read only: server workers continue independently of this screen.
    const timer = window.setInterval(() => { void refreshInitialImports() }, 3_000)
    return () => window.clearInterval(timer)
  }, [pending, refreshInitialImports])

  if (!state || state.status === 'idle') return null
  return <section className="card sync-panel" aria-live="polite">
    {pending && <div role="status"><LoaderCircle className="spin" />{messages.reload.pending}<p>{messages.add.importContinues}</p></div>}
    {state.status === 'failed' && <p role="alert" className="field-error">{messages.add.importError}</p>}
    {state.status === 'completed' && <p role="status">{establishment.currentReviewCount === 0 ? messages.reload.emptySuccess : messages.reload.success.replace('{count}', String(establishment.currentReviewCount))}</p>}
  </section>
}
