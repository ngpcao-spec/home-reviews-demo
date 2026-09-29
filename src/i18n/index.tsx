/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import type { PreferredLanguage } from '../types/domain'
import { fr, type Messages } from './fr'
import { vi } from './vi'

const I18nContext = createContext<{ language: PreferredLanguage; messages: Messages }>({ language: 'fr', messages: fr })

export function I18nProvider({ language, children }: { language: PreferredLanguage; children: ReactNode }) {
  useEffect(() => { document.documentElement.lang = language }, [language])
  return <I18nContext.Provider value={{ language, messages: language === 'vi' ? vi : fr }}>{children}</I18nContext.Provider>
}

export function useI18n() { return useContext(I18nContext) }
