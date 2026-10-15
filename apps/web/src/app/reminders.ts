import type { Services } from './services';

/**
 * 기기 안 알림 확인(1분마다). 서버 푸시와 별개로, 앱이 켜져 있는 기기(특히 데스크톱)가 직접 띄운다.
 * 같은 항목을 두 번 띄우지 않게 기기별로 기록한다.
 */
export function startReminders(services: Services, intervalMs = 60_000) {
  const { db, platform } = services;
  const check = async () => {
    const now = new Date().toISOString();
    const fired = new Set((await db.getMeta<string[]>('firedReminders')) ?? []);
    const due = await db.items
      .filter((i) => !!i.remind_at && !i.done_at && !i.deleted_at && (i.snoozed_until ?? i.remind_at)! <= now)
      .toArray();
    let changed = false;
    for (const it of due) {
      const key = `${it.id}@${it.snoozed_until ?? it.remind_at}`;
      if (fired.has(key)) continue;
      fired.add(key);
      changed = true;
      await platform.notify('⏰ BK-NOTE', it.plain || '(빈 항목)');
    }
    if (changed) await db.setMeta('firedReminders', [...fired].slice(-500));
  };
  void check();
  return setInterval(() => void check(), intervalMs);
}
