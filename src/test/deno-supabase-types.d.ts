// Type-only bridge for tests of server adapters; Deno keeps its pinned npm import.
declare module 'npm:@supabase/supabase-js@2.117.2' {
  export type SupabaseClient = import('@supabase/supabase-js').SupabaseClient;
}
