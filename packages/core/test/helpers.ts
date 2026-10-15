import { LocalDB } from '../src/db';
import { NoteStore } from '../src/store';
import { SyncEngine } from '../src/sync';
import { MemoryAdapter, MemoryServer } from '../src/server/memoryServer';

let n = 0;

export interface Device {
  name: string;
  db: LocalDB;
  store: NoteStore;
  sync: SyncEngine;
  net: MemoryAdapter;
}

export async function makeDevice(server: MemoryServer, name: string, start = true): Promise<Device> {
  n += 1;
  const db = new LocalDB(`test-${name}-${n}-${Math.random()}`);
  const store = new NoteStore(db, name);
  const net = new MemoryAdapter(server);
  const sync = new SyncEngine(db, net, name, { debounceMs: 0, backoffMs: [5] });
  store.onChange((u) => sync.notify(u));
  if (start) await sync.start();
  return { name, db, store, sync, net };
}

/** 보낼 것 다 보내고 실시간 이벤트가 다 도착할 때까지 기다린다. */
export async function settle(...devices: Device[]) {
  for (let round = 0; round < 5; round++) {
    for (const d of devices) await d.sync.flush();
    await new Promise((r) => setTimeout(r, 5));
  }
}
