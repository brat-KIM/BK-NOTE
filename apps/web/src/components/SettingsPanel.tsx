import { useEffect, useState } from 'react';
import { useServices } from '../app/services';
import { exportJson, exportMarkdown } from '../app/backup';
import { enablePush } from '../app/notifications';

export function SettingsPanel({ onClose }: { onClose(): void }) {
  const services = useServices();
  const { cloud, platform } = services;
  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  useEffect(() => {
    void platform.autostart?.isEnabled().then(setAutostart);
  }, [platform]);
  return (
    <section className="settings">
      <h2>설정</h2>
      <div className="row">
        <button onClick={async () => download(`bk-note-${stamp}.md`, await exportMarkdown(services), 'text/markdown')}>마크다운 내보내기</button>
        <button onClick={async () => download(`bk-note-${stamp}.json`, await exportJson(services), 'application/json')}>JSON 백업</button>
      </div>
      <div className="row">
        <button onClick={() => void platform.notify('BK-NOTE', '알림 테스트야 👋')}>알림 테스트</button>
        {platform.kind === 'web' && (
          <button onClick={async () => setPushMsg(await enablePush(services).catch((e) => `실패: ${(e as Error).message}`))}>
            폰 푸시 알림 켜기
          </button>
        )}
        {platform.autostart && autostart !== null && (
          <label className="chip">
            <input type="checkbox" checked={autostart}
              onChange={async (e) => { await platform.autostart!.set(e.target.checked); setAutostart(e.target.checked); }} />
            {' '}윈도우 시작 시 자동 실행
          </label>
        )}
      </div>
      {pushMsg && <p className="hint">{pushMsg}</p>}
      {platform.saveBackup && <p className="hint">매일 밤 9시 이후 문서 폴더 「BK-NOTE 백업」에 JSON·마크다운 백업이 저장돼(최근 14일).</p>}
      {cloud && (
        <div className="row">
          <button onClick={() => void cloud.signOut()}>모든 기기에서 로그아웃</button>
        </div>
      )}
      <p className="hint">
        단축키: 엔터 새 항목 · Tab 메모 · Ctrl+Enter(Ctrl+1) 완료 · Alt+↑↓ 이동 · Ctrl+B/I/U 서식 · Ctrl+- 취소선 · Ctrl+Alt+H 형광펜 · Ctrl+Shift+C 글자색 · Ctrl+Space 서식 지우기 · Ctrl+K 빠른 입력
      </p>
      <p className="hint">완료한 항목은 다음 날 새벽 4시에 휴지통으로 가고, 휴지통은 30일 뒤 비워져.</p>
      <button className="link" onClick={onClose}>닫기</button>
    </section>
  );
}
