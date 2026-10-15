// 매분 pg_cron → 이 함수: 도래한 알림을 웹 푸시로 보낸다.
// 필요한 비밀값(supabase secrets set):
//   PUSH_CRON_SECRET  pg_cron 이 보내는 Bearer 값(Vault 의 bk_push_secret 과 같게)
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  (npx web-push generate-vapid-keys)
//   VAPID_SUBJECT     예: mailto:you@example.com
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 준다.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

interface Due { owner: string; item_id: string; plain: string; due_at: string }
interface Target { device_id: string; push: webpush.PushSubscription }

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_CRON_SECRET');
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:bk-note@localhost',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: due, error } = await admin.rpc('due_reminders');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  const byOwner = new Map<string, Due[]>();
  for (const d of (due ?? []) as Due[]) byOwner.set(d.owner, [...(byOwner.get(d.owner) ?? []), d]);

  for (const [owner, items] of byOwner) {
    const { data: targets } = await admin.rpc('push_targets', { p_owner: owner });
    for (const t of (targets ?? []) as Target[]) {
      for (const it of items) {
        try {
          await webpush.sendNotification(t.push, JSON.stringify({ title: '⏰ BK-NOTE', body: it.plain || '(빈 항목)', itemId: it.item_id }), { TTL: 3600 });
          sent += 1;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          // 구독이 만료됐으면 지운다
          if (code === 404 || code === 410) {
            await admin.from('devices').update({ push: null }).eq('owner', owner).eq('device_id', t.device_id);
          } else {
            console.error('push failed', code, (e as Error).message);
          }
        }
      }
    }
  }
  return Response.json({ due: due?.length ?? 0, sent });
});
