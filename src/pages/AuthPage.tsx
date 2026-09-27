import { ArrowRight, Lock, Mail, User } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export function AuthPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login'|'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [recoverySent, setRecoverySent] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase n’est pas configuré pour ce déploiement.')
      return
    }
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } })
    if (result.error) setError(result.error.message)
    else navigate('/')
  }

  const requestPasswordRecovery = async () => {
    setError('')
    setRecoverySent(false)
    if (!email) {
      setError('Saisissez votre adresse email.')
      return
    }
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase n’est pas configuré pour ce déploiement.')
      return
    }
    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString()
    const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (recoveryError) setError(recoveryError.message)
    else setRecoverySent(true)
  }

  return <main className="auth-page"><div className="auth-brand"><span>H</span><div><strong>HOME</strong><small>REVIEWS</small></div></div><section className="auth-card card"><span className="eyebrow">{mode==='login'?'Bienvenue':'Créer votre espace'}</span><h1>{mode==='login'?'Prenez soin de vos clients':'Commencez à surveiller vos avis'}</h1><p>{mode==='login'?'Connectez-vous à votre tableau de bord.':'Une organisation sécurisée sera créée pour vous.'}</p><form onSubmit={submit}>{mode==='signup'&&<label><span>Nom complet</span><div><User/><input required value={name} onChange={(event)=>setName(event.target.value)} autoComplete="name"/></div></label>}<label><span>Adresse email</span><div><Mail/><input required type="email" value={email} onChange={(event)=>setEmail(event.target.value)} autoComplete="email"/></div></label><label><span>Mot de passe</span><div><Lock/><input required minLength={8} type="password" value={password} onChange={(event)=>setPassword(event.target.value)} autoComplete={mode==='login'?'current-password':'new-password'}/></div></label>{error&&<p className="field-error">{error}</p>}{recoverySent&&<p className="auth-demo">Un nouveau lien de réinitialisation vous a été envoyé.</p>}<button className="primary-button full-width" type="submit">{mode==='login'?'Se connecter':'Créer mon compte'}<ArrowRight/></button></form>{mode==='login'&&<button className="text-button full-width" onClick={()=>void requestPasswordRecovery()}>Mot de passe oublié ?</button>}<button className="text-button full-width" onClick={()=>setMode(mode==='login'?'signup':'login')}>{mode==='login'?'Pas encore de compte ? Créer un compte':'Déjà un compte ? Se connecter'}</button>{!isSupabaseConfigured&&<div className="field-error">Configuration Supabase absente</div>}</section></main>
}
