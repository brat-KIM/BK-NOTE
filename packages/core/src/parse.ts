// 빠른 입력 해석(규칙 기반, AI 아님). 기기 안에서 즉시·무료·오프라인으로 동작한다.
// "내일 3시 세무사 전화 @폰 !5 #할일" → 본문 "세무사 전화", ⏰ 내일 15:00, 📱, ⚡5분
// 규칙으로 못 푸는 애매한 문장만 AI(P4)에 넘긴다.
import { fromKst, kstParts } from './dates';
import type { Context, Size } from './model';

export interface ParsedCapture {
  text: string;
  remindAt: string | null;
  contexts: Context[];
  size: Size | null;
  /** 섹션 힌트(#아이디어 → '아이디어') */
  listHint: string | null;
  /** 날짜 표현을 찾았는데 규칙으로 확정하기 애매했는지(AI 보정 후보) */
  fuzzy: boolean;
}

const CONTEXT_TAGS: [RegExp, Context][] = [
  [/@(?:사무실|회사|오피스|office)(?=\s)/iu, 'office'],
  [/@(?:집|홈|home)(?=\s)/iu, 'home'],
  [/@(?:폰|전화|모바일|핸드폰|phone)(?=\s)/iu, 'phone'],
];
const LIST_TAGS: [RegExp, string][] = [
  [/#(?:아이디어|idea)(?=\s)/iu, '아이디어'],
  [/#(?:대기|wait)(?=\s)/iu, '대기'],
  [/#(?:매일|루틴|daily)(?=\s)/iu, '매일'],
  [/#(?:할\s?일|todo)(?=\s)/iu, '할 일'],
];
const DOW: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const DEFAULT_HOUR = 9;
// 날짜·시간 뒤에 붙는 조사(같이 지운다)
const TAIL = '(?:까지|에|쯤|경|중|부터)?';

interface Day { y: number; m: number; d: number }

function addDays(day: Day, n: number): Day {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function dowOf(day: Day) {
  return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
}

export function parseCapture(input: string, now: Date): ParsedCapture {
  let text = ` ${input} `;
  const contexts: Context[] = [];
  let size: Size | null = null;
  let listHint: string | null = null;
  let fuzzy = false;

  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(text);
    if (!m) return false;
    fn(m);
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return true;
  };

  // ── 태그 ──
  for (const [re, c] of CONTEXT_TAGS) {
    if (re.test(text) && !contexts.includes(c)) contexts.push(c);
    text = text.replace(new RegExp(re.source, 'giu'), ' ');
  }
  for (const [re, name] of LIST_TAGS) {
    if (re.test(text)) listHint ??= name;
    text = text.replace(new RegExp(re.source, 'giu'), ' ');
  }
  take(/(?<=\s)!(5|5분|30|30분|큰|큰일|big)(?=\s)/u, (m) => {
    const v = m[1]!;
    size = v.startsWith('5') && !v.startsWith('5분') ? '5m' : v.startsWith('30') ? '30m' : v === '5분' ? '5m' : 'big';
  });

  // ── 날짜·시간 ──
  const today: Day = (() => { const p = kstParts(now); return { y: p.y, m: p.m, d: p.d }; })();
  let day: Day | null = null;
  let hour: number | null = null;
  let minute = 0;
  let meridiem: 'am' | 'pm' | null = null;
  let relativeMs: number | null = null;
  let dayIsWeekday = false;

  // N시간/분 뒤
  take(new RegExp(`(?<=\\s)(\\d{1,2})\\s*시간\\s*(?:뒤|후)${TAIL}(?=\\s)`, 'u'), (m) => { relativeMs = +m[1]! * 3600_000; });
  take(new RegExp(`(?<=\\s)(\\d{1,3})\\s*분\\s*(?:뒤|후)${TAIL}(?=\\s)`, 'u'), (m) => { relativeMs = (relativeMs ?? 0) + +m[1]! * 60_000; });

  if (relativeMs === null) {
    // N일/주 뒤
    take(new RegExp(`(?<=\\s)(\\d{1,2})\\s*(일|주)\\s*(?:뒤|후)${TAIL}(?=\\s)`, 'u'), (m) => {
      day = addDays(today, +m[1]! * (m[2] === '주' ? 7 : 1));
    });
    // 오늘/내일/모레/글피
    if (!day) take(new RegExp(`(?<=\\s)(오늘|내일\\s?모레|내일|낼|모레|글피)${TAIL}(?=\\s)`, 'u'), (m) => {
      const w = m[1]!.replace(/\s/g, '');
      day = addDays(today, w === '오늘' ? 0 : w === '내일' || w === '낼' ? 1 : w === '글피' ? 3 : 2);
    });
    // (다음 주|담주|이번 주) (월)(요일)?
    if (!day) take(new RegExp(`(?<=\\s)(다음\\s?주|담주|차주|이번\\s?주|이번주)\\s*([월화수목금토일])?(?:요일|욜)?${TAIL}(?=\\s)`, 'u'), (m) => {
      const next = !/이번/.test(m[1]!);
      const target = m[2] ? DOW[m[2]]! : 1;
      const dow = dowOf(today);
      const mondayThisWeek = addDays(today, -((dow + 6) % 7));
      day = addDays(mondayThisWeek, (next ? 7 : 0) + ((target + 6) % 7));
      if (!m[2]) fuzzy = true; // "다음 주"만: 월요일로 두되 애매
    });
    // 주말
    if (!day) take(new RegExp(`(?<=\\s)(이번\\s?)?주말${TAIL}(?=\\s)`, 'u'), () => {
      const dow = dowOf(today);
      day = addDays(today, dow === 6 ? 0 : dow === 0 ? 0 : 6 - dow);
    });
    // M/D, M월 D일
    if (!day) take(new RegExp(`(?<=\\s)(\\d{1,2})\\s*(?:/|월\\s*)(\\d{1,2})일?${TAIL}(?=\\s)`, 'u'), (m) => {
      const mm = +m[1]!; const dd = +m[2]!;
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return;
      let y = today.y;
      if (Date.UTC(y, mm - 1, dd) < Date.UTC(today.y, today.m - 1, today.d) - 7 * 86400_000) y += 1;
      day = { y, m: mm, d: dd };
    });
    // 요일만: 금요일, 금욜, (금)
    if (!day) take(new RegExp(`(?<=\\s)\\(?([월화수목금토일])(?:요일|욜|\\))${TAIL}(?=\\s)`, 'u'), (m) => {
      const target = DOW[m[1]!]!;
      day = addDays(today, (target - dowOf(today) + 7) % 7);
      dayIsWeekday = true;
    });

    // 시간: 오전/오후/아침/저녁/밤 + H시 (M분|반)? 또는 HH:MM, 점심
    take(new RegExp(`(?<=\\s)(?:(오전|아침|새벽|오후|낮|저녁|밤)\\s*)?(\\d{1,2})\\s*시\\s*(?:(\\d{1,2})\\s*분|(반))?${TAIL}(?=\\s)`, 'u'), (m) => {
      const word = m[1];
      if (word) meridiem = /오전|아침|새벽/.test(word) ? 'am' : 'pm';
      hour = +m[2]!;
      minute = m[3] ? +m[3] : m[4] ? 30 : 0;
    }) ||
      take(new RegExp(`(?<=\\s)(?:(오전|오후)\\s*)?([01]?\\d|2[0-3]):([0-5]\\d)${TAIL}(?=\\s)`, 'u'), (m) => {
        if (m[1]) meridiem = m[1] === '오전' ? 'am' : 'pm';
        hour = +m[2]!;
        minute = +m[3]!;
      }) ||
      take(new RegExp(`(?<=\\s)점심(?:시간)?${TAIL}(?=\\s)`, 'u'), () => { hour = 12; meridiem = 'pm'; });
  }

  let remindAt: string | null = null;
  if (relativeMs !== null) {
    remindAt = new Date(now.getTime() + relativeMs).toISOString();
  } else if (day || hour !== null) {
    let h = hour ?? DEFAULT_HOUR;
    if (hour !== null) {
      if (meridiem === 'pm' && h < 12) h += 12;
      else if (meridiem === 'am' && h === 12) h = 0;
      else if (meridiem === null && h >= 1 && h <= 6) h += 12; // "3시" → 오후 3시(업무 시간 기준)
    }
    let d: Day = day ?? today;
    let at = fromKst(d.y, d.m, d.d, h, minute);
    if (at.getTime() <= now.getTime()) {
      // 이미 지난 시각: 날짜 없이 시간만 → 내일 / 요일만 → 다음 주
      if (!day) { d = addDays(today, 1); at = fromKst(d.y, d.m, d.d, h, minute); }
      else if (dayIsWeekday) { d = addDays(d, 7); at = fromKst(d.y, d.m, d.d, h, minute); }
      else if (hour === null && d.y === today.y && d.m === today.m && d.d === today.d) {
        // "오늘"만 썼는데 09:00 이 지났으면 지금부터 1시간 뒤
        at = new Date(Math.ceil((now.getTime() + 3600_000) / 600_000) * 600_000);
      }
    }
    remindAt = at.toISOString();
  }

  const clean = text.replace(/\s+/g, ' ').trim();
  return { text: clean || input.trim(), remindAt, contexts, size, listHint, fuzzy };
}
