import { LocalDB, NoteStore, SyncEngine, getDeviceId, type ServerAdapter } from '@bk-note/core';
import { createContext, useContext } from 'react';
import { detectPlatform, type Platform } from './platform';
import { createCloud, type Cloud } from './cloud';

export interface Services {
  db: LocalDB;
  store: NoteStore;
  deviceId: string;
  platform: Platform;
  /** Supabase 설정이 있으면 클라우드 연결 객체, 없으면 null(local-only). */
  cloud: Cloud | null;
  sync: SyncEngine | null;
}

export interface AppConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** 테스트용: 서버 어댑터를 직접 주입 */
  adapter?: ServerAdapter;
  dbName?: string;
}

export function readConfig(): AppConfig {
  const env = import.meta.env;
  return {
    supabaseUrl: env.VITE_SUPABASE_URL || undefined,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || undefined,
  };
}

export async function createServices(cfg: AppConfig = readConfig()): Promise<Services> {
  const db = new LocalDB(cfg.dbName);
  const deviceId = await getDeviceId(db);
  const store = new NoteStore(db, deviceId);
  const platform = await detectPlatform();
  const cloud = cfg.supabaseUrl && cfg.supabaseAnonKey ? await createCloud(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const adapter = cfg.adapter ?? cloud?.adapter ?? null;
  const sync = adapter ? new SyncEngine(db, adapter, deviceId) : null;
  if (sync) store.onChange((urgent) => sync.notify(urgent));
  return { db, store, deviceId, platform, cloud, sync };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext missing');
  return s;
}

/** 다음 정리 시각(KST 04:00) 기준으로 "지난 04:00" 을 돌려준다. */
export function lastCleanupCutoff(now = new Date()): Date {
  const kstOffset = 9 * 3600_000;
  const kst = new Date(now.getTime() + kstOffset);
  const cut = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 4, 0, 0) - kstOffset;
  return new Date(cut <= now.getTime() ? cut : cut - 86400_000);
}
