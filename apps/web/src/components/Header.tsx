import type { SyncStatus } from '@bk-note/core';
import { useEffect, useState } from 'react';
import { useServices } from '../app/services';

const DOT: Record<string, [string, string]> = {
  'local-only': ['⚪', '이 기기에만 저장 중(서버 미설정)'],
  live: ['🟢', '동기화됨'],
  syncing: ['🟡', '보내는 중'],
  offline: ['🔴', '오프라인 — 연결되면 자동으로 올라가'],
  error: ['🔴', '동기화 오류'],
};

export function Header({ status, onSettings }: { status: SyncStatus | null; onSettings(): void }) {
  const { platform } = useServices();
  const [onTop, setOnTop] = useState(false);
  useEffect(() => {
    void platform.isAlwaysOnTop?.().then(setOnTop);
  }, [platform]);
  const state = status?.state ?? 'local-only';
  const [dot, label] = DOT[state] ?? DOT.error!;
  const title = status?.lastRoundTripMs != null ? `${label} · 최근 왕복 ${status.lastRoundTripMs}ms` : label;
  return (
    <header className="header" data-tauri-drag-region>
      {platform.setAlwaysOnTop && (
        <button className={`icon${onTop ? ' on' : ''}`} title="항상 위 (켜기/끄기)" aria-pressed={onTop}
          onClick={async () => { await platform.setAlwaysOnTop!(!onTop); setOnTop(!onTop); }}>📌</button>
      )}
      <span className="title" data-tauri-drag-region>BK-NOTE</span>
      <span className="sync" title={title} aria-label={title} data-state={state}>
        {dot}{status && status.pending > 0 ? <small>{status.pending}</small> : null}
        {status?.lastRoundTripMs != null && <small className="rtt">{status.lastRoundTripMs}ms</small>}
      </span>
      {platform.dockRight && <button className="icon" title="오른쪽에 붙이기" onClick={() => void platform.dockRight!()}>⇥</button>}
      <button className="icon" title="설정" aria-label="설정" onClick={onSettings}>⚙︎</button>
      {platform.hide && <button className="icon" title="숨기기 (Ctrl+Alt+N)" onClick={() => void platform.hide!()}>─</button>}
    </header>
  );
}
