# BK-NOTE

생각났는데 지금 못 하는 일과 아이디어를 **적어 두고 → 짬 날 때 하고 → 지우는** 스티커 노트.
듀얼 모니터 오른쪽에 늘 붙어 있고, 갤럭시와 집·사무실 PC가 실시간으로 동기화된다. 서식은 OneNote 단축키 그대로.

## 지금 상태 (2026-10-15)

- P0~P4 구현 완료: 웹/PWA, 윈도우 스티커 앱(Tauri), 동기화 엔진 + Supabase 스키마, 알림, AI 도우미
- **서버(Supabase)는 아직 연결 안 함** → 기기 안에서만 동작. 연결 방법: [docs/SETUP.md](docs/SETUP.md)
- 실기기에서 확인할 것: [docs/CHECKLIST.md](docs/CHECKLIST.md)

## 받기

- 윈도우: GitHub → Actions → **desktop-windows** → 최신 실행 → Artifacts 「BK-NOTE-windows」
- 폰/웹: https://bk-note-omega.vercel.app (크롬 → 홈 화면에 추가). 이 브랜치에 푸시하면 자동 재배포

## 구조

```
packages/core   데이터 모델·로컬 DB·동기화 엔진·날짜 인식·AI 프롬프트(공통)
apps/web        화면(React + TipTap), PWA
apps/desktop    Tauri 2 윈도우 껍데기(항상 위·도킹·트레이·단축키·빠른 입력·백업)
supabase        DB 마이그레이션(RLS·save_row·pull_rows·새벽 정리·알림), Edge Functions(push, ai)
```

## 개발

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # 단위 테스트
pnpm test:db    # 로컬 Postgres 로 SQL 계약 테스트
pnpm e2e        # 화면 테스트(Playwright)
```

- 설계: [docs/DESIGN.md](docs/DESIGN.md)
