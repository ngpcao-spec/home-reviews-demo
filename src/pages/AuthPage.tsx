import { useState,useRef } from 'react'
import { getGoogleOAuthOptions } from '../lib/auth-redirect'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {authStartupError} from '../lib/auth-session'

function GoogleMark() {
  return <span className="google-mark" aria-hidden="true">G</span>
}

export function AuthPage() {
  const [error, setError] = useState(authStartupError)
  const [busy, setBusy] = useState(false)
  const starting=useRef(false)

  const continueWithGoogle = async () => {
    if(starting.current)return
    setError('')
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase n’est pas configuré pour ce déploiement.')
      return
    }

    setBusy(true)
    starting.current=true
    try {
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: getGoogleOAuthOptions(),
    })

    if (oauthError) {
      setError('Impossible de démarrer la connexion Google. Réessayez.')
      setBusy(false)
      starting.current=false
    }
    }catch{setError('Impossible de démarrer la connexion Google. Vérifiez votre connexion puis réessayez.');setBusy(false);starting.current=false}
  }

  return <main className="auth-page">
    <div className="auth-brand"><span>H</span><div><strong>HOME</strong><small>REVIEWS</small></div></div>
    <section className="auth-card card google-auth-card">
      <span className="eyebrow">Bienvenue</span>
      <h1>Gérez vos avis Google simplement</h1>
      <p>Surveillez vos nouveaux avis et préparez rapidement vos réponses.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button
        className="primary-button full-width google-auth-button"
        type="button"
        onClick={() => void continueWithGoogle()}
        disabled={busy}
      >
        <GoogleMark />
        {busy ? 'Redirection vers Google…' : 'Continuer avec Google'}
      </button>
      <p className="auth-legal">En continuant, vous acceptez les conditions d'utilisation et la politique de confidentialité.</p>
      {!isSupabaseConfigured && <div className="field-error">Configuration Supabase absente</div>}
    </section>
  </main>
}
