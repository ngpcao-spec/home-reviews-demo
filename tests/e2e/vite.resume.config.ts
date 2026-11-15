import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
export default defineConfig({plugins:[react()],resolve:{alias:[{
  find:/^(?:(?:\.\.\/)+lib\/|\.\/)supabase$/,
  replacement:fileURLToPath(new URL('./fixtures/resume-supabase.ts',import.meta.url)),
},{find:'npm:js-tiktoken@1.0.21',replacement:'js-tiktoken'}]}})
