import { expect, test, type Page } from '@playwright/test';

const quick = (p: Page) => p.getByLabel('빠른 입력');
const rows = (p: Page) => p.locator('ul.items > li.item');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: /할 일/ })).toBeVisible();
});

test('기본 섹션 4개 + 빠른 입력으로 적기', async ({ page }) => {
  await expect(page.getByRole('tab')).toHaveCount(4);
  await quick(page).fill('세무사한테 전화');
  await quick(page).press('Enter');
  await quick(page).fill('등기부 떼기');
  await quick(page).press('Enter');
  await expect(rows(page)).toHaveText([/세무사한테 전화/, /등기부 떼기/]);
  // 새로고침해도 남아 있다(기기 안 저장)
  await page.reload();
  await expect(rows(page)).toHaveText([/세무사한테 전화/, /등기부 떼기/]);
});

test('항목 편집: 엔터로 다음 항목, 굵게, 취소선', async ({ page, isMobile }) => {
  test.skip(isMobile, '키보드 단축키는 데스크톱에서');
  await quick(page).fill('첫 줄');
  await quick(page).press('Enter');
  await rows(page).first().locator('.body').click();
  const ed = page.locator('.item-editor');
  await expect(ed).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1).locator('.item-editor')).toBeFocused();
  await page.keyboard.type('둘째 줄');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Escape');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1).locator('strong')).toHaveText('둘째 줄');
  // OneNote 취소선 Ctrl+-
  await rows(page).first().locator('.body').click();
  await expect(rows(page).first().locator('.item-editor')).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Escape');
  await expect(rows(page).first().locator('s')).toHaveText('첫 줄');
});

test('체크하면 취소선, 지우면 휴지통 + 되돌리기', async ({ page }) => {
  await quick(page).fill('할 거');
  await quick(page).press('Enter');
  const row = rows(page).first();
  await row.getByRole('checkbox').click();
  await expect(row).toHaveClass(/done/);
  await row.getByLabel('항목 메뉴').click();
  await page.getByRole('button', { name: '🗑 지우기' }).click();
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(rows(page)).toHaveCount(1);
});

test('여러 줄 붙여넣기는 줄마다 항목', async ({ page }) => {
  await quick(page).focus();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '- 하나\n- 둘\n- 셋');
    document.querySelector('.quickadd input')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(rows(page)).toHaveText([/하나/, /둘/, /셋/]);
});

test('Tab 으로 메모(하위) 만들기', async ({ page, isMobile }) => {
  test.skip(isMobile, '키보드 단축키는 데스크톱에서');
  await quick(page).fill('부모');
  await quick(page).press('Enter');
  await quick(page).fill('자식');
  await quick(page).press('Enter');
  await rows(page).nth(1).locator('.body').click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(rows(page).nth(1)).toHaveClass(/child/);
});

test('빠른 입력의 날짜·태그 자동 인식', async ({ page }) => {
  await quick(page).fill('내일 3시 세무사 전화 @폰 !5');
  await quick(page).press('Enter');
  const row = rows(page).first();
  await expect(row.locator('.rt')).toHaveText('세무사 전화');
  await expect(row.locator('.badge.remind')).toHaveText(/내일 15:00/);
  await expect(row).toContainText('📱');
  await expect(row).toContainText('⚡');
  // 필터: ⚡5분 → 보임, ⏱️30분 → 안 보임
  await page.getByRole('button', { name: '⏱️30분' }).click();
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('button', { name: '⏱️30분' }).click();
  await page.getByRole('button', { name: '⚡5분' }).click();
  await expect(rows(page)).toHaveCount(1);
});

test('#아이디어 태그는 아이디어 섹션으로', async ({ page }) => {
  await quick(page).fill('#아이디어 블로그 글감');
  await quick(page).press('Enter');
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('tab', { name: /아이디어/ }).click();
  await expect(rows(page)).toHaveText([/블로그 글감/]);
});
