import { describe, expect, it } from 'vitest';
import { lastCleanupCutoff } from './services';

describe('새벽 정리 기준 시각(KST 04:00)', () => {
  it('오후에는 오늘 04:00 이 기준', () => {
    // 10/15 15:00 KST
    expect(lastCleanupCutoff(new Date('2026-10-15T06:00:00Z')).toISOString()).toBe('2026-10-14T19:00:00.000Z');
  });
  it('새벽 3시에는 어제 04:00 이 기준(아직 오늘 정리 전)', () => {
    // 10/16 03:00 KST
    expect(lastCleanupCutoff(new Date('2026-10-15T18:00:00Z')).toISOString()).toBe('2026-10-14T19:00:00.000Z');
  });
  it('04:00 정각 이후에는 오늘 04:00', () => {
    expect(lastCleanupCutoff(new Date('2026-10-15T19:00:00Z')).toISOString()).toBe('2026-10-15T19:00:00.000Z');
  });
});
