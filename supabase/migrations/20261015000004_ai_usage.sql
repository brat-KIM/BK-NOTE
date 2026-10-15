-- AI 사용량(사용자별 하루 상한). Edge Function "ai" 가 호출할 때마다 1 증가.
create table public.ai_usage (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day   date not null default (now() at time zone 'Asia/Seoul')::date,
  count int  not null default 0,
  primary key (owner, day)
);
alter table public.ai_usage enable row level security;
create policy own_ai_usage on public.ai_usage for select to authenticated using (owner = auth.uid());

-- 상한 안이면 1 올리고 true, 넘으면 false
create or replace function public.ai_take(p_limit int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if auth.uid() is null then return false; end if;
  insert into public.ai_usage (owner, day, count)
  values (auth.uid(), (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (owner, day) do update set count = ai_usage.count + 1
  returning count into v;
  return v <= p_limit;
end $$;
revoke all on function public.ai_take(int) from public, anon;
grant execute on function public.ai_take(int) to authenticated;
