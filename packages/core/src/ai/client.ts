// 기기 쪽 AI 클라이언트: 서버(Edge Function) 호출 결과를 앱 데이터로 바꾼다.
import { fromKst, kstParts } from '../dates';
import type { Context, Size } from '../model';
import type { TaskInput, TaskName, TaskOutput } from './tasks';

export interface AiTransport {
  run<T extends TaskName>(task: T, input: TaskInput<T>): Promise<TaskOutput<T>>;
}

export class AiError extends Error {
  constructor(message: string, readonly code: 'disabled' | 'limit' | 'failed' = 'failed') {
    super(message);
  }
}

export function nowKstString(now = new Date()): string {
  const p = kstParts(now);
  const z = (n: number) => String(n).padStart(2, '0');
  const dow = ['일', '월', '화', '수', '목', '금', '토'][p.dow];
  return `${p.y}-${z(p.m)}-${z(p.d)} ${z(p.h)}:${z(p.min)} (${dow})`;
}

export function kstToIso(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return fromKst(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!).toISOString();
}

export interface AiParsed {
  text: string;
  remindAt: string | null;
  contexts: Context[];
  size: Size | null;
  list: string | null;
}

export function toParsed(o: TaskOutput<'parse'>): AiParsed {
  return { text: o.text.trim(), remindAt: kstToIso(o.remind_at_kst), contexts: [...o.contexts], size: o.size, list: o.list };
}

/** 규칙 해석기가 날짜를 못 찾았는데 날짜 같은 말이 있으면 AI 보정 후보 */
export function looksLikeVagueTime(text: string): boolean {
  return /(담주|다음\s?주|이번\s?주|주\s?초|주\s?말|월\s?초|월\s?말|중순|연휴|오전|오후|저녁|아침|밤|까지|쯤|이따|나중에|퇴근|출근|점심\s?후|회의\s?(후|끝나고))/u.test(text);
}

/** 붙여넣은 덩어리를 AI 로 나눌 만한지 */
export function looksLikeBlob(text: string): boolean {
  return text.length >= 40 && (text.match(/[.!?。\n]|요\s|다\s/g)?.length ?? 0) >= 2;
}
