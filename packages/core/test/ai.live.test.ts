// 실제 Gemini 로 프롬프트·출력 검증(개발 환경의 Gemini 테스트 키 사용). BKNOTE_LIVE_AI=1 일 때만 돈다.
import { kstToIso, nowKstString, toParsed } from '../src/ai/client';
import { parseModelJson, systemPrompt, TASKS, type TaskName } from '../src/ai/tasks';
import { kstParts } from '../src/dates';

const live = process.env.BKNOTE_LIVE_AI === '1';
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest';
const NOW = new Date('2026-10-15T01:00:00Z'); // 10/15(목) 10:00 KST
const LISTS = [{ name: '📌 매일' }, { name: '✅ 할 일' }, { name: '⏳ 대기' }, { name: '💡 아이디어' }];

async function gemini<T extends TaskName>(task: T, input: Parameters<(typeof TASKS)[T]['user']>[0]) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(task, true) }] },
      contents: [{ role: 'user', parts: [{ text: (TASKS[task].user as (i: unknown) => string)(input) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  const text = body.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  return parseModelJson(task, text);
}

describe.skipIf(!live)('AI 프롬프트(실제 Gemini)', () => {
  it('parse: 애매한 날짜 표현', async () => {
    const out = toParsed(await gemini('parse', { text: '담주 초쯤 OO 건 정리 좀 해야 함', nowKst: nowKstString(NOW), lists: LISTS }));
    expect(out.text).toContain('OO');
    expect(out.remindAt).not.toBeNull();
    const p = kstParts(new Date(out.remindAt!));
    expect(p.m).toBe(10);
    expect([19, 20]).toContain(p.d); // 다음 주 월·화
  }, 30000);

  it('split: 카톡 덩어리 → 할 일 여러 개', async () => {
    const out = await gemini('split', {
      text: '안녕하세요 대표님~ 내일까지 계약서 수정본 보내주시고, 금요일 미팅 시간 정해주세요. 그리고 지난번 말씀하신 견적서도 부탁드려요. 감사합니다!',
      nowKst: nowKstString(NOW), lists: LISTS,
    });
    expect(out.items.length).toBeGreaterThanOrEqual(3);
    expect(out.items.some((i) => /계약서/.test(i.text) && kstToIso(i.remind_at_kst))).toBe(true);
  }, 30000);

  it('stale / refine / slot: 스키마에 맞는 답', async () => {
    const items = [
      { id: 'a', text: '블로그 리뉴얼', age_days: 20, size: 'big', contexts: [] },
      { id: 'b', text: '은행 서류 사진 찍어 보내기', age_days: 15, size: '5m', contexts: ['phone'] },
    ];
    const st = await gemini('stale', { items });
    expect(st.suggestions.map((s) => s.id).sort()).toEqual(['a', 'b']);
    const rf = await gemini('refine', { text: '사무실 서류 스캔 자동화' });
    expect(rf.text.split('\n').length).toBeGreaterThanOrEqual(2);
    const sl = await gemini('slot', { minutes: 10, place: 'phone', items });
    expect(sl.ids).toContain('b');
  }, 60000);
});
