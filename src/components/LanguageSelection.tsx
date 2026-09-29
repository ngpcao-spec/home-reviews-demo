import { Languages } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../app/AppContext'
import { useI18n } from '../i18n'
import type { PreferredLanguage } from '../types/domain'

export function LanguageSelection() {
  const { updatePreferredLanguage } = useApp()
  const { messages } = useI18n()
  const [busy, setBusy] = useState<PreferredLanguage | null>(null)
  const choose = async (language: PreferredLanguage) => {
    setBusy(language)
    try { await updatePreferredLanguage(language) } finally { setBusy(null) }
  }
  return <main className="auth-page"><section className="auth-card card language-card" aria-labelledby="language-title">
    <span className="flow-icon"><Languages /></span><h1 id="language-title">{messages.language.title}</h1><p>{messages.language.body}</p>
    <button className="primary-button full-width" disabled={busy !== null} onClick={() => void choose('fr')}>{messages.language.french}</button>
    <button className="secondary-button full-width" disabled={busy !== null} onClick={() => void choose('vi')}>{messages.language.vietnamese}</button>
  </section></main>
}
