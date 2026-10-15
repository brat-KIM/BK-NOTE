# BK-NOTE 설치·연결 가이드

지금 상태는 **서버 없이 기기 안에서만 동작(local-only)** 한다. Supabase 프로젝트를 만들어 아래 값을 넣으면 그때부터 기기끼리 동기화된다. 코드는 바꿀 필요 없다.

## 1. 개발 실행

```bash
pnpm install
pnpm dev                 # http://localhost:5173 (웹/PWA)
pnpm test                # 단위 테스트(Vitest)
pnpm test:db             # 로컬 Postgres 16 으로 supabase/migrations 계약 테스트
pnpm e2e                 # 화면 테스트(Playwright, 먼저 pnpm build)
```

## 2. Supabase 연결 (동기화 켜기)

1. supabase.com → New project
   - 이름 `bk-note`, 리전 **Northeast Asia (Seoul)**, 무료 플랜
2. SQL Editor 에서 `supabase/migrations/` 파일을 이름 순서대로 실행
   - `…_cron.sql` 전에 Database → Extensions 에서 **pg_cron** 을 켠다
   - (Supabase CLI 를 쓰면 `supabase link` 후 `supabase db push`)
3. Authentication 설정
   - Providers → Email: 켬. **Allow new users to sign up: 끔**(본인만 쓰기)
   - Users → Add user → 본인 이메일 추가(비밀번호 없어도 됨)
   - Email Templates → Magic Link 본문에 6자리 코드도 넣기: `코드: {{ .Token }}` (데스크톱 앱은 링크 대신 코드로 로그인)
   - URL Configuration → Site URL 에 배포 주소(예: `https://bk-note.vercel.app`), Redirect URLs 에 `http://localhost:5173` 도 추가
4. Project Settings → API 에서 URL 과 anon(public) 키를 복사해 `apps/web/.env` 에 넣는다(`.env.example` 참고). 배포(Vercel)에도 같은 환경변수를 넣는다.

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

5. 앱 새로고침 → 위쪽 로그인 칸에 이메일 → 메일의 링크 또는 6자리 코드로 로그인 → 제목줄 점이 🟢 이면 동기화 중

> anon 키는 공개돼도 되는 키다(RLS 로 본인 행만 접근). **service_role 키는 절대 앱이나 저장소에 넣지 않는다.**

## 3. 폰(갤럭시)에 설치

- 크롬으로 배포 주소 열기 → 메뉴 → **홈 화면에 추가**
- 설치 후 카톡·문자에서 「공유 → BK-NOTE」로 바로 항목 추가 가능

## 4. 윈도우 앱

- GitHub Actions 「desktop-windows」 가 설치 파일(`.exe`/`.msi`)을 만든다. Actions 탭 → 최신 실행 → Artifacts 에서 받기
- 처음 실행할 때 SmartScreen 경고 → 「추가 정보 → 실행」(코드서명 안 함)
