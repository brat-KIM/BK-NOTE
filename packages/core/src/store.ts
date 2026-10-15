// 항목·섹션 조작. 모든 변경은 ① 로컬 DB 즉시 반영 ② outbox 기록 ③ 동기화 엔진에 알림 순서로 처리한다.
import { generateKeyBetween } from 'fractional-indexing';
import type { LocalDB, OutboxEntry } from './db';
import { itemDefaults } from './server/memoryServer';
import { ITEM_FIELDS, LIST_FIELDS, plainText, textDoc, type Item, type List, type RichDoc, type TableName } from './model';

export const DEFAULT_LISTS: Pick<List, 'name' | 'kind'>[] = [
  { name: '📌 매일', kind: 'daily' },
  { name: '✅ 할 일', kind: 'normal' },
  { name: '⏳ 대기', kind: 'normal' },
  { name: '💡 아이디어', kind: 'normal' },
];

export interface NewItemInput {
  listId: string;
  text?: string;
  content?: RichDoc;
  afterId?: string | null;
  parentId?: string | null;
  attrs?: Partial<Pick<Item, 'color' | 'pinned' | 'contexts' | 'size' | 'remind_at' | 'no_ai'>>;
}

export type ChangeListener = (urgent: boolean) => void;

export class NoteStore {
  private listeners = new Set<ChangeListener>();
  /** 시계 주입(테스트용) */
  now: () => Date = () => new Date();

  constructor(readonly db: LocalDB, readonly deviceId: string) {}

  onChange(fn: ChangeListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(urgent: boolean) {
    for (const fn of this.listeners) fn(urgent);
  }

  // ───────── 섹션 ─────────

  async ensureDefaultLists(): Promise<List[]> {
    const existing = await this.db.lists.filter((l) => !l.deleted_at).toArray();
    if (existing.length) return sortByKey(existing);
    let prev: string | null = null;
    const out: List[] = [];
    for (const d of DEFAULT_LISTS) {
      const key = generateKeyBetween(prev, null);
      prev = key;
      out.push(await this.addList(d.name, d.kind, key));
    }
    return out;
  }

  /**
   * 로그인 전 기기에서 만든 기본 섹션과 서버의 기본 섹션이 겹치면(이름이 같으면) 하나로 합친다.
   * 모든 기기가 같은 결과가 되도록 id 가 가장 작은 섹션을 남긴다.
   */
  async mergeDuplicateLists(): Promise<number> {
    const lists = (await this.db.lists.toArray()).filter((l) => !l.deleted_at);
    const byName = new Map<string, List[]>();
    for (const l of lists) byName.set(l.name, [...(byName.get(l.name) ?? []), l]);
    let merged = 0;
    for (const group of byName.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => (a.id < b.id ? -1 : 1));
      const keep = group[0]!;
      for (const dup of group.slice(1)) {
        const items = await this.db.items.where('list_id').equals(dup.id).toArray();
        for (const it of items) await this.updateItem(it.id, { list_id: keep.id }, false);
        await this.updateList(dup.id, { deleted_at: this.now().toISOString() });
        merged += 1;
      }
    }
    return merged;
  }

  async addList(name: string, kind: List['kind'] = 'normal', sortKey?: string): Promise<List> {
    const lists = sortByKey(await this.db.lists.toArray());
    const row: List = {
      id: crypto.randomUUID(),
      name,
      kind,
      sort_key: sortKey ?? generateKeyBetween(lists.at(-1)?.sort_key ?? null, null),
      version: 0,
      updated_at: this.now().toISOString(),
      deleted_at: null,
    };
    await this.db.transaction('rw', this.db.lists, this.db.outbox, async () => {
      await this.db.lists.put(row);
      await this.enqueue('lists', row.id, pickFields(row, LIST_FIELDS), {}, true);
    });
    this.emit(true);
    return row;
  }

  async updateList(id: string, patch: Partial<Pick<List, 'name' | 'kind' | 'sort_key' | 'deleted_at'>>) {
    await this.patchRow('lists', id, patch, true);
  }

  // ───────── 항목 ─────────

  async addItem(input: NewItemInput): Promise<Item> {
    const content = input.content ?? textDoc(input.text ?? '');
    const sort_key = await this.keyAfter(input.listId, input.afterId ?? null, input.parentId ?? null);
    const now = this.now().toISOString();
    const row: Item = {
      ...itemDefaults(),
      ...input.attrs,
      id: crypto.randomUUID(),
      list_id: input.listId,
      parent_id: input.parentId ?? null,
      content,
      plain: plainText(content),
      sort_key,
      version: 0,
      created_at: now,
      updated_at: now,
      updated_by: this.deviceId,
    };
    await this.db.transaction('rw', this.db.items, this.db.outbox, async () => {
      await this.db.items.put(row);
      await this.enqueue('items', row.id, pickFields(row, ITEM_FIELDS), {}, true);
    });
    this.emit(true);
    return row;
  }

  async setContent(id: string, content: RichDoc) {
    await this.patchRow('items', id, { content, plain: plainText(content) }, false);
  }

  async updateItem(id: string, patch: Partial<Omit<Item, 'id' | 'version' | 'created_at' | 'updated_at' | 'updated_by'>>, urgent = true) {
    if (patch.content && !('plain' in patch)) patch = { ...patch, plain: plainText(patch.content) };
    await this.patchRow('items', id, patch, urgent);
  }

  async toggleDone(id: string) {
    const it = await this.db.items.get(id);
    if (!it) return;
    await this.updateItem(id, { done_at: it.done_at ? null : this.now().toISOString() });
  }

  async trash(id: string) {
    const now = this.now().toISOString();
    const kids = await this.db.items.where('parent_id').equals(id).toArray();
    for (const k of kids) if (!k.deleted_at) await this.updateItem(k.id, { deleted_at: now });
    await this.updateItem(id, { deleted_at: now });
  }

  async restore(id: string) {
    await this.updateItem(id, { deleted_at: null, done_at: null });
  }

  /** 같은 섹션 안에서 beforeId 와 afterId 사이로 옮긴다(둘 중 하나는 null 가능). */
  async move(id: string, prevId: string | null, nextId: string | null, listId?: string) {
    const prev = prevId ? await this.db.items.get(prevId) : null;
    const next = nextId ? await this.db.items.get(nextId) : null;
    const sort_key = generateKeyBetween(prev?.sort_key ?? null, next?.sort_key ?? null);
    await this.updateItem(id, listId ? { sort_key, list_id: listId } : { sort_key });
  }

  /** 섹션의 보이는 항목(휴지통 제외) — 상위 항목 정렬 순서대로, 하위 메모는 바로 뒤에. */
  async listItems(listId: string): Promise<Item[]> {
    const all = await this.db.items.where('list_id').equals(listId).filter((i) => !i.deleted_at).toArray();
    return orderTree(all);
  }

  async trashItems(): Promise<Item[]> {
    const all = await this.db.items.filter((i) => !!i.deleted_at).toArray();
    return all.sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''));
  }

  /**
   * 새벽 자동 정리(서버가 없을 때 기기에서 대신 실행).
   * cutoff 이전에 완료한 항목: 일반 섹션 → 휴지통, 📌매일 섹션 → 체크 해제.
   * 휴지통 30일 지난 항목은 기기에서 지운다(서버는 크론이 따로 지움).
   */
  async runLocalCleanup(cutoff: Date) {
    const cut = cutoff.toISOString();
    const lists = new Map((await this.db.lists.toArray()).map((l) => [l.id, l]));
    const done = await this.db.items.filter((i) => !!i.done_at && !i.deleted_at && i.done_at < cut).toArray();
    for (const it of done) {
      if (lists.get(it.list_id)?.kind === 'daily') await this.updateItem(it.id, { done_at: null }, false);
      else await this.updateItem(it.id, { deleted_at: this.now().toISOString() }, false);
    }
    const purgeBefore = new Date(this.now().getTime() - 30 * 86400_000).toISOString();
    const old = await this.db.items.filter((i) => !!i.deleted_at && i.deleted_at < purgeBefore).primaryKeys();
    await this.db.items.bulkDelete(old);
    return { cleaned: done.length, purged: old.length };
  }

  // ───────── 내부 ─────────

  private async keyAfter(listId: string, afterId: string | null, parentId: string | null): Promise<string> {
    const siblings = sortByKey(
      await this.db.items.where('list_id').equals(listId)
        .filter((i) => !i.deleted_at && (i.parent_id ?? null) === parentId).toArray(),
    );
    if (!afterId) return generateKeyBetween(siblings.at(-1)?.sort_key ?? null, null);
    const idx = siblings.findIndex((s) => s.id === afterId);
    if (idx < 0) return generateKeyBetween(siblings.at(-1)?.sort_key ?? null, null);
    return generateKeyBetween(siblings[idx]!.sort_key, siblings[idx + 1]?.sort_key ?? null);
  }

  private async patchRow(table: TableName, id: string, patch: Record<string, unknown>, urgent: boolean) {
    const t = table === 'items' ? this.db.items : this.db.lists;
    await this.db.transaction('rw', t, this.db.outbox, async () => {
      const cur = (await t.get(id)) as Record<string, unknown> | undefined;
      if (!cur) return;
      const base: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) base[k] = cur[k];
      const next = { ...cur, ...patch, updated_at: this.now().toISOString() };
      if (table === 'items') (next as Record<string, unknown>).updated_by = this.deviceId;
      await t.put(next as never);
      await this.enqueue(table, id, patch, base, false);
    });
    this.emit(urgent);
  }

  /** 아직 안 보낸 같은 행의 변경과 합친다. base 는 가장 오래된 값을 유지. */
  private async enqueue(table: TableName, rowId: string, patch: Record<string, unknown>, base: Record<string, unknown>, insert: boolean) {
    const pending = await this.db.outbox.where('rowId').equals(rowId).filter((e) => !e.inflight).last();
    if (pending) {
      await this.db.outbox.update(pending.seq!, {
        patch: { ...pending.patch, ...patch },
        base: { ...base, ...pending.base },
        insert: pending.insert || insert,
      });
      return;
    }
    const entry: OutboxEntry = { table, rowId, patch, base, insert, inflight: 0, createdAt: Date.now() };
    await this.db.outbox.add(entry);
  }
}

export function sortByKey<T extends { sort_key: string; id: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : a.id < b.id ? -1 : 1));
}

/** 상위 항목을 정렬하고 각 상위 항목 바로 뒤에 하위 메모를 붙인다. 부모가 사라진 메모는 최상위로. */
export function orderTree(items: Item[]): Item[] {
  const ids = new Set(items.map((i) => i.id));
  const roots = sortByKey(items.filter((i) => !i.parent_id || !ids.has(i.parent_id)));
  const kids = new Map<string, Item[]>();
  for (const i of items) if (i.parent_id && ids.has(i.parent_id)) {
    const arr = kids.get(i.parent_id) ?? [];
    arr.push(i);
    kids.set(i.parent_id, arr);
  }
  const out: Item[] = [];
  for (const r of roots) {
    out.push(r);
    out.push(...sortByKey(kids.get(r.id) ?? []));
  }
  return out;
}

function pickFields(row: object, fields: readonly string[]) {
  const r: Record<string, unknown> = {};
  for (const f of fields) r[f] = (row as Record<string, unknown>)[f];
  return r;
}
