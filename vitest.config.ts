import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  resolve: { alias: { 'npm:zod@4.6.5': 'zod', 'npm:@supabase/supabase-js@2.117.2': '@supabase/supabase-js' } },
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], exclude: ['tests/e2e/**', 'node_modules/**'], coverage: { reporter: ['text', 'json-summary'] } },
})
