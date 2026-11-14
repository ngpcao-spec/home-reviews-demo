import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath} from 'node:url'
const stub=fileURLToPath(new URL('./fixtures/analysis-stubs.ts',import.meta.url))
export default defineConfig({optimizeDeps:{entries:['tests/e2e/fixtures/analysis-mobile.html']},plugins:[react()],resolve:{alias:[{find:/^(?:\.\.\/)+app\/AppContext$/,replacement:stub},{find:/^(?:\.\.\/)+lib\/use-historical-generation$/,replacement:stub},{find:/^(?:(?:\.\.\/)+lib\/|\.\/)supabase$/,replacement:stub}]}})
