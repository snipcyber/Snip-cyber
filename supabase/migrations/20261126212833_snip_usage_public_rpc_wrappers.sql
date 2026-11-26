create or replace function public.snip_api_get_usage(p_plan text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin if v_uid is null then raise exception 'Authenticated session required'; end if; return public.snip_get_usage(v_uid,p_plan); end;
$$;
create or replace function public.snip_api_reserve_usage(p_plan text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin if v_uid is null then raise exception 'Authenticated session required'; end if; return public.snip_reserve_usage(v_uid,p_plan); end;
$$;
create or replace function public.snip_api_commit_usage(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin if v_uid is null or p_reservation_id is null then raise exception 'Authenticated session and reservation required'; end if; return public.snip_commit_usage(v_uid,p_reservation_id); end;
$$;
create or replace function public.snip_api_release_usage(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin if v_uid is null or p_reservation_id is null then raise exception 'Authenticated session and reservation required'; end if; return public.snip_release_usage(v_uid,p_reservation_id); end;
$$;
create or replace function public.snip_api_anon_get_usage(p_install_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin if auth.uid() is not null then raise exception 'Anonymous session required'; end if; return public.snip_anon_get_usage(p_install_hash); end;
$$;
create or replace function public.snip_api_anon_reserve_usage(p_install_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin if auth.uid() is not null then raise exception 'Anonymous session required'; end if; return public.snip_anon_reserve_usage(p_install_hash); end;
$$;
create or replace function public.snip_api_anon_commit_usage(p_install_hash text,p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin if auth.uid() is not null then raise exception 'Anonymous session required'; end if; return public.snip_anon_commit_usage(p_install_hash,p_reservation_id); end;
$$;
create or replace function public.snip_api_anon_release_usage(p_install_hash text,p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin if auth.uid() is not null then raise exception 'Anonymous session required'; end if; return public.snip_anon_release_usage(p_install_hash,p_reservation_id); end;
$$;
create or replace function public.snip_api_claim_usage_reservation(p_reservation_id uuid,p_install_hash text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_plan text; v_id uuid;
begin
 if p_reservation_id is null then raise exception 'Reservation required'; end if;
 if v_uid is not null then
  update public.snip_usage_reservations set status='processing',updated_at=now() where reservation_id=p_reservation_id and user_id=v_uid and status='reserved' and expires_at>now() returning reservation_id,plan into v_id,v_plan;
  if v_id is null then return jsonb_build_object('ok',false); end if;
  return jsonb_build_object('ok',true,'plan',v_plan,'reservation_id',v_id);
 end if;
 if p_install_hash is null or p_install_hash !~ '^[0-9a-f]{64}$' then raise exception 'Valid anonymous installation identity required'; end if;
 update public.snip_anonymous_usage_reservations set status='processing' where id=p_reservation_id and install_hash=p_install_hash and status='reserved' and expires_at>now() returning id into v_id;
 if v_id is null then return jsonb_build_object('ok',false); end if;
 return jsonb_build_object('ok',true,'plan','free','reservation_id',v_id);
end;
$$;
revoke all on function public.snip_api_get_usage(text) from public;
revoke all on function public.snip_api_reserve_usage(text) from public;
revoke all on function public.snip_api_commit_usage(uuid) from public;
revoke all on function public.snip_api_release_usage(uuid) from public;
revoke all on function public.snip_api_anon_get_usage(text) from public;
revoke all on function public.snip_api_anon_reserve_usage(text) from public;
revoke all on function public.snip_api_anon_commit_usage(text,uuid) from public;
revoke all on function public.snip_api_anon_release_usage(text,uuid) from public;
revoke all on function public.snip_api_claim_usage_reservation(uuid,text) from public;
grant execute on function public.snip_api_get_usage(text) to authenticated;
grant execute on function public.snip_api_reserve_usage(text) to authenticated;
grant execute on function public.snip_api_commit_usage(uuid) to authenticated;
grant execute on function public.snip_api_release_usage(uuid) to authenticated;
grant execute on function public.snip_api_anon_get_usage(text) to anon;
grant execute on function public.snip_api_anon_reserve_usage(text) to anon;
grant execute on function public.snip_api_anon_commit_usage(text,uuid) to anon;
grant execute on function public.snip_api_anon_release_usage(text,uuid) to anon;
grant execute on function public.snip_api_claim_usage_reservation(uuid,text) to anon,authenticated;