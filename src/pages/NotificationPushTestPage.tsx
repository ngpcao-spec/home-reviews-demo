import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Status = 'sending' | 'sent' | 'error'

export function NotificationPushTestPage() {
  const { type } = useParams<{ type: string }>()
  const started = useRef(false)
  const [status, setStatus] = useState<Status>('sending')
  const [error, setError] = useState('')

  useEffect(() => {
    if (started.current) return
    started.current = true

    const testType = type === 'deep-link' ? 'deep_link' : type === 'simple' ? 'simple' : null
    if (!testType || !supabase) {
      setError('Test push invalide ou Supabase indisponible.')
      setStatus('error')
      return
    }

    const storageKey = `home-reviews-push-test-${testType}`
    let idempotencyKey = sessionStorage.getItem(storageKey)
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID()
      sessionStorage.setItem(storageKey, idempotencyKey)
    }

    void supabase.functions.invoke('send-test-push', {
      body: { test_type: testType, idempotency_key: idempotencyKey },
    }).then(({ data, error: invokeError }) => {
      if (invokeError || !data?.ok) {
        setError(data?.error || invokeError?.message || 'Échec de l’envoi push.')
        setStatus('error')
        return
      }
      setStatus('sent')
    })
  }, [type])

  return <section className="page page-with-nav">
    <div className="section-heading">
      <div>
        <span className="eyebrow">Test interne</span>
        <h1>{type === 'deep-link' ? 'Push vers un avis' : 'Push simple'}</h1>
      </div>
    </div>
    <div className="card empty-card" role="status" aria-live="polite">
      {status === 'sending' && <><h2>Envoi en cours…</h2><p>La notification est envoyée une seule fois.</p></>}
      {status === 'sent' && <><h2>Push envoyé</h2><p>Quittez HOME Reviews, puis touchez la notification reçue pour vérifier son ouverture.</p></>}
      {status === 'error' && <><h2>Échec du test</h2><p>{error}</p></>}
    </div>
  </section>
}
