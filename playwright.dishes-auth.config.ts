import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./tests/e2e',testMatch:'dishes-auth.spec.ts',workers:1,retries:0,
 expect:{timeout:20000},reporter:[['list']],
 use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',actionTimeout:20000,viewport:{width:390,height:844},isMobile:true,hasTouch:true,trace:'off',video:'off'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:false},
})
