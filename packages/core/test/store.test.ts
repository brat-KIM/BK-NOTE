import { LocalDB } from '../src/db';
import { NoteStore, orderTree } from '../src/store';
import { textDoc } from '../src/model';

async function fresh() {
  const db = new LocalDB(`store-${Math.random()}`);
  const store = new NoteStore(db, 'dev');
  const lists = await store.ensureDefaultLists();
  return { db, store, lists };
}

describe('NoteStore', () => {
  it('기본 섹션 4개를 순서대로 만든다', async () => {
    const { lists, store } = await fresh();
    expect(lists.map((l) => l.name)).toEqual(['📌 매일', '✅ 할 일', '⏳ 대기', '💡 아이디어']);
    expect(lists[0]!.kind).toBe('daily');
    // 두 번 불러도 다시 만들지 않는다
    expect((await store.ensureDefaultLists()).length).toBe(4);
  });

  it('적기 → 순서 유지 → 중간 삽입', async () => {
    const { store, lists } = await fresh();
    const todo = lists[1]!.id;
    const a = await store.addItem({ listId: todo, text: 'A' });
    await store.addItem({ listId: todo, text: 'C' });
    await store.addItem({ listId: todo, text: 'B', afterId: a.id });
    expect((await store.listItems(todo)).map((i) => i.plain)).toEqual(['A', 'B', 'C']);
  });

  it('메모(하위 항목)는 부모 바로 뒤에 온다', async () => {
    const { store, lists } = await fresh();
    const todo = lists[1]!.id;
    const a = await store.addItem({ listId: todo, text: 'A' });
    await store.addItem({ listId: todo, text: 'B' });
    await store.addItem({ listId: todo, text: 'a-메모', parentId: a.id });
    expect((await store.listItems(todo)).map((i) => i.plain)).toEqual(['A', 'a-메모', 'B']);
  });

  it('체크 → 취소선 상태(done_at) → 다시 누르면 해제', async () => {
    const { store, lists, db } = await fresh();
    const it = await store.addItem({ listId: lists[1]!.id, text: '등기부 떼기' });
    await store.toggleDone(it.id);
    expect((await db.items.get(it.id))!.done_at).not.toBeNull();
    await store.toggleDone(it.id);
    expect((await db.items.get(it.id))!.done_at).toBeNull();
  });

  it('지우기 → 휴지통 → 되돌리기, 메모도 같이 휴지통으로', async () => {
    const { store, lists } = await fresh();
    const todo = lists[1]!.id;
    const a = await store.addItem({ listId: todo, text: 'A' });
    await store.addItem({ listId: todo, text: 'memo', parentId: a.id });
    await store.trash(a.id);
    expect(await store.listItems(todo)).toHaveLength(0);
    expect((await store.trashItems()).length).toBe(2);
    await store.restore(a.id);
    expect((await store.listItems(todo)).map((i) => i.plain)).toEqual(['A']);
  });

  it('본문 서식(TipTap JSON) 저장 시 평문도 같이 갱신', async () => {
    const { store, lists, db } = await fresh();
    const it = await store.addItem({ listId: lists[1]!.id, text: 'x' });
    await store.setContent(it.id, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: '세무사', marks: [{ type: 'bold' }] },
        { type: 'text', text: '한테 전화' },
      ] }],
    });
    expect((await db.items.get(it.id))!.plain).toBe('세무사한테 전화');
  });

  it('새벽 정리: 일반 섹션 완료 항목은 휴지통, 📌매일은 체크 해제, 30일 지난 휴지통은 삭제', async () => {
    const { store, lists, db } = await fresh();
    let now = new Date('2026-10-15T10:00:00Z');
    store.now = () => now;
    const daily = await store.addItem({ listId: lists[0]!.id, text: '메일 확인' });
    const todo = await store.addItem({ listId: lists[1]!.id, text: '등기부' });
    const notDone = await store.addItem({ listId: lists[1]!.id, text: '아직' });
    await store.toggleDone(daily.id);
    await store.toggleDone(todo.id);

    now = new Date('2026-10-15T19:00:00Z'); // 16일 04:00 KST
    const r = await store.runLocalCleanup(now);
    expect(r.cleaned).toBe(2);
    expect((await db.items.get(daily.id))!.done_at).toBeNull();
    expect((await db.items.get(daily.id))!.deleted_at).toBeNull();
    expect((await db.items.get(todo.id))!.deleted_at).not.toBeNull();
    expect((await db.items.get(notDone.id))!.deleted_at).toBeNull();

    now = new Date('2026-11-20T00:00:00Z');
    const r2 = await store.runLocalCleanup(now);
    expect(r2.purged).toBe(1);
    expect(await db.items.get(todo.id)).toBeUndefined();
  });

  it('같은 행의 연속 변경은 outbox 에서 하나로 합쳐지고 base 는 처음 값 유지', async () => {
    const { store, lists, db } = await fresh();
    const it = await store.addItem({ listId: lists[1]!.id, text: 'v1' });
    await db.outbox.clear();
    await store.setContent(it.id, textDoc('v2'));
    await store.setContent(it.id, textDoc('v3'));
    const ob = await db.outbox.toArray();
    expect(ob).toHaveLength(1);
    expect(ob[0]!.patch.plain).toBe('v3');
    expect(ob[0]!.base.plain).toBe('v1');
  });

  it('orderTree: 부모가 없는 메모는 최상위로', () => {
    const mk = (id: string, sort_key: string, parent_id: string | null) =>
      ({ id, sort_key, parent_id }) as never;
    const r = orderTree([mk('b', 'a1', null), mk('m', 'a0', 'zz'), mk('a', 'a0', null)]);
    expect(r.map((i: { id: string }) => i.id)).toEqual(['a', 'm', 'b']);
  });
});
