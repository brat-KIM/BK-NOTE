import { MemoryServer } from '../src/server/memoryServer';
import { textDoc } from '../src/model';
import { makeDevice, settle } from './helpers';

describe('동기화 (메모리 서버)', () => {
  it('한 기기에서 적은 항목이 다른 기기에 나타난다', async () => {
    const server = new MemoryServer();
    const office = await makeDevice(server, 'office');
    const phone = await makeDevice(server, 'phone');
    const [, todo] = await office.store.ensureDefaultLists();
    await office.store.addItem({ listId: todo!.id, text: '내일 오전 OO 서류 확인' });
    await settle(office, phone);
    const onPhone = await phone.db.items.toArray();
    expect(onPhone.map((i) => i.plain)).toEqual(['내일 오전 OO 서류 확인']);
    expect((await phone.db.lists.count())).toBe(4);
  });

  it('늦게 켜진 기기는 pull 로 따라잡는다', async () => {
    const server = new MemoryServer();
    const office = await makeDevice(server, 'office');
    const [, todo] = await office.store.ensureDefaultLists();
    await office.store.addItem({ listId: todo!.id, text: 'A' });
    await office.store.addItem({ listId: todo!.id, text: 'B' });
    await settle(office);
    const home = await makeDevice(server, 'home');
    await settle(home);
    expect((await home.store.listItems(todo!.id)).map((i) => i.plain)).toEqual(['A', 'B']);
  });

  it('오프라인에서 적고 → 재접속하면 올라간다(손실 0)', async () => {
    const server = new MemoryServer();
    const office = await makeDevice(server, 'office');
    const phone = await makeDevice(server, 'phone');
    const [, todo] = await office.store.ensureDefaultLists();
    await settle(office, phone);

    phone.net.setOnline(false);
    await phone.store.addItem({ listId: todo!.id, text: '비행기 모드 1' });
    await phone.store.addItem({ listId: todo!.id, text: '비행기 모드 2' });
    await settle(phone);
    expect(await phone.db.outbox.count()).toBe(2);
    expect(server.items.size).toBe(0);

    phone.net.setOnline(true);
    await settle(office, phone);
    expect(await phone.db.outbox.count()).toBe(0);
    expect((await office.store.listItems(todo!.id)).map((i) => i.plain)).toEqual(['비행기 모드 1', '비행기 모드 2']);
  });

  it('같은 항목 본문을 오프라인 두 기기에서 고치면 「충돌 사본」이 생기고 아무것도 잃지 않는다', async () => {
    const server = new MemoryServer();
    const office = await makeDevice(server, 'office');
    const home = await makeDevice(server, 'home');
    const [, todo] = await office.store.ensureDefaultLists();
    const it = await office.store.addItem({ listId: todo!.id, text: '원본' });
    await settle(office, home);

    home.net.setOnline(false);
    await office.store.setContent(it.id, textDoc('사무실 수정'));
    await settle(office);
    await home.store.setContent(it.id, textDoc('집 수정'));
    home.net.setOnline(true);
    await settle(office, home);

    for (const d of [office, home]) {
      const plains = (await d.store.listItems(todo!.id)).map((i) => i.plain);
      expect(plains).toEqual(['사무실 수정', '⚠️ 충돌 사본 · 집 수정']);
    }
  });

  it('단순 필드(완료·색)는 나중에 저장한 쪽이 이기고 사본을 만들지 않는다', async () => {
    const server = new MemoryServer();
    const office = await makeDevice(server, 'office');
    const home = await makeDevice(server, 'home');
    const [, todo] = await office.store.ensureDefaultLists();
    const it = await office.store.addItem({ listId: todo!.id, text: 'x' });
    await settle(office, home);
    home.net.setOnline(false);
    await office.store.updateItem(it.id, { color: 'red' });
    await settle(office);
    await home.store.updateItem(it.id, { color: 'blue' });
    home.net.setOnline(true);
    await settle(office, home);
    expect(server.items.size).toBe(1);
    expect((await office.db.items.get(it.id))!.color).toBe('blue');
    expect((await home.db.items.get(it.id))!.color).toBe('blue');
  });

  it('한쪽은 본문, 다른 쪽은 완료 체크 → 둘 다 반영(필드별 병합)', async () => {
    const server = new MemoryServer();
    const office = await makeDevice(server, 'office');
    const phone = await makeDevice(server, 'phone');
    const [, todo] = await office.store.ensureDefaultLists();
    const it = await office.store.addItem({ listId: todo!.id, text: 'x' });
    await settle(office, phone);
    phone.net.setOnline(false);
    await office.store.setContent(it.id, textDoc('본문 수정'));
    await settle(office);
    await phone.store.toggleDone(it.id);
    phone.net.setOnline(true);
    await settle(office, phone);
    const row = server.items.get(it.id)!;
    expect(row.plain).toBe('본문 수정');
    expect(row.done_at).not.toBeNull();
    expect(server.items.size).toBe(1);
    expect((await phone.db.items.get(it.id))!.plain).toBe('본문 수정');
  });

  it('삭제는 다른 기기에도 전파된다(휴지통)', async () => {
    const server = new MemoryServer();
    const a = await makeDevice(server, 'a');
    const b = await makeDevice(server, 'b');
    const [, todo] = await a.store.ensureDefaultLists();
    const it = await a.store.addItem({ listId: todo!.id, text: 'x' });
    await settle(a, b);
    await b.store.trash(it.id);
    await settle(a, b);
    expect(await a.store.listItems(todo!.id)).toHaveLength(0);
    expect((await a.store.trashItems()).map((i) => i.id)).toEqual([it.id]);
  });

  it('보내는 중에 생긴 변경도 잃지 않는다(타이핑 연타)', async () => {
    const server = new MemoryServer();
    const a = await makeDevice(server, 'a');
    const b = await makeDevice(server, 'b');
    const [, todo] = await a.store.ensureDefaultLists();
    const it = await a.store.addItem({ listId: todo!.id, text: '' });
    for (const t of ['가', '가나', '가나다', '가나다라']) {
      await a.store.setContent(it.id, textDoc(t));
      void a.sync.flush();
    }
    await settle(a, b);
    expect(server.items.get(it.id)!.plain).toBe('가나다라');
    expect((await b.db.items.get(it.id))!.plain).toBe('가나다라');
    expect(server.items.size).toBe(1);
  });

  it('서버 새벽 정리 결과가 기기들에 반영된다', async () => {
    const server = new MemoryServer();
    const a = await makeDevice(server, 'a');
    const [daily, todo] = await a.store.ensureDefaultLists();
    const d = await a.store.addItem({ listId: daily!.id, text: '루틴' });
    const t = await a.store.addItem({ listId: todo!.id, text: '일' });
    await a.store.toggleDone(d.id);
    await a.store.toggleDone(t.id);
    await settle(a);
    server.runDailyCleanup('2099-01-01T00:00:00Z');
    await settle(a);
    expect((await a.db.items.get(d.id))!.done_at).toBeNull();
    expect((await a.db.items.get(t.id))!.deleted_at).not.toBeNull();
  });
});
