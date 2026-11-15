import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'npm:js-tiktoken@1.0.21': 'js-tiktoken' } },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://auth-fixture.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fixture-public-key'),
    'import.meta.env.VITE_ROUTER_MODE': JSON.stringify('hash'),
    'import.meta.env.VITE_DEMO_MODE': JSON.stringify('false'),
    'import.meta.env.DEV': 'false',
  },
  server: { host: '127.0.0.1', port: 4174 },
})
