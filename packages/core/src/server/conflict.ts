import type { RichDoc } from '../model';

export const CONFLICT_PREFIX = '⚠️ 충돌 사본 · ';

/** 충돌 사본 본문: 첫 문단 앞에 표시를 붙인다. */
export function conflictCopyContent(doc: RichDoc): RichDoc {
  const copy: RichDoc = structuredClone(doc);
  const first = copy.content?.[0];
  const mark = { type: 'text', text: CONFLICT_PREFIX };
  if (first) first.content = [mark, ...(first.content ?? [])];
  else copy.content = [{ type: 'paragraph', content: [mark] }];
  return copy;
}
