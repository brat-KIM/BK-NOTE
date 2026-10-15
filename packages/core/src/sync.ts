// 동기화 엔진: outbox 를 서버로 보내고(flush), 서버 변경을 받아(pull·실시간) 로컬 DB 에 합친다.
// 규칙은 docs/DESIGN.md 5.2~5.3 참고.
import type { LocalDB, OutboxEntry } from './db';
import type { Item, List, TableName } from './model';
import { NetworkError, type RealtimeStatus, type ServerAdapter } from './server/protocol';

export type SyncState = 'local-only' | 'offline' | 'syncing' | 'live' | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt: string | null;
  /** 최근 저장 왕복 시간(ms). 지연 측정 표시용. */
  lastRoundTripMs: number | null;
  lastError: string | null;
}

export interface SyncOptions {
  debounceMs?: number;
  /** 재시도 간격(ms) 목록. 끝까지 가면 마지막 값을 반복. */
  backoffMs?: number[];
}

export class SyncEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private retryIdx = 0;
  private unsub: (() => void) | null = null;
  private statusFns = new Set<(s: SyncStatus) => void>();
  private realtime: RealtimeStatus = 'connecting';
  private stopped = false;
  status: SyncStatus = { state: 'syncing', pending: 0, lastSyncAt: null, lastRoundTripMs: null, lastError: null };
  readonly debounceMs: number;
  readonly backoffMs: number[];

  constructor(private db: LocalDB, private adapter: ServerAdapter, private deviceId: string, opts: SyncOptions = {}) {
    this.debounceMs = opts.debounceMs ?? 300;
    this.backoffMs = opts.backoffMs ?? [1000, 2000, 5000, 10000, 30000];
  }

  onStatus(fn: (s: SyncStatus) => void) {
    this.statusFns.add(fn);
    fn(this.status);
    return () => this.statusFns.delete(fn);
  }

  async start() {
    this.stopped = false;
    // 이전 실행에서 보내다 만 항목은 다시 보낼 수 있게 되돌린다(서버 저장은 멱등).
    await this.db.outbox.toCollection().modify({ inflight: 0 });
    this.unsub = this.adapter.subscribe(
      (table, row) => void this.applyRemote(table, row),
      (s) => {
        const was = this.realtime;
        this.realtime = s;
        if (s === 'live' && was !== 'live') void this.catchUp();
        void this.refreshStatus();
      },
    );
    await this.catchUp();
  }

  stop() {
    this.stopped = true;
    this.unsub?.();
    this.unsub = null;
    if (this.timer) clearTimeout(this.timer);
  }

  /** 로컬 변경 알림. urgent 면 바로, 아니면 debounce 후 보낸다. */
  notify(urgent: boolean) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), urgent ? 0 : this.debounceMs);
    void this.refreshStatus();
  }

  /** 앱 시작·포그라운드 복귀·네트워크 복구 때: 밀린 것 보내고 받기. */
  async catchUp() {
    await this.flush();
    await this.pull();
  }

  async pull() {
    try {
      const since = (await this.db.getMeta<string>('lastSync')) ?? null;
      const res = await this.adapter.pull(since);
      for (const l of res.lists) await this.applyRemote('lists', l);
      for (const i of res.items) await this.applyRemote('items', i);
      await this.db.setMeta('lastSync', res.serverTime);
      this.status.lastSyncAt = res.serverTime;
      this.status.lastError = null;
    } catch (e) {
      this.noteError(e);
    }
    await this.refreshStatus();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => this.flush());
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush() {
    for (;;) {
      if (this.stopped) return;
      const entry = await this.db.outbox.orderBy('seq').first();
      if (!entry) break;
      await this.db.outbox.update(entry.seq!, { inflight: 1 });
      const t0 = performance.now();
      try {
        const res = await this.adapter.save({
          table: entry.table, id: entry.rowId, patch: entry.patch, base: entry.base,
          insert: entry.insert, device: this.deviceId,
        });
        this.status.lastRoundTripMs = Math.round(performance.now() - t0);
        await this.db.outbox.delete(entry.seq!);
        if (res.row) await this.applyRemote(entry.table, res.row);
        else await this.dropMissing(entry);
        if (res.copy) await this.applyRemote('items', res.copy);
        this.retryIdx = 0;
        this.status.lastError = null;
      } catch (e) {
        await this.db.outbox.update(entry.seq!, { inflight: 0 });
        this.noteError(e);
        this.scheduleRetry();
        break;
      }
    }
    await this.refreshStatus();
  }

  /**
   * 서버 행을 로컬에 합친다. 로컬이 같거나 더 새 버전이면 무시.
   * 아직 안 보낸 내 변경이 있으면 서버 행 위에 다시 얹는다(보낼 때 서버가 충돌을 판정).
   */
  async applyRemote(table: TableName, row: Item | List) {
    const t = table === 'items' ? this.db.items : this.db.lists;
    await this.db.transaction('rw', t, this.db.outbox, async () => {
      const local = (await t.get(row.id)) as (Item | List) | undefined;
      if (local && local.version >= row.version) return;
      const pending = await this.db.outbox.where('rowId').equals(row.id).sortBy('seq');
      let merged: Record<string, unknown> = { ...row };
      for (const p of pending) merged = { ...merged, ...p.patch };
      merged.version = row.version;
      await t.put(merged as never);
    });
  }

  /** 서버에 이미 없는 행(영구 삭제됨)을 고치려 했을 때: 로컬에서도 지운다. */
  private async dropMissing(entry: OutboxEntry) {
    const t = entry.table === 'items' ? this.db.items : this.db.lists;
    await t.delete(entry.rowId);
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const ms = this.backoffMs[Math.min(this.retryIdx, this.backoffMs.length - 1)]!;
    this.retryIdx += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.catchUp(), ms);
  }

  private noteError(e: unknown) {
    this.status.lastError = e instanceof Error ? e.message : String(e);
    if (!(e instanceof NetworkError)) console.warn('[sync]', e);
  }

  private async refreshStatus() {
    this.status.pending = await this.db.outbox.count();
    const offline = this.realtime === 'offline' || (this.status.lastError !== null);
    this.status.state = offline ? 'offline' : this.status.pending > 0 ? 'syncing' : 'live';
    for (const fn of this.statusFns) fn({ ...this.status });
  }
}
