import { formatRemind, kstParts } from '../src/dates';
import { parseCapture } from '../src/parse';

// 기준: 2026-10-15(목) 10:00 KST
const NOW = new Date('2026-10-15T01:00:00Z');

function at(iso: string | null) {
  if (!iso) return null;
  const p = kstParts(new Date(iso));
  return `${p.m}/${p.d} ${p.h}:${String(p.min).padStart(2, '0')}`;
}

const cases: [string, string, string | null, Partial<ReturnType<typeof parseCapture>>?][] = [
  ['내일 3시 세무사 전화 @폰 !5', '세무사 전화', '10/16 15:00', { contexts: ['phone'], size: '5m' }],
  ['모레 오전 10시 회의', '회의', '10/17 10:00'],
  ['다음 주 월 OO 건 정리', 'OO 건 정리', '10/19 9:00'],
  ['담주 월요일 보고서', '보고서', '10/19 9:00'],
  ['담주 수욜 미팅', '미팅', '10/21 9:00'],
  ['담주 초쯤 OO 건 정리 좀', 'OO 건 정리 좀', '10/19 9:00', { fuzzy: true }],
  ['다음 주 말까지 견적', '견적', '10/23 9:00'],
  ['이번 주 금요일 마감', '마감', '10/16 9:00'],
  ['금요일 3시 통화', '통화', '10/16 15:00'],
  ['목요일 서류', '서류', '10/22 9:00'], // 오늘이 목요일인데 9시가 지남 → 다음 주
  ['10/20 14:30 서류 제출', '서류 제출', '10/20 14:30'],
  ['10월 20일 서류', '서류', '10/20 9:00'],
  ['3일 뒤 확인', '확인', '10/18 9:00'],
  ['2주 후 재검토', '재검토', '10/29 9:00'],
  ['2시간 뒤 전화', '전화', '10/15 12:00'],
  ['30분 후 회신', '회신', '10/15 10:30'],
  ['8시 반 운동', '운동', '10/16 8:30'], // 8시는 오전, 이미 지남 → 내일
  ['저녁 7시 약속', '약속', '10/15 19:00'],
  ['밤 10시 정리', '정리', '10/15 22:00'],
  ['내일까지 서류 보내주세요', '서류 보내주세요', '10/16 9:00'],
  ['3시에 전화', '전화', '10/15 15:00'],
  ['내일 점심 약속', '약속', '10/16 12:00'],
  ['주말 대청소 @집 !큰', '대청소', '10/17 9:00', { contexts: ['home'], size: 'big' }],
  ['12월 3일 기념일', '기념일', '12/3 9:00'],
  ['1/5 신년 계획', '신년 계획', '1/5 9:00'], // 지난 날짜면 내년
  ['내일 오후 2시 30분 상담', '상담', '10/16 14:30'],
  ['세무사 전화', '세무사 전화', null],
  ['1:1 미팅 준비', '1:1 미팅 준비', null],
  ['#아이디어 블로그 글감', '블로그 글감', null, { listHint: '아이디어' }],
  ['@사무실 프린터 토너 !30', '프린터 토너', null, { contexts: ['office'], size: '30m' }],
  ['13시간 걸린 작업 회고', '13시간 걸린 작업 회고', null],
];

describe('빠른 입력 해석(규칙)', () => {
  for (const [input, text, when, extra] of cases) {
    it(`${input} → ${text} / ${when ?? '시각 없음'}`, () => {
      const r = parseCapture(input, NOW);
      expect(r.text).toBe(text);
      expect(at(r.remindAt)).toBe(when);
      if (extra) expect(r).toMatchObject(extra);
    });
  }

  it('오늘만 쓰고 9시가 지났으면 1시간 뒤(10분 단위 올림)', () => {
    const r = parseCapture('오늘 은행', NOW);
    expect(at(r.remindAt)).toBe('10/15 11:00');
  });

  it('formatRemind: 오늘/내일/날짜', () => {
    expect(formatRemind('2026-10-15T06:00:00Z', NOW)).toBe('오늘 15:00');
    expect(formatRemind('2026-10-16T00:00:00Z', NOW)).toBe('내일 9:00');
    expect(formatRemind('2026-10-20T05:30:00Z', NOW)).toBe('10/20(화) 14:30');
  });
});
