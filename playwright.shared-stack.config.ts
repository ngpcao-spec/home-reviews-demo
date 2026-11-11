import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./tests/e2e',testMatch:'shared-mutualization.spec.ts',workers:1,retries:0,
 expect:{timeout:20_000},
 reporter:[['list']],use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',viewport:{width:390,height:844}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:false},
})
