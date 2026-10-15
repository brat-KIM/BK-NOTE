// AI 제안 UI. 원칙: 몰래 고치지 않는다 — 항상 「제안 → 미리보기 → 적용」, 적용 후 되돌리기 가능.
import {
  ageDays, kstToIso, nowKstString, textDoc, type Item, type List, type TaskOutput,
} from '@bk-note/core';
import { useEffect, useState } from 'react';
import { useServices } from '../app/services';

function useAiCall() {
  const { ai } = useServices();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const call = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr((e as Error).message || 'AI 실패');
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { ai, busy, err, call };
}

const brief = (i: Item) => ({ id: i.id, text: i.plain, age_days: ageDays(i.created_at), size: i.size, contexts: i.contexts });

/** 묵은 일 카드 안: 💡 AI 제안 */
export function AiStaleHelp({ item }: { item: Item }) {
  const { store } = useServices();
  const { ai, busy, err, call } = useAiCall();
  const [s, setS] = useState<TaskOutput<'stale'>['suggestions'][number] | null>(null);
  if (!ai || item.no_ai) return null;
  const label = { do_now: '지금 바로', schedule: '날짜 정하기', split: '쪼개기', delete: '지워도 될 듯' } as const;
  return (
    <div className="ai-help">
      {!s && (
        <button className="chip ai" disabled={busy} onClick={async () => {
          const out = await call(() => ai.run('stale', { items: [brief(item)] }));
          setS(out?.suggestions.find((x) => x.id === item.id) ?? out?.suggestions[0] ?? null);
        }}>{busy ? '생각 중…' : '💡 AI 제안'}</button>
      )}
      {s && (
        <p className="ai-say">
          ✨ <b>{label[s.action]}</b> — {s.reason}
          {s.first_step && (
            <>
              <br />첫 단계: {s.first_step}{' '}
              <button className="chip" onClick={() => void store.addItem({ listId: item.list_id, afterId: item.id, text: s.first_step!, attrs: { size: '5m' } })}>
                ＋ 항목으로
              </button>
            </>
          )}
        </p>
      )}
      {err && <span className="error">{err}</span>}
    </div>
  );
}

/** 붙여넣은 덩어리 → AI 가 할 일로 나눈 미리보기 → 고른 것만 추가 */
export function SplitPreview({ text, lists, current, onClose, onDone }: {
  text: string; lists: List[]; current: List; onClose(): void; onDone(count: number): void;
}) {
  const { store } = useServices();
  const { ai, busy, err, call } = useAiCall();
  const [items, setItems] = useState<TaskOutput<'split'>['items'] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!ai) return;
    let alive = true;
    void call(() => ai.run('split', { text, nowKst: nowKstString(), lists: lists.map((l) => ({ name: l.name })) })).then((out) => {
      if (out && alive) {
        setItems(out.items);
        setPicked(new Set(out.items.map((_, i) => i)));
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  if (!ai) return null;
  const add = async () => {
    let n = 0;
    for (const [i, it] of (items ?? []).entries()) {
      if (!picked.has(i)) continue;
      const list = (it.list && lists.find((l) => l.name === it.list)) || current;
      await store.addItem({ listId: list.id, text: it.text, attrs: { remind_at: kstToIso(it.remind_at_kst), contexts: [...it.contexts], size: it.size } });
      n += 1;
    }
    onDone(n);
  };
  const addRaw = async () => {
    await store.addItem({ listId: current.id, text: text.replace(/\s+/g, ' ').trim() });
    onDone(1);
  };
  return (
    <section className="card ai-panel" aria-label="AI 나누기">
      <h3>✨ 붙여넣은 내용을 나눠 봤어</h3>
      {busy && <p className="hint">나누는 중…</p>}
      {err && <p className="error">{err}</p>}
      {items && (
        <ul className="pick">
          {items.map((it, i) => (
            <li key={i}>
              <label>
                <input type="checkbox" checked={picked.has(i)}
                  onChange={() => { const n = new Set(picked); if (n.has(i)) n.delete(i); else n.add(i); setPicked(n); }} />
                {' '}{it.text}
                {it.remind_at_kst && <span className="badge remind"> ⏰{it.remind_at_kst.slice(5)}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        {items && <button className="chip on" onClick={() => void add()}>{picked.size}개 추가</button>}
        <button className="chip" onClick={() => void addRaw()}>그냥 한 줄로</button>
        <button className="link" onClick={onClose}>취소</button>
      </div>
    </section>
  );
}

/** 항목 메뉴: ✨ 다듬기(아이디어 3~5줄 + 다음 행동) */
export function RefineBox({ item, onClose }: { item: Item; onClose(): void }) {
  const { store } = useServices();
  const { ai, busy, err, call } = useAiCall();
  const [out, setOut] = useState<TaskOutput<'refine'> | null>(null);
  if (!ai || item.no_ai) return null;
  return (
    <div className="menu-row ai-refine">
      {!out && (
        <button className="chip ai" disabled={busy || !item.plain}
          onClick={async () => setOut(await call(() => ai.run('refine', { text: item.plain })))}>
          {busy ? '다듬는 중…' : '✨ AI 다듬기'}
        </button>
      )}
      {out && (
        <div className="ai-say">
          <pre>{out.text}</pre>
          {out.next_action && <p>다음 행동: {out.next_action}</p>}
          <button className="chip on" onClick={async () => {
            await store.updateItem(item.id, { content: textDoc(out.text) });
            if (out.next_action) await store.addItem({ listId: item.list_id, parentId: item.id, text: `다음 행동: ${out.next_action}` });
            onClose();
          }}>적용</button>
          <button className="link" onClick={() => setOut(null)}>버리기</button>
        </div>
      )}
      {err && <span className="error">{err}</span>}
    </div>
  );
}

/** 🎯 짬 추천: AI 가 있으면 AI, 없으면 규칙(시간 안에 끝날 것 + 오래 묵은 것) */
export function SlotPanel({ items, onClose, onPick }: { items: Item[]; onClose(): void; onPick(ids: string[]): void }) {
  const { ai, busy, err, call } = useAiCall();
  const [minutes, setMinutes] = useState(15);
  const [place, setPlace] = useState<'office' | 'home' | 'phone' | null>(null);
  const [result, setResult] = useState<{ ids: string[]; reason: string } | null>(null);
  const candidates = items.filter((i) => !i.parent_id && !i.done_at && !i.deleted_at);
  const run = async () => {
    const ruled = ruleSlot(candidates, minutes, place);
    if (!ai) return setResult(ruled);
    const usable = candidates.filter((i) => !i.no_ai).slice(0, 40);
    const out = await call(() => ai.run('slot', { minutes, place, items: usable.map(brief) }));
    const ids = (out?.ids ?? []).filter((id) => candidates.some((c) => c.id === id));
    setResult(ids.length ? { ids, reason: `✨ ${out!.reason}` } : ruled);
  };
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return (
    <section className="card ai-panel" aria-label="짬 추천">
      <h3>🎯 지금 짬에 할 만한 것</h3>
      <div className="actions">
        {[5, 15, 30, 60].map((m) => (
          <button key={m} className={`chip${minutes === m ? ' on' : ''}`} onClick={() => setMinutes(m)}>{m}분</button>
        ))}
      </div>
      <div className="actions">
        {([['office', '🏢'], ['home', '🏠'], ['phone', '📱']] as const).map(([p, l]) => (
          <button key={p} className={`chip${place === p ? ' on' : ''}`} onClick={() => setPlace(place === p ? null : p)}>{l}</button>
        ))}
        <button className="chip on" disabled={busy} onClick={() => void run()}>{busy ? '고르는 중…' : '추천'}</button>
        <button className="link" onClick={onClose}>닫기</button>
      </div>
      {err && <p className="error">{err} — 규칙으로 골랐어</p>}
      {result && (
        <>
          <ol className="pick">{result.ids.map((id) => <li key={id}>{byId.get(id)?.plain}</li>)}</ol>
          {!result.ids.length && <p className="hint">맞는 게 없네. 시간을 늘려 봐.</p>}
          <p className="hint">{result.reason}</p>
          {!!result.ids.length && <button className="chip" onClick={() => onPick(result.ids)}>📌 위에 고정</button>}
        </>
      )}
    </section>
  );
}

const SIZE_MIN: Record<string, number> = { '5m': 5, '30m': 30, big: 120 };

export function ruleSlot(items: Item[], minutes: number, place: string | null) {
  const fits = items.filter((i) => (i.size ? SIZE_MIN[i.size]! <= minutes : minutes >= 15)
    && (!place || !i.contexts.length || i.contexts.includes(place as never)));
  const ranked = fits.sort((a, b) => (SIZE_MIN[a.size ?? '30m']! - SIZE_MIN[b.size ?? '30m']!) || a.created_at.localeCompare(b.created_at));
  return { ids: ranked.slice(0, 3).map((i) => i.id), reason: '시간 안에 끝날 것 중 오래된 순서로 골랐어' };
}
