import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import resume from './vite.resume.config.ts'
export default defineConfig({...resume,build:{outDir:'test-results/pwa-build',rollupOptions:{input:fileURLToPath(new URL('./fixtures/resume.html',import.meta.url))}}})
