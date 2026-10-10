import {defineConfig} from '@playwright/test'
import base from './playwright.config'
export default defineConfig({...base,testMatch:'jev-compact.spec.ts',projects:[360,390,430,768].map(width=>({name:'compact-'+width,use:{browserName:'chromium' as const,viewport:{width,height:width===768?1024:844}}}))})
