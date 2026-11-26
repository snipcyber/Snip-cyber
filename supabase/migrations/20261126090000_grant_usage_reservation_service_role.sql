-- The usage API atomically claims reservation rows with PostgREST PATCH.
-- SECURITY DEFINER protects the RPCs, but the API's conditional PATCH also
-- requires explicit service_role table privileges. Keep these tables closed
-- to anon/authenticated; only the backend service role may access them.

grant select, insert, update, delete
  on table public.snip_usage_reservations
  to service_role;

grant select, insert, update, delete
  on table public.snip_anonymous_usage_reservations
  to service_role;
