import { orderTree, sortByKey } from '@bk-note/core';
import type { Services } from './services';

export async function exportJson({ db }: Services) {
  const [lists, items] = await Promise.all([db.lists.toArray(), db.items.toArray()]);
  return JSON.stringify({ exportedAt: new Date().toISOString(), lists, items }, null, 2);
}

export async function exportMarkdown({ db }: Services) {
  const lists = sortByKey((await db.lists.toArray()).filter((l) => !l.deleted_at));
  const out: string[] = [`# BK-NOTE (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`, ''];
  for (const l of lists) {
    out.push(`## ${l.name}`, '');
    const items = orderTree((await db.items.where('list_id').equals(l.id).toArray()).filter((i) => !i.deleted_at));
    for (const i of items) out.push(`${i.parent_id ? '  ' : ''}- [${i.done_at ? 'x' : ' '}] ${i.plain.replace(/\n/g, ' ')}`);
    out.push('');
  }
  return out.join('\n');
}
