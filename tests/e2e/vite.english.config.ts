import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({plugins:[react()],define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://english-fixture.supabase.co'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('fixture-public-key')},server:{host:'127.0.0.1',port:4174}})
