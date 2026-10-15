-- BK-NOTE 스키마 v1 (docs/DESIGN.md 5.4)
-- 항목 하나 = 행 하나. 저장은 save_row(), 받기는 pull_rows() 로만 한다(필드별 충돌 판정을 서버에서).

create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  kind        text not null default 'normal' check (kind in ('normal', 'daily')),
  sort_key    text not null,
  version     int  not null default 1,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.items (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id       uuid not null references public.lists(id) on delete cascade,
  parent_id     uuid references public.items(id) on delete set null,
  content       jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}',
  plain         text  not null default '',
  color         text,
  pinned        boolean not null default false,
  contexts      text[]  not null default '{}',
  size          text check (size in ('5m', '30m', 'big')),
  remind_at     timestamptz,
  snoozed_until timestamptz,
  done_at       timestamptz,
  deleted_at    timestamptz,
  no_ai         boolean not null default false,
  sort_key      text not null,
  version       int  not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text,
  -- 서버 전용: 이 알림 시각에 대해 푸시를 보냈는지
  notified_for  timestamptz
);

create index items_owner_updated on public.items (owner, updated_at);
create index lists_owner_updated on public.lists (owner, updated_at);
create index items_due on public.items (coalesce(snoozed_until, remind_at))
  where remind_at is not null and done_at is null and deleted_at is null;

-- 기기 목록: 웹 푸시 구독(폰·브라우저)과 「지금 쓰는 중」 표시(데스크톱 사용 중이면 폰 푸시 생략)
create table public.devices (
  owner        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id    text not null,
  name         text not null default '',
  kind         text not null default 'web' check (kind in ('web', 'desktop')),
  push         jsonb,
  last_active  timestamptz not null default now(),
  primary key (owner, device_id)
);

-- ───────── RLS: 본인 행만 ─────────
alter table public.lists enable row level security;
alter table public.items enable row level security;
alter table public.devices enable row level security;

create policy own_lists on public.lists for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy own_items on public.items for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy own_devices on public.devices for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ───────── 버전·시각은 서버가 찍는다 ─────────
create or replace function public.bump_row() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.updated_at := clock_timestamp();
  else
    new.version := old.version + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;

create trigger lists_bump before insert or update on public.lists for each row execute function public.bump_row();
create trigger items_bump before insert or update on public.items for each row execute function public.bump_row();

-- ───────── 충돌 사본 본문: 첫 문단 앞에 표시 ─────────
create or replace function public.conflict_copy_content(p_doc jsonb) returns jsonb language sql immutable as $$
  select case
    when jsonb_typeof(p_doc -> 'content') = 'array' and jsonb_array_length(p_doc -> 'content') > 0 then
      jsonb_set(p_doc, '{content,0,content}',
        jsonb_build_array(jsonb_build_object('type', 'text', 'text', '⚠️ 충돌 사본 · '))
          || coalesce(p_doc #> '{content,0,content}', '[]'::jsonb))
    else
      jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
        'type', 'paragraph', 'content',
        jsonb_build_array(jsonb_build_object('type', 'text', 'text', '⚠️ 충돌 사본 · ')))))
  end
$$;

-- ───────── 저장 ─────────
-- p_patch: 바꾼 필드, p_base: 바꾸기 전에 내가 알던 값.
-- 본문(content/plain)이 그새 다른 기기에서 바뀌었으면 서버 값을 유지하고 내 본문은 「충돌 사본」 항목으로 만든다.
-- 나머지 필드는 나중에 저장한 쪽이 이긴다. 결과: {"row": 저장된 행 | null, "copy": 사본 | null}
create or replace function public.save_row(
  p_table text, p_id uuid, p_patch jsonb, p_base jsonb, p_insert boolean, p_device text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  item_fields constant text[] := array['list_id','parent_id','content','plain','color','pinned','contexts','size',
    'remind_at','snoozed_until','done_at','deleted_at','no_ai','sort_key'];
  list_fields constant text[] := array['name','kind','sort_key','deleted_at'];
  v_patch jsonb := '{}';
  k text;
  cur_item public.items;
  cur_list public.lists;
  nxt_item public.items;
  nxt_list public.lists;
  copy_item public.items;
  v_conflict boolean := false;
  v_cur jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  for k in select jsonb_object_keys(p_patch) loop
    if (p_table = 'items' and k = any(item_fields)) or (p_table = 'lists' and k = any(list_fields)) then
      v_patch := v_patch || jsonb_build_object(k, p_patch -> k);
    end if;
  end loop;

  if p_table = 'lists' then
    select * into cur_list from public.lists where id = p_id for update;
    if not found then
      if not p_insert then return jsonb_build_object('row', null, 'copy', null); end if;
      insert into public.lists
        select * from jsonb_populate_record(null::public.lists,
          jsonb_build_object('kind', 'normal') || v_patch
          || jsonb_build_object('id', p_id, 'owner', auth.uid(), 'version', 1, 'updated_at', now()))
        returning * into nxt_list;
    else
      update public.lists l set
        name = r.name, kind = r.kind, sort_key = r.sort_key, deleted_at = r.deleted_at
      from jsonb_populate_record(cur_list, v_patch) r
      where l.id = p_id
      returning l.* into nxt_list;
    end if;
    return jsonb_build_object('row', to_jsonb(nxt_list), 'copy', null);
  end if;

  if p_table <> 'items' then
    raise exception 'unknown table %', p_table;
  end if;

  select * into cur_item from public.items where id = p_id for update;
  if not found then
    if not p_insert then return jsonb_build_object('row', null, 'copy', null); end if;
    insert into public.items
      select * from jsonb_populate_record(null::public.items,
        jsonb_build_object(
          'content', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, 'plain', '',
          'pinned', false, 'contexts', '[]'::jsonb, 'no_ai', false)
        || v_patch
        || jsonb_build_object('id', p_id, 'owner', auth.uid(), 'version', 1,
             'created_at', now(), 'updated_at', now(), 'updated_by', p_device))
      returning * into nxt_item;
    return jsonb_build_object('row', to_jsonb(nxt_item) - 'owner' - 'notified_for', 'copy', null);
  end if;

  v_cur := to_jsonb(cur_item);
  foreach k in array array['content', 'plain'] loop
    if v_patch ? k and p_base ? k
       and (v_cur -> k) is distinct from (p_base -> k)
       and (v_cur -> k) is distinct from (v_patch -> k) then
      v_conflict := true;
    end if;
  end loop;

  if v_conflict then
    v_patch := v_patch - 'content' - 'plain';
  end if;

  update public.items i set
    list_id = r.list_id, parent_id = r.parent_id, content = r.content, plain = r.plain, color = r.color,
    pinned = r.pinned, contexts = r.contexts, size = r.size, remind_at = r.remind_at,
    snoozed_until = r.snoozed_until, done_at = r.done_at, deleted_at = r.deleted_at, no_ai = r.no_ai,
    sort_key = r.sort_key, updated_by = p_device
  from jsonb_populate_record(cur_item, v_patch) r
  where i.id = p_id
  returning i.* into nxt_item;

  if v_conflict then
    insert into public.items (list_id, parent_id, content, plain, sort_key, updated_by, owner)
    values (
      nxt_item.list_id, nxt_item.parent_id,
      public.conflict_copy_content(coalesce(p_patch -> 'content', to_jsonb(nxt_item) -> 'content')),
      '⚠️ 충돌 사본 · ' || coalesce(p_patch ->> 'plain', nxt_item.plain),
      nxt_item.sort_key || 'V', p_device, auth.uid())
    returning * into copy_item;
  end if;

  return jsonb_build_object(
    'row', to_jsonb(nxt_item) - 'owner' - 'notified_for',
    'copy', case when v_conflict then to_jsonb(copy_item) - 'owner' - 'notified_for' else null end);
end $$;

-- ───────── 받기 ─────────
-- p_since 이후(시계 오차 여유 5초) 바뀐 내 행. 삭제(휴지통)도 행으로 온다.
create or replace function public.pull_rows(p_since timestamptz) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'owner' - 'notified_for') from public.items i
                       where i.owner = auth.uid() and (p_since is null or i.updated_at > p_since - interval '5 seconds')), '[]'),
    'lists', coalesce((select jsonb_agg(to_jsonb(l) - 'owner') from public.lists l
                       where l.owner = auth.uid() and (p_since is null or l.updated_at > p_since - interval '5 seconds')), '[]'),
    'server_time', now()
  )
$$;

-- ───────── 새벽 정리(pg_cron 이 매일 04:00 KST 에 호출) ─────────
-- 지난 04:00(KST) 이전에 완료한 항목: 일반 섹션 → 휴지통, 📌매일(daily) 섹션 → 체크 해제.
-- 휴지통 30일 지난 행은 영구 삭제.
create or replace function public.cleanup_daily(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Seoul';
  v_cut timestamptz;
  n_trashed int; n_unchecked int; n_purged int;
begin
  v_cut := (date_trunc('day', v_local) + interval '4 hours') at time zone 'Asia/Seoul';
  if v_cut > p_now then v_cut := v_cut - interval '1 day'; end if;

  update public.items i set deleted_at = p_now, updated_by = 'server'
  from public.lists l
  where l.id = i.list_id and l.kind = 'normal'
    and i.done_at is not null and i.done_at < v_cut and i.deleted_at is null;
  get diagnostics n_trashed = row_count;

  update public.items i set done_at = null, updated_by = 'server'
  from public.lists l
  where l.id = i.list_id and l.kind = 'daily'
    and i.done_at is not null and i.done_at < v_cut and i.deleted_at is null;
  get diagnostics n_unchecked = row_count;

  delete from public.items where deleted_at < p_now - interval '30 days';
  get diagnostics n_purged = row_count;
  delete from public.lists where deleted_at < p_now - interval '30 days';

  return jsonb_build_object('cutoff', v_cut, 'trashed', n_trashed, 'unchecked', n_unchecked, 'purged', n_purged);
end $$;

revoke all on function public.cleanup_daily(timestamptz) from public, anon, authenticated;
grant execute on function public.save_row(text, uuid, jsonb, jsonb, boolean, text) to authenticated;
grant execute on function public.pull_rows(timestamptz) to authenticated;
grant select, insert, update, delete on public.lists, public.items, public.devices to authenticated;

-- ───────── 실시간(Supabase Realtime) ─────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.items, public.lists;
  end if;
end $$;
