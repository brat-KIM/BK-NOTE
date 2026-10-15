import { looksLikeBlob, looksLikeVagueTime, kstToIso, toParsed } from '../src/ai/client';
import { parseModelJson } from '../src/ai/tasks';

describe('AI 출력 처리', () => {
  it('코드블록·빠진 null 필드도 받아 준다', () => {
    const out = parseModelJson('parse', '```json\n{"text":"세무사 전화","contexts":["phone"]}\n```');
    expect(out).toEqual({ text: '세무사 전화', contexts: ['phone'], remind_at_kst: null, size: null, list: null });
    const st = parseModelJson('stale', '{"suggestions":[{"id":"a","action":"delete","reason":"끝난 듯"}]}');
    expect(st.suggestions[0]!.first_step).toBeNull();
  });
  it('스키마에 안 맞으면 오류', () => {
    expect(() => parseModelJson('parse', '{"text":1}')).toThrow();
    expect(() => parseModelJson('slot', '{"ids":["a","b","c","d"],"reason":"x"}')).toThrow();
  });
  it('KST 문자열 → ISO, 앱 데이터로 변환', () => {
    expect(kstToIso('2026-10-19 09:00')).toBe('2026-10-19T00:00:00.000Z');
    expect(kstToIso('다음주')).toBeNull();
    expect(toParsed({ text: ' x ', remind_at_kst: '2026-10-19 09:00', contexts: ['home'], size: '5m', list: null }))
      .toEqual({ text: 'x', remindAt: '2026-10-19T00:00:00.000Z', contexts: ['home'], size: '5m', list: null });
  });
  it('AI 보정 후보 판별', () => {
    expect(looksLikeVagueTime('담주 초쯤 정리')).toBe(true);
    expect(looksLikeVagueTime('퇴근 전에 우체국')).toBe(true);
    expect(looksLikeVagueTime('세무사 전화')).toBe(false);
    expect(looksLikeBlob('안녕하세요. 내일까지 계약서 보내주시고 금요일 미팅 시간 정해주세요. 견적서도 부탁드려요!')).toBe(true);
    expect(looksLikeBlob('짧은 메모')).toBe(false);
  });
});
