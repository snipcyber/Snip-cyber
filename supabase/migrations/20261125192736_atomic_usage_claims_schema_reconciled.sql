-- Atomic one-time reservation claims, reconciled to the staging schema.
-- Authenticated rows use reservation_id/period_start/timezone; anonymous rows use id/period_key.
-- The API claims rows with a conditional PATCH from reserved -> processing.

alter table public.snip_usage_reservations
  add column if not exists expires_at timestamptz,
  add column if not exists committed_at timestamptz;

update public.snip_usage_reservations
set expires_at = coalesce(expires_at, created_at + interval '15 minutes'),
    committed_at = coalesce(committed_at, case when status = 'committed' then updated_at else null end);

alter table public.snip_usage_reservations
  alter column expires_at set default (now() + interval '15 minutes'),
  alter column expires_at set not null;

alter table public.snip_usage_reservations
  drop constraint if exists snip_usage_reservations_status_check;
alter table public.snip_usage_reservations
  add constraint snip_usage_reservations_status_check
  check (status in ('reserved','processing','committed','released'));

alter table public.snip_anonymous_usage_reservations
  drop constraint if exists snip_anonymous_usage_reservations_status_check;
alter table public.snip_anonymous_usage_reservations
  add constraint snip_anonymous_usage_reservations_status_check
  check (status in ('reserved','processing','committed','released'));

create or replace function public.snip_reserve_usage(p_user_id uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_period text;
  v_period_start date;
  v_limit integer;
  v_used integer;
  v_id uuid;
begin
  if p_user_id is null or p_plan is null or p_plan not in ('free','pro','unlimited') then
    raise exception 'Invalid plan or user';
  end if;

  v_period := case when p_plan = 'pro'
    then to_char(now() at time zone 'UTC','YYYY-MM')
    else to_char(now() at time zone 'UTC','YYYY-MM-DD') end;
  v_period_start := case when p_plan = 'pro'
    then date_trunc('month', now() at time zone 'UTC')::date
    else (now() at time zone 'UTC')::date end;
  v_limit := case when p_plan = 'free' then 10 when p_plan = 'pro' then 500 else null end;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_period, 0));

  update public.snip_usage_reservations
  set status = 'released', updated_at = now()
  where user_id = p_user_id and period_key = v_period
    and status in ('reserved','processing') and expires_at < now();

  select count(*) into v_used
  from public.snip_usage_reservations
  where user_id = p_user_id and period_key = v_period
    and (status = 'committed' or (status in ('reserved','processing') and expires_at > now()));

  if v_limit is not null and v_used >= v_limit then
    return jsonb_build_object('ok',false,'limit',v_limit,'used',v_used);
  end if;

  v_id := gen_random_uuid();
  insert into public.snip_usage_reservations
    (reservation_id,user_id,plan,period_start,timezone,status,period_key,expires_at)
  values
    (v_id,p_user_id,p_plan,v_period_start,'UTC','reserved',v_period,now() + interval '15 minutes');

  return jsonb_build_object('ok',true,'reservation_id',v_id,'limit',v_limit,'used',v_used + 1);
end;
$$;

create or replace function public.snip_get_usage(p_user_id uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_period text;
  v_limit integer;
  v_used integer;
begin
  if p_user_id is null or p_plan is null or p_plan not in ('free','pro','unlimited') then
    raise exception 'Invalid plan or user';
  end if;

  v_period := case when p_plan = 'pro'
    then to_char(now() at time zone 'UTC','YYYY-MM')
    else to_char(now() at time zone 'UTC','YYYY-MM-DD') end;
  v_limit := case when p_plan = 'free' then 10 when p_plan = 'pro' then 500 else null end;

  select count(*) into v_used
  from public.snip_usage_reservations
  where user_id = p_user_id and period_key = v_period
    and (status = 'committed' or (status in ('reserved','processing') and expires_at > now()));

  return jsonb_build_object(
    'ok',true,'plan',p_plan,'used',v_used,'limit',v_limit,
    'remaining',case when v_limit is null then null else greatest(0,v_limit-v_used) end,
    'authenticated',true
  );
end;
$$;

create or replace function public.snip_commit_usage(p_user_id uuid, p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
  v_plan text;
  v_period text;
  v_used integer;
  v_limit integer;
begin
  update public.snip_usage_reservations
  set status = 'committed', committed_at = now(), updated_at = now()
  where reservation_id = p_reservation_id and user_id = p_user_id
    and status in ('reserved','processing') and expires_at > now()
  returning plan,period_key into v_plan,v_period;

  get diagnostics v_count = row_count;
  if v_count <> 1 then return jsonb_build_object('ok',false); end if;

  v_limit := case when v_plan = 'free' then 10 when v_plan = 'pro' then 500 else null end;
  select count(*) into v_used
  from public.snip_usage_reservations
  where user_id = p_user_id and period_key = v_period
    and (status = 'committed' or (status in ('reserved','processing') and expires_at > now()));

  return jsonb_build_object(
    'ok',true,'plan',v_plan,'used',v_used,'limit',v_limit,
    'remaining',case when v_limit is null then null else greatest(0,v_limit-v_used) end
  );
end;
$$;

create or replace function public.snip_release_usage(p_user_id uuid, p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.snip_usage_reservations
  set status = 'released', updated_at = now()
  where reservation_id = p_reservation_id and user_id = p_user_id
    and status in ('reserved','processing');
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',v_count = 1);
end;
$$;

create or replace function public.snip_anon_get_usage(p_install_hash text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_period text := to_char(now() at time zone 'UTC','YYYY-MM-DD'); v_used integer;
begin
  if p_install_hash is null or p_install_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid installation identity';
  end if;
  select count(*) into v_used
  from public.snip_anonymous_usage_reservations
  where install_hash = p_install_hash and period_key = v_period
    and (status = 'committed' or (status in ('reserved','processing') and expires_at > now()));
  return jsonb_build_object('ok',true,'plan','anonymous','used',v_used,
    'limit',10,'remaining',greatest(0,10-v_used),'authenticated',false);
end;
$$;

create or replace function public.snip_anon_reserve_usage(p_install_hash text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_period text := to_char(now() at time zone 'UTC','YYYY-MM-DD'); v_used integer; v_id uuid;
begin
  if p_install_hash is null or p_install_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid installation identity';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_install_hash || ':' || v_period, 0));
  update public.snip_anonymous_usage_reservations set status = 'released'
  where install_hash = p_install_hash and period_key = v_period
    and status in ('reserved','processing') and expires_at < now();
  select count(*) into v_used from public.snip_anonymous_usage_reservations
  where install_hash = p_install_hash and period_key = v_period
    and (status = 'committed' or (status in ('reserved','processing') and expires_at > now()));
  if v_used >= 10 then return jsonb_build_object('ok',false,'limit',10,'used',v_used); end if;
  insert into public.snip_anonymous_usage_reservations(install_hash,period_key)
  values(p_install_hash,v_period) returning id into v_id;
  return jsonb_build_object('ok',true,'reservation_id',v_id,'limit',10,'used',v_used + 1);
end;
$$;

create or replace function public.snip_anon_commit_usage(p_install_hash text,p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_count integer; v_period text; v_used integer;
begin
  if p_install_hash is null or p_install_hash !~ '^[0-9a-f]{64}$' or p_reservation_id is null then
    raise exception 'Invalid installation identity or reservation';
  end if;
  update public.snip_anonymous_usage_reservations
  set status = 'committed',committed_at = now()
  where id = p_reservation_id and install_hash = p_install_hash
    and status in ('reserved','processing') and expires_at > now()
  returning period_key into v_period;
  get diagnostics v_count = row_count;
  if v_count <> 1 then return jsonb_build_object('ok',false); end if;
  select count(*) into v_used from public.snip_anonymous_usage_reservations
  where install_hash = p_install_hash and period_key = v_period
    and (status = 'committed' or (status in ('reserved','processing') and expires_at > now()));
  return jsonb_build_object('ok',true,'plan','anonymous','used',v_used,
    'limit',10,'remaining',greatest(0,10-v_used),'authenticated',false);
end;
$$;

create or replace function public.snip_anon_release_usage(p_install_hash text,p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if p_install_hash is null or p_install_hash !~ '^[0-9a-f]{64}$' or p_reservation_id is null then
    raise exception 'Invalid installation identity or reservation';
  end if;
  update public.snip_anonymous_usage_reservations set status = 'released'
  where id = p_reservation_id and install_hash = p_install_hash
    and status in ('reserved','processing');
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',v_count = 1);
end;
$$;

revoke all on function public.snip_reserve_usage(uuid,text) from public,anon,authenticated;
revoke all on function public.snip_get_usage(uuid,text) from public,anon,authenticated;
revoke all on function public.snip_commit_usage(uuid,uuid) from public,anon,authenticated;
revoke all on function public.snip_release_usage(uuid,uuid) from public,anon,authenticated;
revoke all on function public.snip_anon_get_usage(text) from public,anon,authenticated;
revoke all on function public.snip_anon_reserve_usage(text) from public,anon,authenticated;
revoke all on function public.snip_anon_commit_usage(text,uuid) from public,anon,authenticated;
revoke all on function public.snip_anon_release_usage(text,uuid) from public,anon,authenticated;

grant execute on function public.snip_reserve_usage(uuid,text) to service_role;
grant execute on function public.snip_get_usage(uuid,text) to service_role;
grant execute on function public.snip_commit_usage(uuid,uuid) to service_role;
grant execute on function public.snip_release_usage(uuid,uuid) to service_role;
grant execute on function public.snip_anon_get_usage(text) to service_role;
grant execute on function public.snip_anon_reserve_usage(text) to service_role;
grant execute on function public.snip_anon_commit_usage(text,uuid) to service_role;
grant execute on function public.snip_anon_release_usage(text,uuid) to service_role;

