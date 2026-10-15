// AI 연결: 서버(Edge Function "ai")를 거친다. 서버가 없거나 AI 를 끄면 null → 앱은 AI 없이 동작.
import { AiError, type AiTransport, type TaskInput, type TaskName, type TaskOutput } from '@bk-note/core';
import type { Cloud } from './cloud';

declare global {
  interface Window {
    /** e2e 테스트 전용(빌드 모드 e2e 에서만 읽음) */
    __bkAiMock?: (task: string, input: unknown) => Promise<unknown>;
  }
}

export function createAi(cloud: Cloud | null): AiTransport | null {
  if (cloud) {
    return {
      async run<T extends TaskName>(task: T, input: TaskInput<T>) {
        try {
          const res = await cloud.invoke<{ output: TaskOutput<T> }>('ai', { task, input });
          return res.output;
        } catch (e) {
          const status = (e as { context?: { status?: number } }).context?.status;
          if (status === 429) throw new AiError('오늘 AI 사용 한도를 다 썼어', 'limit');
          throw new AiError('AI 가 지금 응답이 없어', 'failed');
        }
      },
    };
  }
  if (import.meta.env.MODE === 'e2e') {
    return {
      async run<T extends TaskName>(task: T, input: TaskInput<T>) {
        if (!window.__bkAiMock) throw new AiError('mock 없음', 'disabled');
        return (await window.__bkAiMock(task, input)) as TaskOutput<T>;
      },
    };
  }
  return null;
}
