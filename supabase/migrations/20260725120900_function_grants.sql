-- Lock down function EXECUTE.
--
-- `revoke ... from anon` in the previous migration was not enough: Postgres
-- grants EXECUTE on every new function to PUBLIC, and anon inherits that. The
-- revoke has to name PUBLIC or the grant survives, which is exactly what the
-- database linter caught — five SECURITY DEFINER helpers were reachable at
-- /rest/v1/rpc/... without signing in.
--
-- The rule applied below: start from nothing, then grant back only to the role
-- that has to have it.

-- Trigger functions. Nothing should ever call these directly — they run as part
-- of a trigger, where EXECUTE is not consulted.
revoke all on function public.handle_new_user()             from public, anon, authenticated;
revoke all on function public.guard_count_record_update()   from public, anon, authenticated;
revoke all on function public.forbid_mutation()             from public, anon, authenticated;

-- RLS helpers. A policy expression is evaluated as the querying role, so
-- `authenticated` genuinely needs EXECUTE on these or every policy that calls
-- them fails. `anon` has no policy that could use them and no rows to reach.
revoke all on function public.current_app_role()            from public, anon;
revoke all on function public.is_staff()                    from public, anon;
revoke all on function public.is_auditor()                  from public, anon;
revoke all on function public.has_plan_access(uuid)         from public, anon;

grant execute on function public.current_app_role()         to authenticated;
grant execute on function public.is_staff()                 to authenticated;
grant execute on function public.is_auditor()               to authenticated;
grant execute on function public.has_plan_access(uuid)      to authenticated;

-- Application surface: invoker-rights, so RLS still applies, but there is no
-- reason for a signed-out caller to reach them.
revoke all on function public.normalize_product_name(text)  from public, anon;
revoke all on function public.search_warehouse_catalogue(uuid, text, integer, real)
  from public, anon;

grant execute on function public.normalize_product_name(text) to authenticated;
grant execute on function public.search_warehouse_catalogue(uuid, text, integer, real)
  to authenticated;

-- Keep it that way for functions added later.
alter default privileges in schema public revoke execute on functions from public;

-- Note on the remaining INFO-level lint: the four `source.*` tables have RLS
-- enabled and deliberately no policies. That combination is deny-all, which is
-- the intent — the schema is service-role only and is not in the exposed API
-- list. A policy there would weaken it, not strengthen it.
