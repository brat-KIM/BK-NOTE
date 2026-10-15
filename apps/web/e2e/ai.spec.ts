import { expect, test, type Page } from '@playwright/test';

const rows = (p: Page) => p.locator('ul.items > li.item');

// 서버 AI 대신 정해진 답을 돌려주는 흉내(e2e 빌드에서만 읽힘)
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__bkAiMock = async (task: string, input: any) => {
      await new Promise((r) => setTimeout(r, 50));
      if (task === 'parse') return { text: 'OO 건 정리', remind_at_kst: '2026-10-19 09:00', contexts: ['office'], size: '30m', list: null };
      if (task === 'split') return { items: [
        { text: '계약서 수정본 보내기', remind_at_kst: '2026-10-16 09:00', contexts: [], size: null, list: null },
        { text: '금요일 미팅 시간 정하기', remind_at_kst: null, contexts: ['phone'], size: '5m', list: null },
        { text: '견적서 보내기', remind_at_kst: null, contexts: [], size: null, list: null },
      ] };
      if (task === 'refine') return { text: '서류 스캔 자동화\n왜: 매일 30분 절약\n어떻게: 스캐너 폴더 감시', next_action: '스캐너 설정 확인' };
      if (task === 'slot') return { ids: [input.items[1].id], reason: '폰으로 5분이면 끝나' };
      if (task === 'stale') return { suggestions: [{ id: input.items[0].id, action: 'split', reason: '너무 커서 미뤄짐', first_step: '목차만 적기' }] };
      throw new Error('unknown');
    };
  });
  await page.goto('/');
});

test('규칙으로 못 푼 애매한 날짜는 AI 가 뒤에서 보정 + 되돌리기', async ({ page }) => {
  await page.getByLabel('빠른 입력').fill('담주 초쯤 OO 건 정리 좀');
  await page.getByLabel('빠른 입력').press('Enter');
  const row = rows(page).first();
  await expect(row.locator('.badge.remind')).toBeVisible();
  await expect(row.locator('.rt')).toHaveText('OO 건 정리');
  await expect(page.getByRole('status')).toContainText('AI');
  await expect(row.locator('.badge').filter({ hasText: '🏢' })).toBeVisible();
  // 되돌리면 규칙 해석 결과로 돌아간다("담주"만 규칙이 월요일로 잡고 나머지 말은 본문에 남음)
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(row.locator('.rt')).toHaveText('OO 건 정리 좀');
  await expect(row.locator('.badge').filter({ hasText: '🏢' })).toHaveCount(0);
});

test('덩어리 붙여넣기 → AI 나누기 미리보기 → 고른 것만 추가', async ({ page }) => {
  await page.getByLabel('빠른 입력').focus();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '안녕하세요 대표님~ 내일까지 계약서 수정본 보내주시고, 금요일 미팅 시간 정해주세요. 견적서도 부탁드려요!');
    document.querySelector('.quickadd input')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const panel = page.getByRole('region', { name: 'AI 나누기' });
  await expect(panel.locator('li')).toHaveCount(3);
  await panel.locator('li').nth(2).getByRole('checkbox').uncheck();
  await panel.getByRole('button', { name: '2개 추가' }).click();
  await expect(rows(page)).toHaveText([/계약서 수정본 보내기/, /금요일 미팅 시간 정하기/]);
});

test('항목 메뉴 ✨ AI 다듬기 → 적용하면 본문 교체 + 다음 행동 메모', async ({ page }) => {
  await page.getByLabel('빠른 입력').fill('서류 스캔 자동화');
  await page.getByLabel('빠른 입력').press('Enter');
  await rows(page).first().getByLabel('항목 메뉴').click();
  await page.getByRole('button', { name: '✨ AI 다듬기' }).click();
  await page.getByRole('button', { name: '적용' }).click();
  await expect(rows(page).first()).toContainText('왜: 매일 30분 절약');
  await expect(rows(page).nth(1)).toHaveClass(/child/);
  await expect(rows(page).nth(1)).toContainText('다음 행동: 스캐너 설정 확인');
});

test('🎯 짬 추천 → 위에 고정', async ({ page }) => {
  for (const t of ['블로그 리뉴얼 !큰', '은행 서류 사진 보내기 @폰 !5']) {
    await page.getByLabel('빠른 입력').fill(t);
    await page.getByLabel('빠른 입력').press('Enter');
  }
  await page.getByRole('button', { name: '🎯 짬 추천' }).click();
  const panel = page.getByRole('region', { name: '짬 추천' });
  await panel.getByRole('button', { name: '추천' }).click();
  await expect(panel.locator('ol li')).toHaveText(['은행 서류 사진 보내기']);
  await panel.getByRole('button', { name: '📌 위에 고정' }).click();
  await expect(rows(page).first()).toContainText('은행 서류 사진 보내기');
  await expect(rows(page).first()).toHaveClass(/pinned/);
});

test('묵은 일 카드의 💡 AI 제안 → 첫 단계를 항목으로', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-25T01:00:00Z') });
  await page.goto('/');
  await page.getByLabel('빠른 입력').fill('블로그 리뉴얼');
  await page.getByLabel('빠른 입력').press('Enter');
  await page.clock.setSystemTime(new Date('2026-10-15T01:00:00Z'));
  await page.reload();
  const card = page.getByRole('region', { name: '묵은 일 정리' });
  await card.getByRole('button', { name: '💡 AI 제안' }).click();
  await expect(card).toContainText('쪼개기');
  await card.getByRole('button', { name: '＋ 항목으로' }).click();
  await expect(page.getByRole('list', { name: '✅ 할 일' }).locator('li').filter({ hasText: '목차만 적기' })).toHaveCount(1);
});
