import { ageDays, formatRemind, type Item, type RichDoc } from '@bk-note/core';
import type { Editor } from '@tiptap/react';
import { memo } from 'react';
import { ItemEditor, type ItemKeyHandlers } from '../editor/ItemEditor';
import { RichText } from '../editor/RichText';

const CONTEXT_ICON: Record<string, string> = { office: '🏢', home: '🏠', phone: '📱' };
const SIZE_ICON: Record<string, string> = { '5m': '⚡', '30m': '⏱️', big: '🧱' };

interface Props {
  item: Item;
  editing: false | 'start' | 'end';
  daily: boolean;
  handlers: ItemKeyHandlers;
  onStartEdit(caret: 'start' | 'end'): void;
  onToggleDone(): void;
  onContent(doc: RichDoc): void;
  onBlur(doc: RichDoc): void;
  onMenu(anchor: HTMLElement): void;
  onEditor(ed: Editor | null): void;
}

export const ItemRow = memo(function ItemRow(p: Props) {
  const { item } = p;
  const done = !!item.done_at;
  const age = ageDays(item.created_at);
  return (
    <li
      className={`item${done ? ' done' : ''}${item.parent_id ? ' child' : ''}${item.pinned ? ' pinned' : ''}`}
      data-id={item.id}
      style={item.color ? { borderLeftColor: item.color } : undefined}
    >
      <button
        className={`check${done ? ' on' : ''}`}
        aria-label={done ? '완료 취소' : '완료'}
        role="checkbox"
        aria-checked={done}
        onClick={p.onToggleDone}
      >
        {done ? '✓' : ''}
      </button>
      <div className="body" onMouseDown={(e) => {
        if (!p.editing && !(e.target as HTMLElement).closest('a')) {
          e.preventDefault();
          p.onStartEdit('end');
        }
      }}>
        {p.editing ? (
          <ItemEditor
            content={item.content}
            caret={p.editing}
            handlers={p.handlers}
            onChange={p.onContent}
            onBlur={p.onBlur}
            onEditor={p.onEditor}
          />
        ) : (
          <div className="rt">{item.plain ? <RichText doc={item.content} /> : <span className="ph">빈 항목</span>}</div>
        )}
      </div>
      <div className="badges">
        {item.pinned && <span className="badge" title="고정">📌</span>}
        {item.remind_at && <span className="badge remind" title="알림">⏰{formatRemind(item.remind_at)}</span>}
        {item.contexts.map((c) => <span key={c} className="badge" title={c}>{CONTEXT_ICON[c]}</span>)}
        {item.size && <span className="badge" title="크기">{SIZE_ICON[item.size]}</span>}
        {item.no_ai && <span className="badge" title="AI 제외">🔒</span>}
        {!done && !p.daily && !item.parent_id && age >= 7 && (
          <span className={`badge age${age >= 14 ? ' old' : ''}`} title="만든 지">{age}일</span>
        )}
      </div>
      <button className="more" aria-label="항목 메뉴" onClick={(e) => p.onMenu(e.currentTarget)}>⋯</button>
    </li>
  );
});
