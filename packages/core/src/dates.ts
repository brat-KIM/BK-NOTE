// 날짜 표시(한국 시간 기준)

const KST = 9 * 3600_000;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** KST 기준 "벽시계" 날짜 부분 */
export function kstParts(d: Date) {
  const k = new Date(d.getTime() + KST);
  return {
    y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(),
    h: k.getUTCHours(), min: k.getUTCMinutes(), dow: k.getUTCDay(),
  };
}

/** KST 벽시계 값 → 실제 시각 */
export function fromKst(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min) - KST);
}

function dayNumber(d: Date) {
  return Math.floor((d.getTime() + KST) / 86400_000);
}

/** "오늘 15:00", "내일 9:00", "10/20(월) 14:30" */
export function formatRemind(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const p = kstParts(d);
  const diff = dayNumber(d) - dayNumber(now);
  const time = `${p.h}:${String(p.min).padStart(2, '0')}`;
  if (diff === 0) return `오늘 ${time}`;
  if (diff === 1) return `내일 ${time}`;
  if (diff === 2) return `모레 ${time}`;
  if (diff === -1) return `어제 ${time}`;
  return `${p.m}/${p.d}(${DOW[p.dow]}) ${time}`;
}

/** 만든 지 며칠 지났나(KST 날짜 기준) */
export function ageDays(createdIso: string, now = new Date()): number {
  return dayNumber(now) - dayNumber(new Date(createdIso));
}

export function isSameKstDay(a: Date, b: Date) {
  return dayNumber(a) === dayNumber(b);
}

/** <input type="datetime-local"> 값(KST) ↔ ISO */
export function toLocalInput(iso: string): string {
  const p = kstParts(new Date(iso));
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.min)}`;
}
export function fromLocalInput(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return fromKst(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!).toISOString();
}
