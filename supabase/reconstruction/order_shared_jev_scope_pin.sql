-- PostgreSQL fires same-event triggers in name order. Bind the scope before
-- updating its expiry. The separate BEFORE trigger still pins the version.
alter trigger pin_shared_jev_after on public.report_generation_requests
  rename to recent_text_pin_shared_jev_after_scope;
