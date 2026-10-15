import { fromLocalInput, toLocalInput, type Context, type Item, type List, type Size } from '@bk-note/core';
import { useEffect, useRef } from 'react';
import { useServices } from '../app/services';
import { LABEL_COLORS } from '../editor/marks';
import { RefineBox } from './AiPanels';

interface Props {
  item: Item;
  lists: List[];
  anchor: HTMLElement;
  onClose(): void;
  onTrash(item: Item): void;
}

const CONTEXTS: [Context, string][] = [['office', '🏢 사무실'], ['home', '🏠 집'], ['phone', '📱 폰']];
const SIZES: [Size, string][] = [['5m', '⚡ 5분'], ['30m', '⏱️ 30분'], ['big', '🧱 큰일']];

export function ItemMenu({ item, lists, anchor, onClose, onTrash }: Props) {
  const { store } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  const rect = anchor.getBoundingClientRect();

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);

  const up = (patch: Partial<Item>) => void store.updateItem(item.id, patch);
  const top = Math.min(rect.bottom + 4, window.innerHeight - 380);

  return (
    <div className="menu" ref={ref} role="dialog" aria-label="항목 설정" style={{ top: Math.max(8, top), right: 8 }}>
      <div className="menu-row colors">
        {LABEL_COLORS.map((c) => (
          <button key={c} className={`swatch${item.color === c ? ' on' : ''}`} style={{ background: c }}
            aria-label={`색 ${c}`} onClick={() => up({ color: item.color === c ? null : c })} />
        ))}
      </div>
      <div className="menu-row">
        <button className={`chip${item.pinned ? ' on' : ''}`} onClick={() => up({ pinned: !item.pinned })}>📌 고정</button>
        <button className={`chip${item.no_ai ? ' on' : ''}`} onClick={() => up({ no_ai: !item.no_ai })}>🔒 AI 제외</button>
      </div>
      <div className="menu-row">
        {CONTEXTS.map(([c, label]) => (
          <button key={c} className={`chip${item.contexts.includes(c) ? ' on' : ''}`}
            onClick={() => up({ contexts: item.contexts.includes(c) ? item.contexts.filter((x) => x !== c) : [...item.contexts, c] })}>
            {label}
          </button>
        ))}
      </div>
      <div className="menu-row">
        {SIZES.map(([s, label]) => (
          <button key={s} className={`chip${item.size === s ? ' on' : ''}`} onClick={() => up({ size: item.size === s ? null : s })}>
            {label}
          </button>
        ))}
      </div>
      <label className="menu-row remind">
        ⏰
        <input
          type="datetime-local"
          aria-label="알림 시각"
          value={item.remind_at ? toLocalInput(item.remind_at) : ''}
          onChange={(e) => up({ remind_at: e.target.value ? fromLocalInput(e.target.value) : null, snoozed_until: null })}
        />
        {item.remind_at && <button className="chip" onClick={() => up({ remind_at: null })}>지우기</button>}
      </label>
      <label className="menu-row">
        섹션
        <select value={item.list_id} aria-label="섹션 이동"
          onChange={(e) => void store.move(item.id, null, null, e.target.value).then(() => store.updateItem(item.id, { parent_id: null }))}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <RefineBox item={item} onClose={onClose} />
      <div className="menu-row">
        <button className="chip danger" onClick={() => { onTrash(item); onClose(); }}>🗑 지우기</button>
      </div>
    </div>
  );
}
