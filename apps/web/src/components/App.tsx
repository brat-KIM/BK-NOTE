import { isSameKstDay, orderTree, sortByKey, type Context, type Item, type Size, type SyncStatus } from '@bk-note/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../app/services';
import { captureText } from '../app/capture';
import { AuthPanel } from './AuthPanel';
import { Header } from './Header';
import { ItemList } from './ItemList';
import { ItemMenu } from './ItemMenu';
import { QuickAdd } from './QuickAdd';
import { SettingsPanel } from './SettingsPanel';
import { StaleCard } from './StaleCard';
import { TrashView } from './TrashView';

type Filter = { contexts: Context[]; sizes: Size[]; today: boolean };
const NO_FILTER: Filter = { contexts: [], sizes: [], today: false };

function readLS(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLS(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* 무시 */ }
}

export function App({ needsLogin }: { needsLogin: boolean }) {
  const services = useServices();
  const { db, store, sync } = services;
  const lists = useLiveQuery(async () => sortByKey((await db.lists.toArray()).filter((l) => !l.deleted_at)), [db]);
  const [listId, setListId] = useState<string | null>(() => readLS('bk.list'));
  const [view, setView] = useState<'list' | 'trash' | 'settings'>('list');
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [menu, setMenu] = useState<{ item: Item; anchor: HTMLElement } | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = lists?.find((l) => l.id === listId) ?? lists?.[1] ?? lists?.[0] ?? null;

  useEffect(() => {
    if (current) writeLS('bk.list', current.id);
  }, [current]);

  useEffect(() => {
    if (!sync) return;
    const off = sync.onStatus(setStatus);
    return () => void off();
  }, [sync]);

  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.items.each((i) => {
      if (!i.deleted_at && !i.done_at && !i.parent_id) m.set(i.list_id, (m.get(i.list_id) ?? 0) + 1);
    });
    return m;
  }, [db]);

  const items = useLiveQuery(
    async () => (current ? orderTree((await db.items.where('list_id').equals(current.id).toArray()).filter((i) => !i.deleted_at)) : []),
    [db, current?.id],
  );

  const visible = useMemo(() => applyFilter(items ?? [], filter), [items, filter]);

  const showToast = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const trash = useCallback(async (item: Item) => {
    await store.trash(item.id);
    showToast('휴지통으로 보냈어', () => void store.restore(item.id));
  }, [showToast, store]);

  const add = useCallback(async (text: string) => {
    if (!current || !lists) return;
    const res = await captureText(services, lists, current, text);
    if (res.count > 1) showToast(`${res.count}개 항목으로 넣었어`);
  }, [current, lists, services, showToast]);

  // 단축키: Ctrl+F 검색 대신 빠른 입력 포커스(검색은 P3 필터 칩), Delete 로 메뉴 항목 지우기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        quickRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!lists || !current) return <div className="loading">불러오는 중…</div>;

  return (
    <div className="app">
      <Header status={status} onSettings={() => setView(view === 'settings' ? 'list' : 'settings')} />
      {needsLogin && <AuthPanel />}
      <QuickAdd onAdd={add} inputRef={quickRef} />
      <nav className="tabs" role="tablist">
        {lists.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={view === 'list' && l.id === current.id}
            className={`tab${view === 'list' && l.id === current.id ? ' on' : ''}`}
            onClick={() => { setListId(l.id); setView('list'); }}
          >
            {l.name}
            {!!counts?.get(l.id) && <span className="count">{counts.get(l.id)}</span>}
          </button>
        ))}
        <button className={`tab${view === 'trash' ? ' on' : ''}`} onClick={() => setView(view === 'trash' ? 'list' : 'trash')} aria-label="휴지통">🗑</button>
      </nav>
      {view === 'list' && (
        <>
          <FilterChips filter={filter} onChange={setFilter} />
          <StaleCard list={current} items={items ?? []} />
          <ItemList list={current} items={visible} onMenu={(item, anchor) => setMenu({ item, anchor })} />
        </>
      )}
      {view === 'trash' && <TrashView />}
      {view === 'settings' && <SettingsPanel onClose={() => setView('list')} />}
      {menu && (
        <ItemMenu
          item={(items ?? []).find((i) => i.id === menu.item.id) ?? menu.item}
          lists={lists}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onTrash={trash}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }}>되돌리기</button>}
        </div>
      )}
    </div>
  );
}

function applyFilter(items: Item[], f: Filter): Item[] {
  if (!f.contexts.length && !f.sizes.length && !f.today) return items;
  const now = new Date();
  const okRoot = (i: Item) =>
    (!f.contexts.length || i.contexts.some((c) => f.contexts.includes(c))) &&
    (!f.sizes.length || (i.size !== null && f.sizes.includes(i.size))) &&
    (!f.today || (!!i.remind_at && (isSameKstDay(new Date(i.remind_at), now) || new Date(i.remind_at) < now)));
  const keep = new Set(items.filter((i) => !i.parent_id && okRoot(i)).map((i) => i.id));
  return items.filter((i) => keep.has(i.id) || (i.parent_id && keep.has(i.parent_id)));
}

function FilterChips({ filter, onChange }: { filter: Filter; onChange(f: Filter): void }) {
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const chip = (label: string, on: boolean, fn: () => void) => (
    <button className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={fn}>{label}</button>
  );
  return (
    <div className="filters" aria-label="필터">
      {chip('🏢', filter.contexts.includes('office'), () => onChange({ ...filter, contexts: toggle(filter.contexts, 'office') }))}
      {chip('🏠', filter.contexts.includes('home'), () => onChange({ ...filter, contexts: toggle(filter.contexts, 'home') }))}
      {chip('📱', filter.contexts.includes('phone'), () => onChange({ ...filter, contexts: toggle(filter.contexts, 'phone') }))}
      {chip('⚡5분', filter.sizes.includes('5m'), () => onChange({ ...filter, sizes: toggle(filter.sizes, '5m') }))}
      {chip('⏱️30분', filter.sizes.includes('30m'), () => onChange({ ...filter, sizes: toggle(filter.sizes, '30m') }))}
      {chip('⏰오늘', filter.today, () => onChange({ ...filter, today: !filter.today }))}
    </div>
  );
}
