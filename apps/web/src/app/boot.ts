import { sortByKey } from '@bk-note/core';
import { captureText } from './capture';
import { createServices, lastCleanupCutoff, readConfig, type AppConfig, type Services } from './services';
import { startReminders } from './reminders';

/** 앱 시작: 서비스 생성 → 기본 섹션 → (서버 있으면) 로그인 확인·동기화 → 새벽 정리·알림 스케줄러 */
export async function boot(cfg: AppConfig = readConfig()): Promise<{ services: Services; needsLogin: boolean }> {
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

  // 포그라운드 복귀·네트워크 복구 때 따라잡기
  if (sync) {
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
  return { services, needsLogin };
}
