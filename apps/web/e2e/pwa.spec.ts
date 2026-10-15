import { expect, test } from '@playwright/test';

test('PWA 매니페스트: 설치 아이콘 + 공유 대상', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.share_target.action).toBe('/share');
  for (const src of ['/icon-192.png', '/icon-512.png']) expect((await request.get(src)).ok()).toBeTruthy();
});

test('공유하기(/share?text=)로 들어온 내용이 할 일에 들어간다', async ({ page }) => {
  await page.goto('/share?title=카톡&text=' + encodeURIComponent('내일까지 서류 보내주세요'));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('ul.items > li.item')).toHaveText([/카톡 내일까지 서류 보내주세요/]);
});
