import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',testMatch:'recommendation-private.spec.ts',workers:1,retries:0,timeout:30000,
 outputDir:'test-results/recommendation-private',use:{baseURL:'http://127.0.0.1:4182',trace:'retain-on-failure'},
 webServer:{command:'node node_modules/vite/bin/vite.js --config tests/e2e/vite.recommendation.config.ts --host 127.0.0.1 --port 4182',url:'http://127.0.0.1:4182',reuseExistingServer:true},
 projects:[{name:'iphone',use:{...devices['iPhone 14'],browserName:'chromium'}},{name:'small-mobile',use:{browserName:'chromium',viewport:{width:360,height:800}}}],
});
