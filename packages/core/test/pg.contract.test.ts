// scripts/test-db.sh 로 실행: 로컬 Postgres 에 supabase/migrations 를 적용한 뒤 SQL 함수가
// 메모리 서버와 같은 규칙으로 동작하는지 확인한다. BKNOTE_PG_URL 이 없으면 건너뛴다.
import pg from 'pg';
import { MemoryAdapter, MemoryServer } from '../src/server/memoryServer';
import { PgAdapter } from './pgAdapter';
import { scenarios } from './scenarios';

const url = process.env.BKNOTE_PG_URL;

describe('시나리오: 메모리 서버', () => {
  for (const [name, run] of Object.entries(scenarios)) {
    it(name, async () => {
      const server = new MemoryServer();
      await run(() => new MemoryAdapter(server));
    });
  }
});

describe.skipIf(!url)('시나리오: Postgres (supabase/migrations)', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function newUser() {
    const id = crypto.randomUUID();
    await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@test`]);
    return id;
  }

  for (const [name, run] of Object.entries(scenarios)) {
    it(name, async () => {
      const uid = await newUser();
      await run(() => new PgAdapter(pool, uid));
    });
  }

  it('RLS: 다른 사용자의 행은 보이지도, 고쳐지지도 않는다', async () => {
    const alice = new PgAdapter(pool, await newUser());
    const bob = new PgAdapter(pool, await newUser());
    const listId = crypto.randomUUID();
    await alice.save({ table: 'lists', id: listId, patch: { name: 'A', kind: 'normal', sort_key: 'a0' }, base: {}, insert: true, device: 'x' });
    const itemId = crypto.randomUUID();
    await alice.save({ table: 'items', id: itemId, patch: { list_id: listId, plain: '비밀', sort_key: 'a0' }, base: {}, insert: true, device: 'x' });
    const pulled = await bob.pull(null);
    expect(pulled.items).toHaveLength(0);
    expect(pulled.lists).toHaveLength(0);
    // bob 이 alice 행 id 로 수정 시도 → 안 보이므로 "없는 행" 처리
    const r = await bob.save({ table: 'items', id: itemId, patch: { plain: '해킹' }, base: {}, insert: false, device: 'y' });
    expect(r.row).toBeNull();
    const again = await alice.pull(null);
    expect(again.items[0]!.plain).toBe('비밀');
  });

  it('로그인 안 하면 저장 거부', async () => {
    const anon = new PgAdapter(pool, '');
    await expect(anon.save({ table: 'lists', id: crypto.randomUUID(), patch: { name: 'x', sort_key: 'a0' }, base: {}, insert: true, device: 'x' }))
      .rejects.toThrow();
  });

  it('새벽 정리(cleanup_daily): 일반 → 휴지통, 📌매일 → 체크 해제, 30일 휴지통 → 삭제', async () => {
    const uid = await newUser();
    const a = new PgAdapter(pool, uid);
    const normal = crypto.randomUUID();
    const daily = crypto.randomUUID();
    await a.save({ table: 'lists', id: normal, patch: { name: '할 일', kind: 'normal', sort_key: 'a0' }, base: {}, insert: true, device: 'x' });
    await a.save({ table: 'lists', id: daily, patch: { name: '매일', kind: 'daily', sort_key: 'a1' }, base: {}, insert: true, device: 'x' });
    const mk = async (list: string, patch: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      await a.save({ table: 'items', id, patch: { list_id: list, plain: id, sort_key: 'a0', ...patch }, base: {}, insert: true, device: 'x' });
      return id;
    };
    // 10/15 15:00 KST 에 완료
    const doneAt = '2026-10-15T06:00:00Z';
    const t1 = await mk(normal, { done_at: doneAt });
    const d1 = await mk(daily, { done_at: doneAt });
    const open = await mk(normal, {});
    const old = await mk(normal, { deleted_at: '2026-09-01T00:00:00Z' });
    // 10/16 03:59 KST: 아직 정리 전
    let r = (await pool.query(`select public.cleanup_daily('2026-10-15T18:59:00Z') as r`)).rows[0].r;
    expect(r.trashed).toBe(0);
    // 10/16 04:00 KST
    r = (await pool.query(`select public.cleanup_daily('2026-10-15T19:00:00Z') as r`)).rows[0].r;
    // 크론은 모든 사용자 대상이라 다른 테스트 사용자의 완료 항목도 함께 정리된다
    expect(r.trashed).toBeGreaterThanOrEqual(1);
    expect(r.unchecked).toBeGreaterThanOrEqual(1);
    // 30일 지난 휴지통 행은 첫 호출에서 이미 지워졌다(아래 by(old) 확인)
    const rows = (await a.pull(null)).items;
    const by = (id: string) => rows.find((x) => x.id === id);
    expect(by(t1)!.deleted_at).not.toBeNull();
    expect(by(d1)!.done_at).toBeNull();
    expect(by(d1)!.deleted_at).toBeNull();
    expect(by(open)!.deleted_at).toBeNull();
    expect(by(old)).toBeUndefined();
    expect(by(t1)!.version).toBe(2);
  });

  it('알림: 도래한 알림은 한 번만, 다시 알림 시각엔 또 한 번, 기기 동기화 버전은 안 올림', async () => {
    const uid = await newUser();
    const a = new PgAdapter(pool, uid);
    const list = crypto.randomUUID();
    await a.save({ table: 'lists', id: list, patch: { name: '할 일', sort_key: 'a0' }, base: {}, insert: true, device: 'x' });
    const id = crypto.randomUUID();
    await a.save({ table: 'items', id, patch: { list_id: list, plain: '세무사 전화', sort_key: 'a0', remind_at: '2026-10-16T06:00:00Z' }, base: {}, insert: true, device: 'x' });
    const due = async (now: string) =>
      (await pool.query('select * from public.due_reminders($1)', [now])).rows.filter((r) => r.owner === uid);
    expect(await due('2026-10-16T05:59:00Z')).toHaveLength(0);
    const r1 = await due('2026-10-16T06:00:30Z');
    expect(r1.map((r) => r.plain)).toEqual(['세무사 전화']);
    expect(await due('2026-10-16T06:01:30Z')).toHaveLength(0);
    // 버전은 그대로(1) — notified_for 는 서버 전용
    expect((await a.pull(null)).items[0]!.version).toBe(1);
    // 1시간 뒤 다시 알림
    await a.save({ table: 'items', id, patch: { snoozed_until: '2026-10-16T07:00:00Z' }, base: {}, insert: false, device: 'phone' });
    expect(await due('2026-10-16T06:30:00Z')).toHaveLength(0);
    expect((await due('2026-10-16T07:00:10Z')).map((r) => r.plain)).toEqual(['세무사 전화']);
    // 완료하면 안 나감
    await a.save({ table: 'items', id, patch: { snoozed_until: '2026-10-16T08:00:00Z', done_at: '2026-10-16T07:10:00Z' }, base: {}, insert: false, device: 'phone' });
    expect(await due('2026-10-16T08:00:10Z')).toHaveLength(0);
  });

  it('알림 대상: 데스크톱을 최근 5분 안에 썼으면 폰 푸시 생략', async () => {
    const uid = await newUser();
    await pool.query(`insert into public.devices (owner, device_id, name, kind, push, last_active) values
      ($1, 'phone', '갤럭시', 'web', '{"endpoint":"https://push.example/1"}', now() - interval '1 hour'),
      ($1, 'pc', '사무실 PC', 'desktop', null, '2026-10-16T06:58:00Z')`, [uid]);
    const targets = async (now: string) => (await pool.query('select * from public.push_targets($1, $2)', [uid, now])).rows;
    expect(await targets('2026-10-16T07:00:00Z')).toHaveLength(0);
    expect((await targets('2026-10-16T07:10:00Z')).map((r) => r.device_id)).toEqual(['phone']);
  });
});
