import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({...base,testIgnore:[],testMatch:['pwa-resume.spec.ts','review-google-details.spec.ts'],use:{...base.use,baseURL:'http://127.0.0.1:4175'},
  webServer:{command:'node node_modules/vite/bin/vite.js --config tests/e2e/vite.resume.config.ts --host 127.0.0.1 --port 4175',url:'http://127.0.0.1:4175',reuseExistingServer:false},
})
