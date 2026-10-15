import { useServices } from '../app/services';
import { exportJson, exportMarkdown } from '../app/backup';

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
  return (
    <section className="settings">
      <h2>설정</h2>
      <div className="row">
        <button onClick={async () => download(`bk-note-${stamp}.md`, await exportMarkdown(services), 'text/markdown')}>마크다운 내보내기</button>
        <button onClick={async () => download(`bk-note-${stamp}.json`, await exportJson(services), 'application/json')}>JSON 백업</button>
      </div>
      <div className="row">
        <button onClick={() => void platform.notify('BK-NOTE', '알림 테스트야 👋')}>알림 테스트</button>
      </div>
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
