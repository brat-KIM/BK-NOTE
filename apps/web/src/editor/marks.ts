// 형광펜·글자색 팔레트(형광펜은 OneNote 처럼 누를 때마다 다음 색 → 끄기)
export const HIGHLIGHTS = ['#fff3a3', '#c9f2c7', '#ffd1e8', '#cfe8ff'] as const;
export const TEXT_COLORS = ['#d93025', '#1a73e8', '#188038', '#8e24aa'] as const;
export const LABEL_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'] as const;

export function nextInCycle<T extends string>(list: readonly T[], current: string | null | undefined): T | null {
  if (!current) return list[0]!;
  const i = list.findIndex((c) => c.toLowerCase() === current.toLowerCase());
  if (i < 0) return list[0]!;
  return i + 1 < list.length ? list[i + 1]! : null;
}
