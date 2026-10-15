import { parseCapture, type List } from '@bk-note/core';
import type { Services } from './services';

/**
 * 빠른 입력·공유하기·붙여넣기 공통 처리.
 * 여러 줄이면 줄마다 항목. 날짜·태그(@폰 !5 내일 3시)는 기기 안 규칙 파서가 해석한다.
 */
export async function captureText(services: Services, lists: List[], current: List, raw: string) {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)]|\[[ xX]?\])\s*/, '').trim()).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    const p = parseCapture(line, new Date());
    const target = (p.listHint && lists.find((l) => l.name.includes(p.listHint!))) || current;
    await services.store.addItem({
      listId: target.id,
      text: p.text,
      attrs: {
        remind_at: p.remindAt,
        contexts: p.contexts,
        size: p.size,
      },
    });
    count += 1;
  }
  return { count };
}
