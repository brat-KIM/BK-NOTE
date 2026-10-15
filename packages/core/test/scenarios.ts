// 서버 구현(메모리 서버 / Postgres SQL 함수)과 상관없이 똑같이 성립해야 하는 동기화 시나리오.
import { expect } from 'vitest';
import { LocalDB } from '../src/db';
import { textDoc } from '../src/model';
import { NoteStore } from '../src/store';
import { SyncEngine } from '../src/sync';
import type { ServerAdapter } from '../src/server/protocol';

export interface Net extends ServerAdapter {
  setOnline(v: boolean): void;
}

export interface Dev {
  db: LocalDB;
  store: NoteStore;
  sync: SyncEngine;
  net: Net;
}

export type MakeNet = () => Net;

export async function dev(makeNet: MakeNet, name: string): Promise<Dev> {
  const db = new LocalDB(`sc-${name}-${Math.random()}`);
  const store = new NoteStore(db, name);
  const net = makeNet();
  const sync = new SyncEngine(db, net, name, { debounceMs: 0, backoffMs: [5] });
  store.onChange((u) => sync.notify(u));
  await sync.start();
  return { db, store, sync, net };
}

export async function settleAll(...ds: Dev[]) {
  for (let i = 0; i < 3; i++) {
    for (const d of ds) await d.sync.flush();
    for (const d of ds) await d.sync.pull();
    await new Promise((r) => setTimeout(r, 5));
  }
}

export const scenarios: Record<string, (mk: MakeNet) => Promise<void>> = {
  async '적은 항목이 다른 기기에 전파'(mk) {
    const a = await dev(mk, 'a');
    const b = await dev(mk, 'b');
    const [, todo] = await a.store.ensureDefaultLists();
    await a.store.addItem({ listId: todo!.id, text: '서류 확인', attrs: { contexts: ['phone'], size: '5m', remind_at: '2026-10-16T00:00:00.000Z' } });
    await settleAll(a, b);
    const items = await b.db.items.toArray();
    expect(items.map((i) => i.plain)).toEqual(['서류 확인']);
    expect(items[0]!.contexts).toEqual(['phone']);
    expect(items[0]!.size).toBe('5m');
    expect(items[0]!.remind_at).toBe('2026-10-16T00:00:00.000Z');
    expect(items[0]!.version).toBe(1);
    expect(await b.db.lists.count()).toBe(4);
  },

  async '오프라인 작성 후 재접속 시 업로드'(mk) {
    const a = await dev(mk, 'a');
    const b = await dev(mk, 'b');
    const [, todo] = await a.store.ensureDefaultLists();
    await settleAll(a, b);
    b.net.setOnline(false);
    await b.store.addItem({ listId: todo!.id, text: '오프라인 1' });
    await b.store.addItem({ listId: todo!.id, text: '오프라인 2' });
    await settleAll(b);
    expect(await b.db.outbox.count()).toBe(2);
    b.net.setOnline(true);
    await settleAll(a, b);
    expect(await b.db.outbox.count()).toBe(0);
    expect((await a.store.listItems(todo!.id)).map((i) => i.plain)).toEqual(['오프라인 1', '오프라인 2']);
  },

  async '본문 동시 수정 → 충돌 사본'(mk) {
    const a = await dev(mk, 'a');
    const b = await dev(mk, 'b');
    const [, todo] = await a.store.ensureDefaultLists();
    const it = await a.store.addItem({ listId: todo!.id, text: '원본' });
    await settleAll(a, b);
    b.net.setOnline(false);
    await a.store.setContent(it.id, textDoc('사무실 수정'));
    await settleAll(a);
    await b.store.setContent(it.id, textDoc('집 수정'));
    b.net.setOnline(true);
    await settleAll(a, b);
    for (const d of [a, b]) {
      expect((await d.store.listItems(todo!.id)).map((i) => i.plain)).toEqual(['사무실 수정', '⚠️ 충돌 사본 · 집 수정']);
    }
  },

  async '본문 vs 완료 체크 → 필드별 병합'(mk) {
    const a = await dev(mk, 'a');
    const b = await dev(mk, 'b');
    const [, todo] = await a.store.ensureDefaultLists();
    const it = await a.store.addItem({ listId: todo!.id, text: 'x' });
    await settleAll(a, b);
    b.net.setOnline(false);
    await a.store.setContent(it.id, textDoc('본문 수정'));
    await settleAll(a);
    await b.store.toggleDone(it.id);
    b.net.setOnline(true);
    await settleAll(a, b);
    for (const d of [a, b]) {
      const row = (await d.db.items.get(it.id))!;
      expect(row.plain).toBe('본문 수정');
      expect(row.done_at).not.toBeNull();
      expect(await d.db.items.count()).toBe(1);
    }
  },

  async '같은 기기가 같은 본문을 다시 보내도 충돌 아님(재시도 멱등)'(mk) {
    const a = await dev(mk, 'a');
    const [, todo] = await a.store.ensureDefaultLists();
    const it = await a.store.addItem({ listId: todo!.id, text: 'v1' });
    await settleAll(a);
    const req = { table: 'items' as const, id: it.id, patch: { plain: 'v2', content: textDoc('v2') }, base: { plain: 'v1', content: textDoc('v1') }, insert: false, device: 'a' };
    const r1 = await a.net.save(req);
    const r2 = await a.net.save(req);
    expect(r1.copy ?? null).toBeNull();
    expect(r2.copy ?? null).toBeNull();
    expect((r2.row as { plain: string }).plain).toBe('v2');
  },

  async '휴지통 삭제 전파 + 이미 사라진 행 수정은 무시'(mk) {
    const a = await dev(mk, 'a');
    const b = await dev(mk, 'b');
    const [, todo] = await a.store.ensureDefaultLists();
    const it = await a.store.addItem({ listId: todo!.id, text: 'x' });
    await settleAll(a, b);
    await b.store.trash(it.id);
    await settleAll(a, b);
    expect(await a.store.listItems(todo!.id)).toHaveLength(0);
    const r = await a.net.save({ table: 'items', id: crypto.randomUUID(), patch: { plain: 'ghost' }, base: {}, insert: false, device: 'a' });
    expect(r.row).toBeNull();
  },
};
