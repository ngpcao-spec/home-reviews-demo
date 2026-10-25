import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  resolve: { alias: { 'npm:franc-min@6.2.0': 'franc-min', 'npm:js-tiktoken@1.0.21': 'js-tiktoken', 'npm:zod@4.6.5': 'zod', 'npm:@supabase/supabase-js@2.117.2': '@supabase/supabase-js' } },
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
})
