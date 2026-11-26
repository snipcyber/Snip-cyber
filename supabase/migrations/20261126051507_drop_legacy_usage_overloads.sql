-- Remove obsolete RPC overloads left behind by the earlier usage schema.
-- The active API calls the two-argument authenticated RPCs only. Keeping the
-- old default-argument getter makes PostgreSQL's two-argument call ambiguous.
drop function if exists public.snip_get_usage(uuid, text, text);
drop function if exists public.snip_reserve_usage(uuid, text, uuid, text);
drop function if exists public.snip_commit_usage(uuid);
drop function if exists public.snip_release_usage(uuid);
