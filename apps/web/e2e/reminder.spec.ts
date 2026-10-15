import { expect, test } from '@playwright/test';

const rows = (p: import('@playwright/test').Page) => p.locator('ul.items > li.item');

test('2주 넘은 항목은 「묵은 일 정리」 카드에 뜨고, 일주일 닫기 가능', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-30T01:00:00Z') });
  await page.goto('/');
  await page.getByLabel('빠른 입력').fill('오래된 일');
  await page.getByLabel('빠른 입력').press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await page.clock.setSystemTime(new Date('2026-10-15T01:00:00Z'));
  await page.reload();
  const card = page.getByRole('region', { name: '묵은 일 정리' });
  await expect(card).toContainText('오래된 일');
  await expect(card).toContainText('15일');
  await card.getByRole('button', { name: '⏰ 내일' }).click();
  await expect(rows(page).last().locator('.badge.remind')).toHaveText(/내일 9:00/);
  await card.getByRole('button', { name: '일주일 동안 닫기' }).click();
  await expect(card).toHaveCount(0);
});

test('알림 버튼 [완료] 주소로 들어오면 완료 처리', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('빠른 입력').fill('알림 받을 일');
  await page.getByLabel('빠른 입력').press('Enter');
  const id = await rows(page).first().getAttribute('data-id');
  await page.goto(`/?notify=done&item=${id}`);
  await expect(rows(page).first()).toHaveClass(/done/);
});
