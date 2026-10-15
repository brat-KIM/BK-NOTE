// 테스트·로컬 개발용 메모리 서버. supabase/migrations 의 save_row / pull_rows 와 같은 규칙으로 동작한다.
// (같은 계약 테스트를 로컬 Postgres 위의 SQL 함수에도 돌려서 둘이 같음을 확인한다.)
import { CONFLICT_FIELDS, ITEM_FIELDS, LIST_FIELDS, sameValue, type Item, type List, type TableName } from '../model';
import { conflictCopyContent } from './conflict';
import type { PullResult, RealtimeStatus, SaveRequest, SaveResult, ServerAdapter } from './protocol';
import { NetworkError } from './protocol';

type AnyRow = Item | List;

export class MemoryServer {
  items = new Map<string, Item>();
  lists = new Map<string, List>();
  private listeners = new Set<(t: TableName, r: AnyRow) => void>();
  private clock = Date.parse('2026-01-01T00:00:00Z');
  private seq = 0;

  now(): string {
    // 테스트 결정성을 위해 호출마다 1ms씩 증가하는 서버 시계
    this.clock += 1;
    return new Date(this.clock).toISOString();
  }

  advance(ms: number) {
    this.clock += ms;
  }

  save(req: SaveRequest): SaveResult {
    const table = req.table === 'items' ? this.items : this.lists;
    const fields: readonly string[] = req.table === 'items' ? ITEM_FIELDS : LIST_FIELDS;
    const patch = pick(req.patch, fields);
    const cur = table.get(req.id) as AnyRow | undefined;
    const now = this.now();

    if (!cur) {
      if (!req.insert) return { row: null };
      const row = {
        ...(req.table === 'items' ? itemDefaults() : listDefaults()),
        ...patch,
        id: req.id,
        version: 1,
        created_at: now,
        updated_at: now,
        updated_by: req.device,
      } as AnyRow;
      if (req.table === 'lists') delete (row as Partial<Item>).created_at;
      if (req.table === 'lists') delete (row as Partial<Item>).updated_by;
      table.set(req.id, row as never);
      this.emit(req.table, row);
      return { row };
    }

    let conflict = false;
    if (req.table === 'items') {
      for (const f of CONFLICT_FIELDS) {
        if (f in patch && f in req.base) {
          const server = (cur as unknown as Record<string, unknown>)[f];
          if (!sameValue(server, req.base[f]) && !sameValue(server, patch[f])) conflict = true;
        }
      }
    }
    const apply = { ...patch };
    if (conflict) for (const f of CONFLICT_FIELDS) delete apply[f];

    const next = { ...cur, ...apply, version: cur.version + 1, updated_at: now } as AnyRow;
    if (req.table === 'items') (next as Item).updated_by = req.device;
    table.set(req.id, next as never);
    this.emit(req.table, next);

    let copy: Item | null = null;
    if (conflict) {
      const base = next as Item;
      const content = conflictCopyContent(patch.content as Item['content'] | undefined ?? base.content);
      copy = {
        ...itemDefaults(),
        id: this.uuid(),
        list_id: base.list_id,
        parent_id: base.parent_id,
        content,
        plain: '⚠️ 충돌 사본 · ' + String(patch.plain ?? base.plain),
        sort_key: base.sort_key + 'V',
        version: 1,
        created_at: now,
        updated_at: now,
        updated_by: req.device,
      };
      this.items.set(copy.id, copy);
      this.emit('items', copy);
    }
    return { row: next, copy };
  }

  pull(since: string | null): PullResult {
    const cut = since ? Date.parse(since) - 5000 : -Infinity;
    const after = <T extends { updated_at: string }>(rows: Iterable<T>) =>
      [...rows].filter((r) => Date.parse(r.updated_at) > cut);
    return { items: after(this.items.values()), lists: after(this.lists.values()), serverTime: this.now() };
  }

  /** 서버 크론과 같은 일: 완료 항목 새벽 정리 + 휴지통 30일 영구 삭제. */
  runDailyCleanup(cutoffIso: string) {
    for (const it of [...this.items.values()]) {
      if (it.done_at && !it.deleted_at && it.done_at < cutoffIso) {
        const list = this.lists.get(it.list_id);
        const patch = list?.kind === 'daily' ? { done_at: null } : { deleted_at: this.now() };
        this.save({ table: 'items', id: it.id, patch, base: {}, insert: false, device: 'server' });
      }
    }
  }

  subscribe(fn: (t: TableName, r: AnyRow) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(t: TableName, r: AnyRow) {
    const copy = structuredClone(r);
    for (const fn of this.listeners) queueMicrotask(() => fn(t, copy));
  }

  private uuid() {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
  }
}

export function itemDefaults(): Omit<Item, 'id' | 'list_id' | 'sort_key' | 'version' | 'created_at' | 'updated_at' | 'updated_by'> {
  return {
    parent_id: null,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    plain: '',
    color: null,
    pinned: false,
    contexts: [],
    size: null,
    remind_at: null,
    snoozed_until: null,
    done_at: null,
    deleted_at: null,
    no_ai: false,
  };
}

function listDefaults(): Partial<List> {
  return { kind: 'normal', deleted_at: null };
}

function pick(o: Record<string, unknown>, keys: readonly string[]) {
  const r: Record<string, unknown> = {};
  for (const k of keys) if (k in o) r[k] = o[k];
  return r;
}

/** MemoryServer 를 ServerAdapter 로 감싼다. online=false 면 네트워크 오류를 낸다(오프라인 시뮬레이션). */
export class MemoryAdapter implements ServerAdapter {
  online = true;
  private statusFns = new Set<(s: RealtimeStatus) => void>();
  constructor(private server: MemoryServer) {}

  setOnline(v: boolean) {
    this.online = v;
    for (const fn of this.statusFns) fn(v ? 'live' : 'offline');
  }

  async save(req: SaveRequest) {
    if (!this.online) throw new NetworkError('offline');
    return structuredClone(this.server.save(structuredClone(req)));
  }

  async pull(since: string | null) {
    if (!this.online) throw new NetworkError('offline');
    return structuredClone(this.server.pull(since));
  }

  subscribe(onRow: (t: TableName, r: AnyRow) => void, onStatus?: (s: RealtimeStatus) => void) {
    const off = this.server.subscribe((t, r) => {
      if (this.online) onRow(t, r);
    });
    if (onStatus) {
      this.statusFns.add(onStatus);
      onStatus(this.online ? 'live' : 'offline');
    }
    return () => {
      off();
      if (onStatus) this.statusFns.delete(onStatus);
    };
  }
}
