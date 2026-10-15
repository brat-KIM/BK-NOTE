import { looksLikeVagueTime, nowKstString, parseCapture, textDoc, toParsed, type Item, type List } from '@bk-note/core';
import type { Services } from './services';

export interface AiNote {
  text: string;
  undo: () => void;
}

/**
 * 빠른 입력·공유하기·붙여넣기 공통 처리.
 * 여러 줄이면 줄마다 항목. 날짜·태그(@폰 !5 내일 3시)는 기기 안 규칙 파서가 즉시 해석하고,
 * 규칙으로 못 푼 애매한 날짜 표현("담주 초쯤")은 AI 가 뒤에서 보정한다(onAiNote 로 알림).
 */
export async function captureText(
  services: Services,
  lists: List[],
  current: List,
  raw: string,
  onAiNote?: (n: AiNote) => void,
) {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)]|\[[ xX]?\])\s*/, '').trim()).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    const p = parseCapture(line, new Date());
    const target = (p.listHint && lists.find((l) => l.name.includes(p.listHint!))) || current;
    const item = await services.store.addItem({
      listId: target.id,
      text: p.text,
      attrs: { remind_at: p.remindAt, contexts: p.contexts, size: p.size },
    });
    count += 1;
    if (services.ai && (await aiEnabled(services)) && (p.fuzzy || (!p.remindAt && looksLikeVagueTime(line)))) {
      void refineWithAi(services, lists, item, line, onAiNote);
    }
  }
  return { count };
}

export async function aiEnabled(services: Services) {
  return (await services.db.getMeta<boolean>('aiEnabled')) !== false;
}

async function refineWithAi(services: Services, lists: List[], item: Item, line: string, onAiNote?: (n: AiNote) => void) {
  try {
    const out = toParsed(await services.ai!.run('parse', { text: line, nowKst: nowKstString(), lists: lists.map((l) => ({ name: l.name })) }));
    if (!out.remindAt && !out.contexts.length && !out.size) return;
    const cur = await services.db.items.get(item.id);
    if (!cur || cur.plain !== item.plain) return; // 그새 사용자가 고쳤으면 건드리지 않는다
    const before = { content: cur.content, remind_at: cur.remind_at, contexts: cur.contexts, size: cur.size, list_id: cur.list_id };
    const list = out.list ? lists.find((l) => l.name === out.list) : undefined;
    await services.store.updateItem(item.id, {
      ...(out.remindAt ? { content: textDoc(out.text || item.plain), remind_at: out.remindAt } : {}),
      contexts: out.contexts.length ? out.contexts : cur.contexts,
      size: out.size ?? cur.size,
      ...(list && list.id !== cur.list_id ? { list_id: list.id } : {}),
    });
    const when = out.remindAt ? new Date(out.remindAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
    onAiNote?.({
      text: `✨ AI: ${when ? `⏰ ${when}` : '태그'}로 잡았어`,
      undo: () => void services.store.updateItem(item.id, before),
    });
  } catch {
    // AI 실패는 조용히 무시(규칙 해석 결과로 이미 저장돼 있음)
  }
}
