-- Authenticated export uses the same filters as the dashboard, with keyset pagination.
-- A digest checked before download rejects concurrent changes instead of returning a partial file.
begin;
create or replace function public.settlement_export(
 p_platform text default '',p_shop text default '',p_month text default '',
 p_open boolean default false,p_q text default '',p_cursor text default '',
 p_asof timestamptz default null,p_check boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;cutoff timestamptz:=coalesce(p_asof,statement_timestamp());
begin
 if auth.uid() is null or not exists(select 1 from public.settlement_members where user_id=auth.uid()) then raise insufficient_privilege using message='没有结算系统权限';end if;
 if length(p_q)>200 or length(p_cursor)>600 or cutoff>statement_timestamp() or cutoff<statement_timestamp()-interval '1 day' then raise exception '导出条件无效，请重新导出';end if;
 if p_cursor<>'' and p_asof is null then raise exception '导出游标无效';end if;
 if p_cursor='' or p_check then
   select jsonb_build_object('records',count(*),'revision',coalesce(sum(hashtextextended(payload::text||captured_at::text,0)::numeric),0)::text)
   into result from public.settlement_rows
   where captured_at<=cutoff and(p_platform='' or platform=p_platform)and(p_shop='' or shop=p_shop)and(p_month='' or order_month=p_month)and(not p_open or not closed)and(p_q='' or creator_nickname ilike '%'||p_q||'%' or creator_id ilike '%'||p_q||'%' or creator_account ilike '%'||p_q||'%' or agency_nickname ilike '%'||p_q||'%' or order_id=p_q);
   if (result->>'records')::bigint>1048575 then raise exception '明细超过 Excel 行数上限，请按平台或月份分别导出';end if;
 else result:='{}'::jsonb;end if;
 if p_check then return result||jsonb_build_object('asOf',cutoff);end if;
 return result||jsonb_build_object('asOf',cutoff)||(
 select jsonb_build_object('rows',coalesce(jsonb_agg(payload||jsonb_build_object('rowKey',row_key,'capturedAt',captured_at) order by row_key),'[]'::jsonb),
 'nextCursor',case when count(*)=1000 then max(row_key) else null end)
 from(select row_key,payload,captured_at from public.settlement_rows
 where row_key>p_cursor and captured_at<=cutoff and(p_platform='' or platform=p_platform)and(p_shop='' or shop=p_shop)and(p_month='' or order_month=p_month)and(not p_open or not closed)and(p_q='' or creator_nickname ilike '%'||p_q||'%' or creator_id ilike '%'||p_q||'%' or creator_account ilike '%'||p_q||'%' or agency_nickname ilike '%'||p_q||'%' or order_id=p_q)
 order by row_key limit 1000)t);
end;$$;
revoke all on function public.settlement_export(text,text,text,boolean,text,text,timestamptz,boolean) from public,anon;
grant execute on function public.settlement_export(text,text,text,boolean,text,text,timestamptz,boolean) to authenticated;
commit;
