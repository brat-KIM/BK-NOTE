// 빠른 입력 해석(규칙 기반, AI 아님). P3 에서 날짜 표현을 채운다.
import type { Context, Size } from './model';

export interface ParsedCapture {
  text: string;
  remindAt: string | null;
  contexts: Context[];
  size: Size | null;
  /** '아이디어' 같은 섹션 힌트(#아이디어) */
  listHint: string | null;
}

export function parseCapture(input: string, _now: Date): ParsedCapture {
  return { text: input.trim(), remindAt: null, contexts: [], size: null, listHint: null };
}
