begin;
create table if not exists public.settlement_members(user_id uuid primary key references auth.users(id));
create table if not exists public.settlement_collector_keys(token_hash text primary key,enabled boolean not null default true);
create table if not exists public.settlement_rows(
 row_key text primary key,platform text not null check(platform in ('kuaishou','douyin')),shop text not null,order_id text not null,product_id text not null,order_month text not null,created_at text not null,creator_nickname text not null,creator_id text not null,creator_account text not null,agency_nickname text not null,closed boolean not null,paid_cents bigint,settled_cents bigint,commission_cents bigint,service_fee_cents bigint,captured_at timestamptz not null,payload jsonb not null);
create index if not exists settlement_filter on public.settlement_rows(platform,shop,order_month);
create index if not exists settlement_open_month on public.settlement_rows(closed,order_month);
create table if not exists public.settlement_runs(run_id text primary key,started_at timestamptz not null,updated_at timestamptz not null,status text not null,start_date text not null,end_date text not null,expected_jobs int not null,completed_jobs int not null,record_count int not null,details jsonb not null);
create table if not exists public.settlement_batches(batch_id text primary key,digest text not null,record_count int not null,imported_at timestamptz not null default now());
alter table public.settlement_members enable row level security;
alter table public.settlement_collector_keys enable row level security;
alter table public.settlement_rows enable row level security;
alter table public.settlement_runs enable row level security;
alter table public.settlement_batches enable row level security;
revoke all on public.settlement_members,public.settlement_collector_keys,public.settlement_rows,public.settlement_runs,public.settlement_batches from anon,authenticated;

create or replace function public.settlement_dashboard(p_platform text default '',p_shop text default '',p_month text default '',p_open boolean default false,p_q text default '',p_page integer default 1) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.settlement_members where user_id=auth.uid()) then raise insufficient_privilege using message='没有结算系统权限'; end if;
 if p_page<1 or p_page>100000 or length(p_q)>200 then raise exception '筛选条件无效';end if;
 with filtered as materialized (select * from public.settlement_rows r where (p_platform='' or platform=p_platform) and(p_shop='' or shop=p_shop)and(p_month='' or order_month=p_month)and(not p_open or not closed)and(p_q='' or creator_nickname ilike '%'||p_q||'%' or creator_id ilike '%'||p_q||'%' or creator_account ilike '%'||p_q||'%' or agency_nickname ilike '%'||p_q||'%' or order_id=p_q)),
 summary as(select jsonb_build_object('records',count(*),'shops',count(distinct shop),'open',count(*) filter(where not closed),'paidCents',sum(paid_cents),'settledCents',sum(settled_cents),'commissionCents',sum(commission_cents),'serviceFeeCents',sum(service_fee_cents)) v from filtered),
 page_rows as(select payload||jsonb_build_object('capturedAt',captured_at) v from filtered order by created_at desc,row_key limit 50 offset(p_page-1)*50),
 options as(select distinct platform,shop,order_month from public.settlement_rows),
 cohorts as(select platform,order_month,count(*) records,count(*) filter(where not closed) open,sum(settled_cents) "settledCents" from filtered group by platform,order_month order by order_month desc,platform),
 runs as(select * from public.settlement_runs order by updated_at desc limit 12)
 select jsonb_build_object('summary',(select v from summary),'rows',coalesce((select jsonb_agg(v)from page_rows),'[]'::jsonb),'options',coalesce((select jsonb_agg(to_jsonb(o) order by shop,order_month desc)from options o),'[]'::jsonb),'cohorts',coalesce((select jsonb_agg(to_jsonb(c))from cohorts c),'[]'::jsonb),'runs',coalesce((select jsonb_agg(to_jsonb(r))from runs r),'[]'::jsonb),'page',p_page,'pageSize',50) into result;
 return result;
end;$$;
revoke all on function public.settlement_dashboard(text,text,text,boolean,text,integer) from public,anon;
grant execute on function public.settlement_dashboard(text,text,text,boolean,text,integer) to authenticated;

create or replace function public.settlement_import(p_token text,p_body jsonb default null)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare r jsonb;key text;sha text;previous public.settlement_batches;cnt integer;field text;
begin
 if not exists(select 1 from public.settlement_collector_keys where enabled and token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) then raise insufficient_privilege using message='采集机凭据无效';end if;
 if p_body is null or p_body->>'kind'='readback' then
 return jsonb_build_object('platforms',coalesce((select jsonb_agg(x) from (select platform,count(*) records,count(distinct shop) shops,max(captured_at) "lastCapturedAt" from public.settlement_rows group by platform)x),'[]'::jsonb),'batches',(select jsonb_build_object('batches',count(*),'importedRows',sum(record_count))from public.settlement_batches));end if;
 if p_body->>'kind'='run' then
 r=p_body->'run';if r->>'runId'!~'^[-a-zA-Z0-9_:.]{1,140}$' or r->>'status' not in('running','complete','partial','failed')then raise exception '采集记录无效';end if;
 insert into public.settlement_runs values(r->>'runId',(r->>'startedAt')::timestamptz,(r->>'updatedAt')::timestamptz,r->>'status',r->>'startDate',r->>'endDate',coalesce((r->>'expectedJobs')::int,0),coalesce((r->>'completedJobs')::int,0),coalesce((r->>'recordCount')::int,0),coalesce(r->'details','{}'::jsonb))on conflict(run_id)do update set updated_at=excluded.updated_at,status=excluded.status,expected_jobs=excluded.expected_jobs,completed_jobs=excluded.completed_jobs,record_count=excluded.record_count,details=excluded.details where excluded.updated_at>=settlement_runs.updated_at;
 return jsonb_build_object('ok',true);end if;
 if jsonb_typeof(p_body->'rows')is distinct from'array' or jsonb_array_length(p_body->'rows')>200 or coalesce(length(p_body->>'batchId'),0)not between 1 and 180 then raise exception '批次无效';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_body->>'batchId',0));
 sha=encode(extensions.digest((p_body->'rows')::text,'sha256'),'hex');
 select * into previous from public.settlement_batches where batch_id=p_body->>'batchId';
 if found then if previous.digest<>sha then raise exception '批次内容冲突';end if;return jsonb_build_object('ok',true,'duplicate',true,'rows',previous.record_count);end if;
 for r in select value from jsonb_array_elements(p_body->'rows')loop
 if r->>'platform' not in('kuaishou','douyin') or jsonb_typeof(r->'orderId')is distinct from'string' or r->>'orderId'!~'^\d+$'or coalesce(r->>'shop','')='' or r->>'orderMonth'!~'^\d{4}-\d{2}$' or r->>'capturedAt' is null then raise exception '订单标识无效';end if;
 foreach field in array array['paidCents','settledCents','commissionCents','serviceFeeCents']loop if r->>field is not null and(r->>field!~'^-?\d+$'or abs((r->>field)::numeric)>9007199254740991)then raise exception '金额必须为整数分';end if;end loop;
 key=concat_ws(E'\t',r->>'platform',r->>'shop',r->>'orderId',coalesce(r->>'productId',''));
 if r->>'rowKey' is not null and r->>'rowKey'<>key then raise exception '订单主键不一致';end if;
 r=r||jsonb_build_object('rowKey',key);
 insert into public.settlement_rows values(key,r->>'platform',r->>'shop',r->>'orderId',coalesce(r->>'productId',''),r->>'orderMonth',coalesce(r->>'createdAt',''),coalesce(r->>'creatorNickname',''),coalesce(r->>'creatorId',''),coalesce(r->>'creatorAccount',''),coalesce(r->>'agencyNickname',''),coalesce((r->>'closed')::boolean,false),(r->>'paidCents')::bigint,(r->>'settledCents')::bigint,(r->>'commissionCents')::bigint,(r->>'serviceFeeCents')::bigint,(r->>'capturedAt')::timestamptz,r)
 on conflict(row_key)do update set order_month=excluded.order_month,created_at=excluded.created_at,creator_nickname=excluded.creator_nickname,creator_id=excluded.creator_id,creator_account=excluded.creator_account,agency_nickname=excluded.agency_nickname,closed=excluded.closed,paid_cents=excluded.paid_cents,settled_cents=excluded.settled_cents,commission_cents=excluded.commission_cents,service_fee_cents=excluded.service_fee_cents,captured_at=excluded.captured_at,payload=excluded.payload where excluded.captured_at>=settlement_rows.captured_at;
 end loop;
 cnt=jsonb_array_length(p_body->'rows');insert into public.settlement_batches values(p_body->>'batchId',sha,cnt,now());return jsonb_build_object('ok',true,'rows',cnt);
end;$$;
revoke all on function public.settlement_import(text,jsonb)from public;
grant execute on function public.settlement_import(text,jsonb)to anon,authenticated;
commit;
