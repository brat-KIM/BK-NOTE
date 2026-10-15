-- pg_cron 스케줄(Supabase 대시보드 → Database → Extensions 에서 pg_cron 이 켜져 있어야 한다)
-- 로컬 테스트(scripts/test-db.sh)는 pg_cron 이 없어서 이 파일을 건너뛴다.
create extension if not exists pg_cron;

-- 매일 04:00 KST(= 19:00 UTC): 완료 항목 정리 + 휴지통 30일 비우기
select cron.schedule('bk-note-cleanup', '0 19 * * *', $$select public.cleanup_daily()$$);

-- 3일마다 가벼운 활동(무료 플랜 7일 무활동 일시정지 방지용 보조. 알림 크론이 돌면 사실상 필요 없음)
select cron.schedule('bk-note-keepalive', '17 3 */3 * *', $$select 1$$);

-- 매분: 도래한 알림 → Edge Function "push" 가 웹 푸시 발송.
-- 먼저 Vault 에 두 비밀값을 넣는다(docs/SETUP.md):
--   bk_push_url    = https://<프로젝트>.supabase.co/functions/v1/push
--   bk_push_secret = Edge Function 의 PUSH_CRON_SECRET 과 같은 임의 문자열
create extension if not exists pg_net;
select cron.schedule('bk-note-push', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'bk_push_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bk_push_secret')),
    body := '{}'::jsonb)
$$);
