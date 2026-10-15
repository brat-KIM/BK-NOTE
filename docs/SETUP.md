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

## 3. 폰 푸시 알림(선택)

앱이 꺼져 있어도 ⏰ 시각에 폰으로 알림을 받으려면:

1. 키 만들기: `npx web-push generate-vapid-keys` → Public / Private 키
2. Edge Function 배포 + 비밀값
   ```bash
   supabase functions deploy push --no-verify-jwt
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com PUSH_CRON_SECRET=<아무 긴 문자열>
   ```
3. SQL Editor 에서 Vault 에 두 값 넣기(크론이 함수 부를 때 씀)
   ```sql
   select vault.create_secret('https://<프로젝트>.supabase.co/functions/v1/push', 'bk_push_url');
   select vault.create_secret('<PUSH_CRON_SECRET 과 같은 값>', 'bk_push_secret');
   ```
   그다음 `…_cron.sql` 실행(pg_cron, pg_net 확장 켜기)
4. `apps/web/.env`(와 Vercel 환경변수)에 `VITE_VAPID_PUBLIC_KEY=<Public 키>`
5. 폰에서 앱 → ⚙︎ 설정 → 「폰 푸시 알림 켜기」

- PC 앱을 최근 5분 안에 만졌으면 폰 푸시는 생략한다(PC 에서 이미 알림이 뜨므로)
- 알림의 [완료] [1시간 뒤] 버튼이 바로 반영된다

## 4. AI 도우미(선택)

1. Anthropic 콘솔에서 API 키 발급(기존 크레딧에서 차감, Haiku 5.5 기준 월 $0.3 안팎)
2. (선택) Gemini API 키 — Claude 가 실패하면 대신 쓴다(무료 티어 가능, 단 무료 티어 입력은 구글 제품 개선에 쓰일 수 있음)
3. 배포 + 비밀값(키는 여기에만 둔다. 앱·저장소·채팅에 붙이지 않는다)
   ```bash
   supabase functions deploy ai
   supabase secrets set ANTHROPIC_API_KEY=... GEMINI_API_KEY=... AI_DAILY_LIMIT=200
   ```
4. 앱 ⚙︎ 설정 → 「AI 도우미 쓰기」 켜짐 확인

AI 가 하는 일: 애매한 날짜 보정(「담주 초쯤」), 덩어리 붙여넣기 나누기, ✨ 다듬기(항목 메뉴), 🎯 짬 추천, 묵은 일 💡 제안. 항목 메뉴의 🔒 AI 제외 항목은 보내지 않는다.

## 5. 폰(갤럭시)에 설치

- 크롬으로 배포 주소 열기 → 메뉴 → **홈 화면에 추가**
- 설치 후 카톡·문자에서 「공유 → BK-NOTE」로 바로 항목 추가 가능

## 6. 윈도우 앱

- GitHub Actions 「desktop-windows」 가 설치 파일(`.exe`/`.msi`)을 만든다. Actions 탭 → 최신 실행 → Artifacts 에서 받기
- 처음 실행할 때 SmartScreen 경고 → 「추가 정보 → 실행」(코드서명 안 함)
