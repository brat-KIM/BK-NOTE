import { sortByKey } from '@bk-note/core';
import { useEffect, useRef, useState } from 'react';
import { captureText } from '../app/capture';
import { useServices } from '../app/services';

/**
 * 데스크톱 빠른 입력 창(Ctrl+Alt+Space). 어떤 프로그램을 쓰다가도 떠서 한 줄 적고 엔터 → 사라진다.
 * 같은 기기 저장소(IndexedDB)를 쓰므로 본 창 목록에 바로 나타난다.
 */
export function QuickCapture() {
  const services = useServices();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const hide = async () => {
    setText('');
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  };

  useEffect(() => {
    ref.current?.focus();
    const onFocus = () => ref.current?.focus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <form
      className="quick-window"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return void hide();
        const lists = sortByKey((await services.db.lists.toArray()).filter((l) => !l.deleted_at));
        const target = lists.find((l) => l.name.includes('할 일')) ?? lists[0];
        if (target) await captureText(services, lists, target, t);
        setSaved(t);
        setTimeout(() => setSaved(null), 1200);
        await hide();
      }}
    >
      <span className="q-icon" data-tauri-drag-region>＋</span>
      <input
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && void hide()}
        onBlur={() => void hide()}
        placeholder="적고 엔터 (예: 내일 3시 세무사 전화 @폰 !5)  ·  Esc 닫기"
        aria-label="빠른 입력"
      />
      {saved && <span className="q-saved">저장됨</span>}
    </form>
  );
}
