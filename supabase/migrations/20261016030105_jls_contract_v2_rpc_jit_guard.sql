-- MCP SQL uses jit=off, unlike the PostgREST sessions. Keep this setting
-- local to the new verifier and its native-source checks, never global.
ALTER FUNCTION public.check_jls_contract_v2_sources(uuid) SET jit TO 'off';
