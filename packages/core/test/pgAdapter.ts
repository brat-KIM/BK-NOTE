// 로컬 Postgres 위의 save_row / pull_rows 를 부르는 테스트용 어댑터(Supabase RPC 와 같은 호출).
import pg from 'pg';
import type { Item, List, TableName } from '../src/model';
import { NetworkError, type PullResult, type RealtimeStatus, type SaveRequest, type SaveResult, type ServerAdapter } from '../src/server/protocol';

export class PgAdapter implements ServerAdapter {
  online = true;
  private statusFns = new Set<(s: RealtimeStatus) => void>();

  constructor(private pool: pg.Pool, private userId: string) {}

  setOnline(v: boolean) {
    this.online = v;
    for (const fn of this.statusFns) fn(v ? 'live' : 'offline');
  }

  async as<T>(sql: string, params: unknown[]): Promise<T> {
    if (!this.online) throw new NetworkError('offline');
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [this.userId]);
      const r = await c.query(sql, params);
      await c.query('commit');
      return r.rows[0].r as T;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  save(req: SaveRequest): Promise<SaveResult> {
    return this.as('select public.save_row($1, $2, $3, $4, $5, $6) as r',
      [req.table, req.id, JSON.stringify(req.patch), JSON.stringify(req.base), req.insert, req.device]);
  }

  async pull(since: string | null): Promise<PullResult> {
    const r = await this.as<{ items: Item[]; lists: List[]; server_time: string }>('select public.pull_rows($1) as r', [since]);
    return { items: r.items, lists: r.lists, serverTime: r.server_time };
  }

  // 로컬 Postgres 에는 Realtime 이 없다 → 테스트는 pull 로 전파를 확인한다
  subscribe(_onRow: (t: TableName, r: Item | List) => void, onStatus?: (s: RealtimeStatus) => void) {
    if (onStatus) {
      this.statusFns.add(onStatus);
      onStatus(this.online ? 'live' : 'offline');
    }
    return () => void (onStatus && this.statusFns.delete(onStatus));
  }
}
