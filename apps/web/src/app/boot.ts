import { kstParts, sortByKey } from '@bk-note/core';
import { exportJson, exportMarkdown } from './backup';
import { captureText } from './capture';
import { createServices, lastCleanupCutoff, readConfig, type AppConfig, type Services } from './services';
import { startReminders } from './reminders';

/** 앱 시작: 서비스 생성 → 기본 섹션 → (서버 있으면) 로그인 확인·동기화 → 새벽 정리·알림 스케줄러 */
export async function boot(
  cfg: AppConfig = readConfig(),
  mode: 'main' | 'quick' = 'main',
): Promise<{ services: Services; needsLogin: boolean }> {
  if (mode === 'quick') {
    // 빠른 입력 창: 저장만 하고, 동기화·알림은 본 창이 맡는다(같은 기기 저장소 공유)
    const services = await createServices({ ...cfg, supabaseUrl: undefined, supabaseAnonKey: undefined });
    services.store.onChange(() => void notifyMainWindow());
    return { services, needsLogin: false };
  }
  const services = await createServices(cfg);
  const { store, sync, cloud } = services;

  let needsLogin = false;
  if (cloud && !cfg.adapter) {
    const session = await cloud.getSession();
    needsLogin = !session;
    cloud.onSession((s) => {
      if (s) void sync?.start().then(() => store.mergeDuplicateLists());
      else sync?.stop();
    });
    if (session) {
      await sync?.start();
    }
  } else if (sync) {
    await sync.start();
  }

  // 서버에서 받아오기 전에 섹션을 만들면 기기마다 섹션이 따로 생기므로, 첫 pull 이후에 만든다.
  await store.ensureDefaultLists();
  if (sync && !needsLogin) await store.mergeDuplicateLists();

  // 새벽 정리: 서버가 없으면 기기가 대신 한다(서버가 있으면 pg_cron 이 한다)
  if (!sync) {
    const runCleanup = () => void store.runLocalCleanup(lastCleanupCutoff());
    runCleanup();
    setInterval(runCleanup, 10 * 60_000);
  }

  // 포그라운드 복귀·네트워크 복구 때 따라잡기 + 다른 창(빠른 입력)에서 쓴 것 보내기
  if (sync) {
    void listenOtherWindows(() => sync.notify(true));
    setInterval(() => sync.notify(false), 30_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sync.catchUp();
    });
    window.addEventListener('online', () => void sync.catchUp());
  }

  // 폰 「공유 → BK-NOTE」(Web Share Target): /share?title=&text=&url=
  if (location.pathname === '/share') {
    const q = new URLSearchParams(location.search);
    const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n');
    if (text) {
      const lists = sortByKey((await services.db.lists.toArray()).filter((l) => !l.deleted_at));
      const target = lists.find((l) => l.name.includes('할 일')) ?? lists[0];
      if (target) await captureText(services, lists, target, text.split('\n').length > 1 ? text.replace(/\n/g, ' ') : text);
    }
    history.replaceState(null, '', '/');
  }

  startReminders(services);
  if (services.platform.kind === 'desktop') void desktopDaily(services);
  return { services, needsLogin };
}

/** 데스크톱 빠른 입력 창 → 본 창: "새로 적은 게 있어" 알림 */
async function notifyMainWindow() {
  if (!window.__TAURI_INTERNALS__) return;
  const { emit } = await import('@tauri-apps/api/event');
  await emit('bk:changed');
}

async function listenOtherWindows(fn: () => void) {
  if (!window.__TAURI_INTERNALS__) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen('bk:changed', fn);
}

/** 데스크톱: 첫 실행 때 자동 실행 켜기 + 매일 밤(21시 이후) 로컬 백업 */
async function desktopDaily(services: Services) {
  const { db, platform } = services;
  if (platform.autostart && !(await db.getMeta<boolean>('autostartInit'))) {
    try {
      await platform.autostart.set(true);
    } catch (e) {
      console.warn('autostart', e);
    }
    await db.setMeta('autostartInit', true);
  }
  const check = async () => {
    if (!platform.saveBackup) return;
    const now = new Date();
    const { y, m, d, h } = kstParts(now);
    const today = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const last = await db.getMeta<string>('lastBackup');
    if (last === today) return;
    // 21시 이후, 또는 마지막 백업이 이틀 이상 전이면
    const stale = !last || Date.parse(today) - Date.parse(last) >= 2 * 86400_000;
    if (h < 21 && !stale) return;
    try {
      await platform.saveBackup(`bk-note-${today}.json`, await exportJson(services));
      await platform.saveBackup(`bk-note-${today}.md`, await exportMarkdown(services));
      await db.setMeta('lastBackup', today);
    } catch (e) {
      console.warn('backup', e);
    }
  };
  void check();
  setInterval(() => void check(), 30 * 60_000);
}
