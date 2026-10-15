# BK-NOTE — 작업 메모

리마인더형 스티커 노트. 설계는 `docs/DESIGN.md`(v2)가 기준이다. 구현 전에 먼저 읽는다.

## 확정된 결정 (2026-10-15)
- 완료 처리: 체크하면 취소선 → 다음 날 새벽 4시(KST) 자동 정리 → 휴지통 30일 → 영구 삭제
- 사무실 PC: 프로그램 설치 가능
- 민감 정보 없음 → E2EE·마스킹 없음. 로그인 + RLS(owner = auth.uid())만
- 동기화: 행 단위(items/lists) + outbox + Supabase Realtime, 충돌 시 「⚠️ 충돌 사본」
- 백엔드: Supabase 서울 리전(ap-northeast-2) 무료 플랜, 새 프로젝트(기존 `BH-workspace`는 건드리지 않는다)

## 작업 환경 메모 (클라우드 세션)
- `*.supabase.co`는 네트워크 정책상 컨테이너에서 직접 접속이 안 된다. 원격 DB 작업은 Supabase MCP로 하고, 로컬 테스트는 설치된 Postgres 16으로 한다
- 윈도우 설치 파일은 GitHub Actions 윈도우 러너에서 빌드한다
- 사용자 대화는 반말·캐주얼, 문서는 개조식
