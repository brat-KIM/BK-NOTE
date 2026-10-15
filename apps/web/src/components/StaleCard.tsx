import { ageDays, fromKst, kstParts, type Item, type List } from '@bk-note/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useServices } from '../app/services';
import { RichText } from '../editor/RichText';
import { AiStaleHelp } from './AiPanels';

const STALE_DAYS = 14;

/** 묵은 일 정리 카드: 2주 넘은 항목마다 [지금 하기] [내일 알림] [지우기]. 닫으면 7일 뒤 다시. */
export function StaleCard({ list, items }: { list: List; items: Item[] }) {
  const { db, store } = useServices();
  const dismissed = useLiveQuery(() => db.getMeta<string>('staleDismissedAt'), [db]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  if (list.kind === 'daily') return null;
  if (dismissed && Date.now() - Date.parse(dismissed) < 7 * 86400_000) return null;
  const stale = items.filter((i) => !i.parent_id && !i.done_at && !i.pinned && !skipped.has(i.id) && ageDays(i.created_at) >= STALE_DAYS);
  if (!stale.length) return null;
  const tomorrow9 = () => {
    const p = kstParts(new Date(Date.now() + 86400_000));
    return fromKst(p.y, p.m, p.d, 9, 0).toISOString();
  };
  return (
    <section className="card stale" aria-label="묵은 일 정리">
      <h3>🧹 2주 넘게 묵은 일 {stale.length}개 — 정리할까?</h3>
      <ul className="items">
        {stale.slice(0, 5).map((it) => (
          <li key={it.id} className="item">
            <div className="body"><div className="rt"><RichText doc={it.content} /> <span className="badge age old">{ageDays(it.created_at)}일</span></div>
              <AiStaleHelp item={it} />
            </div>
            <div className="actions">
              <button className="chip" onClick={() => void store.updateItem(it.id, { pinned: true })}>📌 지금</button>
              <button className="chip" onClick={() => void store.updateItem(it.id, { remind_at: tomorrow9(), snoozed_until: null })}>⏰ 내일</button>
              <button className="chip" onClick={() => setSkipped(new Set([...skipped, it.id]))}>그대로</button>
              <button className="chip danger" onClick={() => void store.trash(it.id)}>🗑</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="link" onClick={() => void db.setMeta('staleDismissedAt', new Date().toISOString())}>일주일 동안 닫기</button>
      </div>
    </section>
  );
}
