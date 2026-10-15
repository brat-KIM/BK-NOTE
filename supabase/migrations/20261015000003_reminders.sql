-- 알림: 1분마다 Edge Function "push" 가 호출해서 도래한 알림을 가져간다.
-- 같은 알림 시각(remind_at 또는 다시 알림 snoozed_until)에 대해 한 번만 나간다(notified_for 로 기록).
create or replace function public.due_reminders(p_now timestamptz default now())
returns table (owner uuid, item_id uuid, plain text, due_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select i.id, coalesce(i.snoozed_until, i.remind_at) as at
    from public.items i
    where i.remind_at is not null and i.done_at is null and i.deleted_at is null
      and coalesce(i.snoozed_until, i.remind_at) <= p_now
      -- 너무 오래 지난 알림(앱을 오래 안 켰던 경우)은 하루까지만
      and coalesce(i.snoozed_until, i.remind_at) > p_now - interval '1 day'
      and (i.notified_for is null or i.notified_for <> coalesce(i.snoozed_until, i.remind_at))
    for update skip locked
  )
  update public.items i set notified_for = due.at
  from due
  where i.id = due.id
  returning i.owner, i.id, i.plain, due.at;
end $$;

-- notified_for 만 바꿀 때는 버전·시각을 올리지 않는다(기기 동기화 대상 아님)
create or replace function public.bump_row() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.updated_at := clock_timestamp();
  elsif tg_table_name = 'items'
    and (to_jsonb(new) - 'notified_for') = (to_jsonb(old) - 'notified_for') then
    return new;
  else
    new.version := old.version + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;

-- 알림을 보낼 기기 목록(데스크톱이 최근 5분 안에 사용 중이면 폰 푸시는 생략)
create or replace function public.push_targets(p_owner uuid, p_now timestamptz default now())
returns table (device_id text, push jsonb)
language sql stable security definer set search_path = public as $$
  select d.device_id, d.push from public.devices d
  where d.owner = p_owner and d.kind = 'web' and d.push is not null
    and not exists (
      select 1 from public.devices x
      where x.owner = p_owner and x.kind = 'desktop' and x.last_active > p_now - interval '5 minutes')
$$;

revoke all on function public.due_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.push_targets(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.due_reminders(timestamptz) to service_role;
grant execute on function public.push_targets(uuid, timestamptz) to service_role;
