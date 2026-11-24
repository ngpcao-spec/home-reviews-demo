import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath} from 'node:url'
import {dishesServer} from './dishes-server'
const stub=fileURLToPath(new URL('./fixtures/dishes-stubs.ts',import.meta.url))
export default defineConfig({plugins:[react(),dishesServer()],optimizeDeps:{entries:['tests/e2e/fixtures/dishes-mobile.html']},resolve:{alias:[{find:/^(?:\.\.\/)+app\/AppContext$/,replacement:stub},{find:/^(?:(?:\.\.\/)+lib\/|\.\/)supabase$/,replacement:stub}]}})
