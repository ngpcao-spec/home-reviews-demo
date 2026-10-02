import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({...base,testIgnore:[],testMatch:'pwa-shell.spec.ts',use:{...base.use,baseURL:'http://127.0.0.1:4176'},
  webServer:{command:'node node_modules/vite/bin/vite.js preview --outDir test-results/pwa-build --host 127.0.0.1 --port 4176',url:'http://127.0.0.1:4176',reuseExistingServer:false},
  outputDir:'test-results/pwa-shell',
})
