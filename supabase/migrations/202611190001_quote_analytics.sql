begin;

-- Exactly one owner, assigned by a trusted deployment operation, never signup.
create table public.quote_analytics_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.quote_analytics_owner enable row level security;
revoke all on public.quote_analytics_owner from public, anon, authenticated;
grant select on public.quote_analytics_owner to authenticated;
grant all on public.quote_analytics_owner to service_role;
create policy owner_reads_own_membership on public.quote_analytics_owner
  for select to authenticated using (user_id = (select auth.uid()));

create table public.quote_analytics_events (
  event_id uuid primary key,
  session_id uuid not null,
  event_type text not null check (event_type in ('page_view','quote_generated')),
  ip inet not null check (masklen(ip) = case family(ip) when 4 then 32 else 128 end),
  created_at timestamptz not null default now()
);
create index quote_analytics_events_time on public.quote_analytics_events(created_at desc);
create index quote_analytics_events_ip_time on public.quote_analytics_events(ip,created_at desc);
alter table public.quote_analytics_events enable row level security;
revoke all on public.quote_analytics_events from public, anon, authenticated;
grant select on public.quote_analytics_events to authenticated;
grant all on public.quote_analytics_events to service_role;
create policy owner_reads_recent_events on public.quote_analytics_events
  for select to authenticated using (
    created_at >= now() - interval '30 days'
    and exists(select 1 from public.quote_analytics_owner o where o.user_id = (select auth.uid()))
  );

create table public.quote_analytics_limits (
  bucket_key text not null,
  bucket_start timestamptz not null,
  hits integer not null check(hits > 0),
  primary key(bucket_key,bucket_start)
);
alter table public.quote_analytics_limits enable row level security;
revoke all on public.quote_analytics_limits from public, anon, authenticated;
grant all on public.quote_analytics_limits to service_role;

-- Only the server's service role may call this write function.
create function public.quote_analytics_record(p_event_id uuid,p_session_id uuid,p_event_type text,p_ip inet)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  used integer;
  at_time timestamptz := now();
begin
  if not exists(select 1 from public.quote_analytics_owner) then return 'not_configured'; end if;
  if p_event_id is null or p_session_id is null or p_ip is null
    or p_event_type is null or p_event_type not in ('page_view','quote_generated')
    or masklen(p_ip) <> (case family(p_ip) when 4 then 32 else 128 end)
    then raise exception 'invalid event' using errcode='22023'; end if;
  if exists(select 1 from public.quote_analytics_events where event_id=p_event_id) then return 'duplicate'; end if;
  -- Atomic upserts keep quotas effective across concurrent edge isolates.
  insert into public.quote_analytics_limits as l values('global',date_trunc('day',at_time,'UTC'),1)
    on conflict(bucket_key,bucket_start) do update set hits=l.hits+1 where l.hits<20000
    returning hits into used;
  if used is null then return 'limited'; end if;
  used := null;
  insert into public.quote_analytics_limits as l values('ip:'||host(p_ip),date_trunc('minute',at_time),1)
    on conflict(bucket_key,bucket_start) do update set hits=l.hits+1 where l.hits<60
    returning hits into used;
  if used is null then return 'limited'; end if;
  insert into public.quote_analytics_events(event_id,session_id,event_type,ip)
    values(p_event_id,p_session_id,p_event_type,p_ip) on conflict(event_id) do nothing;
  return 'recorded';
end;
$$;
revoke all on function public.quote_analytics_record(uuid,uuid,text,inet) from public, anon, authenticated;
grant execute on function public.quote_analytics_record(uuid,uuid,text,inet) to service_role;

-- Invoker security preserves RLS even if another authenticated user calls the RPC.
create function public.quote_analytics_report(p_days integer default 7,p_page integer default 1,p_ip text default '')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  since_at timestamptz;
  result jsonb;
begin
  if not exists(select 1 from public.quote_analytics_owner where user_id=(select auth.uid()))
    then raise exception 'administrator required' using errcode='42501'; end if;
  if p_days is null or p_days not in (1,7,30) or p_page is null or p_page<1 or p_page>10000
    or p_ip is null or length(p_ip)>45 or p_ip !~ '^[0-9a-fA-F:.]*$'
    then raise exception 'invalid filter' using errcode='22023'; end if;
  since_at := greatest(
    (date_trunc('day',now() at time zone 'Asia/Shanghai') - ((p_days-1)*interval '1 day')) at time zone 'Asia/Shanghai',
    now()-interval '30 days'
  );
  with filtered as materialized (
    select event_type,ip,created_at from public.quote_analytics_events
    where created_at>=since_at and (p_ip='' or position(lower(p_ip) in lower(host(ip)))=1)
  ), addresses as (
    select host(ip) as ip,min(created_at) as first_seen,max(created_at) as last_seen,
      count(*) filter(where event_type='page_view') as views,
      count(*) filter(where event_type='quote_generated') as quotes
    from filtered group by ip
  ), daily as (
    select (created_at at time zone 'Asia/Shanghai')::date as day,
      count(*) filter(where event_type='page_view') as views,
      count(*) filter(where event_type='quote_generated') as quotes
    from filtered group by 1
  )
  select jsonb_build_object(
    'since',since_at,'updated_at',now(),'page',p_page,'page_size',50,
    'metrics',jsonb_build_object(
      'views',(select count(*) from filtered where event_type='page_view'),
      'ips',(select count(*) from addresses),
      'quotes',(select count(*) from filtered where event_type='quote_generated'),
      'active_ips',(select count(*) from addresses where quotes>0)
    ),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d),'[]'::jsonb),
    'addresses',coalesce((select jsonb_agg(to_jsonb(a) order by last_seen desc,ip)
      from (select * from addresses order by last_seen desc,ip limit 50 offset (p_page-1)*50) a),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.quote_analytics_report(integer,integer,text) from public, anon;
grant execute on function public.quote_analytics_report(integer,integer,text) to authenticated;
commit;
