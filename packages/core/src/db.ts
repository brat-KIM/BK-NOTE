import Dexie, { type Table } from 'dexie';
import type { Item, List, TableName } from './model';

export interface OutboxEntry {
  seq?: number;
  table: TableName;
  rowId: string;
  patch: Record<string, unknown>;
  base: Record<string, unknown>;
  insert: boolean;
  inflight?: 0 | 1;
  createdAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** 기기 안 저장소(IndexedDB). 오프라인에서도 읽기·쓰기 전부 여기서 한다. */
export class LocalDB extends Dexie {
  items!: Table<Item, string>;
  lists!: Table<List, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'bk-note') {
    super(name);
    this.version(1).stores({
      items: 'id, list_id, parent_id, updated_at, remind_at, deleted_at',
      lists: 'id, sort_key',
      outbox: '++seq, rowId',
      meta: 'key',
    });
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown) {
    await this.meta.put({ key, value });
  }
}

export async function getDeviceId(db: LocalDB): Promise<string> {
  let id = await db.getMeta<string>('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    await db.setMeta('deviceId', id);
  }
  return id;
}
