import { sortByKey, type Item, type List, type RichDoc } from '@bk-note/core';
import type { Editor } from '@tiptap/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useServices } from '../app/services';
import type { ItemKeyHandlers } from '../editor/ItemEditor';
import { FormatBar } from './FormatBar';
import { ItemRow } from './ItemRow';

interface Props {
  list: List;
  items: Item[];
  onMenu(item: Item, anchor: HTMLElement): void;
}

export function ItemList({ list, items, onMenu }: Props) {
  const { store } = useServices();
  const [editing, setEditing] = useState<{ id: string; caret: 'start' | 'end' } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDoc = useRef<{ id: string; doc: RichDoc } | null>(null);

  const flushPending = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const p = pendingDoc.current;
    pendingDoc.current = null;
    if (p) await store.setContent(p.id, p.doc);
  }, [store]);

  const queueSave = useCallback((id: string, doc: RichDoc) => {
    pendingDoc.current = { id, doc };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushPending(), 250);
  }, [flushPending]);

  const order = items; // 이미 화면 순서(부모 → 메모)
  const siblingsOf = useCallback(
    (it: Item) => sortByKey(items.filter((x) => (x.parent_id ?? null) === (it.parent_id ?? null))),
    [items],
  );

  const handlersFor = useCallback((it: Item): ItemKeyHandlers => ({
    async onEnter(rest) {
      await flushPending();
      const created = await store.addItem({
        listId: list.id,
        afterId: it.id,
        parentId: it.parent_id,
        content: rest ?? undefined,
      });
      setEditing({ id: created.id, caret: 'start' });
    },
    async onIndent() {
      if (it.parent_id) return;
      const sibs = siblingsOf(it);
      const idx = sibs.findIndex((s) => s.id === it.id);
      const prev = sibs[idx - 1];
      if (!prev) return;
      await flushPending();
      const kids = sortByKey(items.filter((x) => x.parent_id === prev.id));
      await store.updateItem(it.id, { parent_id: prev.id });
      await store.move(it.id, kids.at(-1)?.id ?? null, null);
    },
    async onOutdent() {
      if (!it.parent_id) return;
      await flushPending();
      const parent = items.find((x) => x.id === it.parent_id);
      const roots = sortByKey(items.filter((x) => !x.parent_id));
      const pIdx = roots.findIndex((r) => r.id === it.parent_id);
      await store.updateItem(it.id, { parent_id: null });
      await store.move(it.id, parent?.id ?? null, roots[pIdx + 1]?.id ?? null);
    },
    async onToggleDone() {
      await flushPending();
      await store.toggleDone(it.id);
    },
    async onMoveUp() {
      const sibs = siblingsOf(it);
      const idx = sibs.findIndex((s) => s.id === it.id);
      if (idx <= 0) return;
      await flushPending();
      await store.move(it.id, sibs[idx - 2]?.id ?? null, sibs[idx - 1]!.id);
    },
    async onMoveDown() {
      const sibs = siblingsOf(it);
      const idx = sibs.findIndex((s) => s.id === it.id);
      if (idx < 0 || idx >= sibs.length - 1) return;
      await flushPending();
      await store.move(it.id, sibs[idx + 1]!.id, sibs[idx + 2]?.id ?? null);
    },
    async onDeleteEmpty() {
      pendingDoc.current = null;
      const idx = order.findIndex((x) => x.id === it.id);
      const prev = order[idx - 1];
      await store.trash(it.id);
      setEditing(prev ? { id: prev.id, caret: 'end' } : null);
    },
    onFocusPrev() {
      const idx = order.findIndex((x) => x.id === it.id);
      const prev = order[idx - 1];
      if (prev) void flushPending().then(() => setEditing({ id: prev.id, caret: 'end' }));
    },
    onFocusNext() {
      const idx = order.findIndex((x) => x.id === it.id);
      const next = order[idx + 1];
      if (next) void flushPending().then(() => setEditing({ id: next.id, caret: 'start' }));
    },
    onEscape() {
      void flushPending().then(() => setEditing(null));
    },
  }), [flushPending, items, list.id, order, siblingsOf, store]);

  const handlerMap = useMemo(() => new Map(items.map((it) => [it.id, handlersFor(it)])), [items, handlersFor]);

  return (
    <div className="list-wrap">
      {editing && <FormatBar editor={editor} />}
      <ul className="items" aria-label={list.name}>
        {items.map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            daily={list.kind === 'daily'}
            editing={editing?.id === it.id ? editing.caret : false}
            handlers={handlerMap.get(it.id)!}
            onStartEdit={(caret) => void flushPending().then(() => setEditing({ id: it.id, caret }))}
            onToggleDone={() => void flushPending().then(() => store.toggleDone(it.id))}
            onContent={(doc) => queueSave(it.id, doc)}
            onBlur={(doc) => {
              pendingDoc.current = { id: it.id, doc };
              void flushPending();
              setTimeout(() => setEditing((e) => (e?.id === it.id && !document.activeElement?.closest('.item-editor, .formatbar') ? null : e)), 0);
            }}
            onMenu={(anchor) => onMenu(it, anchor)}
            onEditor={setEditor}
          />
        ))}
      </ul>
      {items.length === 0 && <p className="empty">비어 있어. 위에 적으면 여기로 들어와.</p>}
      <button
        className="add-line"
        onClick={async () => {
          const roots = items.filter((x) => !x.parent_id);
          const created = await store.addItem({ listId: list.id, afterId: roots.at(-1)?.id ?? null });
          setEditing({ id: created.id, caret: 'start' });
        }}
      >
        ＋ 새 줄
      </button>
    </div>
  );
}
