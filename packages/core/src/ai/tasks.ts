// AI 작업 정의(프롬프트 + 출력 스키마). 기기(웹)와 Supabase Edge Function "ai" 가 함께 쓴다.
// Edge Function(Deno)에서도 그대로 불러오도록 이 파일은 zod 외에 다른 모듈을 import 하지 않는다.
import { z } from 'zod/v4';

export const CONTEXTS = ['office', 'home', 'phone'] as const;
export const SIZES = ['5m', '30m', 'big'] as const;

/** "YYYY-MM-DD HH:MM"(한국 시간) 또는 null */
const kstTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).nullable();

const COMMON = [
  '너는 한국어 리마인더 메모 앱 BK-NOTE 의 도우미다.',
  '사용자는 생각났는데 지금 못 하는 일과 아이디어를 짧게 적어 두고, 짬 날 때 처리한 뒤 지운다.',
  '항상 지정된 JSON 형식으로만 답한다. 설명 문장을 JSON 밖에 쓰지 않는다.',
  '본문(text)은 사용자가 쓴 말투를 살려 짧게 쓴다. 날짜·시간·태그 표현은 본문에서 뺀다.',
  'contexts: office=사무실에서 할 일, home=집에서 할 일, phone=폰으로 할 수 있는 일(전화·문자·간단 확인). 확실할 때만 넣는다.',
  'size: 5m=5분 안에 끝남, 30m=30분 안팎, big=큰일. 짐작이 어려우면 null.',
  '시각은 한국 시간 "YYYY-MM-DD HH:MM" 형식. 날짜만 있고 시간이 없으면 09:00. 날짜 표현이 없으면 null.',
].join('\n');

export const parseSchema = z.object({
  text: z.string(),
  remind_at_kst: kstTime,
  contexts: z.array(z.enum(CONTEXTS)),
  size: z.enum(SIZES).nullable(),
  list: z.string().nullable(),
});

export const splitSchema = z.object({
  items: z.array(parseSchema).max(12),
});

export const staleSchema = z.object({
  suggestions: z.array(z.object({
    id: z.string(),
    action: z.enum(['do_now', 'schedule', 'split', 'delete']),
    reason: z.string(),
    first_step: z.string().nullable(),
  })),
});

export const refineSchema = z.object({
  text: z.string(),
  next_action: z.string().nullable(),
});

export const slotSchema = z.object({
  ids: z.array(z.string()).max(3),
  reason: z.string(),
});

export interface ListRef { name: string }
export interface BriefItem { id: string; text: string; age_days: number; size: string | null; contexts: string[] }

export const TASKS = {
  parse: {
    schema: parseSchema,
    system: COMMON + '\n규칙 기반 해석기가 못 푼 애매한 한 줄을 해석한다. list 는 주어진 섹션 이름 중 가장 맞는 것(애매하면 null).',
    user: (i: { text: string; nowKst: string; lists: ListRef[] }) =>
      `지금: ${i.nowKst} (한국 시간)\n섹션: ${i.lists.map((l) => l.name).join(', ')}\n입력: ${i.text}`,
  },
  split: {
    schema: splitSchema,
    system: COMMON + '\n붙여넣은 덩어리(카톡·메일·메모)에서 해야 할 일과 아이디어를 항목으로 나눈다. 인사·잡담은 버린다. 최대 12개.',
    user: (i: { text: string; nowKst: string; lists: ListRef[] }) =>
      `지금: ${i.nowKst} (한국 시간)\n섹션: ${i.lists.map((l) => l.name).join(', ')}\n붙여넣은 내용:\n"""\n${i.text}\n"""`,
  },
  stale: {
    schema: staleSchema,
    system: COMMON + '\n2주 넘게 묵은 항목마다 처리 방법을 제안한다. do_now=지금 바로(작음), schedule=날짜를 정하자, split=쪼개서 첫 단계부터, delete=이제 필요 없어 보임. reason 은 한 문장. split 일 때 first_step 에 바로 할 첫 단계를 한 줄로.',
    user: (i: { items: BriefItem[] }) => JSON.stringify(i.items),
  },
  refine: {
    schema: refineSchema,
    system: COMMON + '\n한 줄 아이디어를 3~5줄로 정리한다(핵심·왜·어떻게). next_action 은 오늘 할 수 있는 다음 행동 한 줄.',
    user: (i: { text: string }) => i.text,
  },
  slot: {
    schema: slotSchema,
    system: COMMON + '\n지금 짬 시간과 장소에 맞는 항목을 최대 3개 고른다. 시간 안에 끝낼 수 있는 것, 오래 묵은 것을 우선. reason 은 한 문장.',
    user: (i: { minutes: number; place: string | null; items: BriefItem[] }) =>
      `짬: ${i.minutes}분, 장소: ${i.place ?? '모름'}\n항목: ${JSON.stringify(i.items)}`,
  },
} as const;

export type TaskName = keyof typeof TASKS;
export type TaskInput<T extends TaskName> = Parameters<(typeof TASKS)[T]['user']>[0];
export type TaskOutput<T extends TaskName> = z.infer<(typeof TASKS)[T]['schema']>;

export const TASK_NAMES = Object.keys(TASKS) as TaskName[];

/** 스키마 강제가 없는 제공자(Gemini)용: 출력 모양 예시를 시스템 프롬프트에 붙인다 */
export const SHAPES: Record<TaskName, string> = {
  parse: '{"text":"세무사 전화","remind_at_kst":"2026-10-19 09:00","contexts":["phone"],"size":"5m","list":"✅ 할 일"}',
  split: '{"items":[{"text":"...","remind_at_kst":null,"contexts":[],"size":null,"list":null}]}',
  stale: '{"suggestions":[{"id":"...","action":"split","reason":"...","first_step":"..."}]}',
  refine: '{"text":"줄1\\n줄2\\n줄3","next_action":"..."}',
  slot: '{"ids":["..."],"reason":"..."}',
};

export function systemPrompt(task: TaskName, withShape: boolean): string {
  const base = TASKS[task].system;
  return withShape ? `${base}\n출력 JSON 모양(값은 예시): ${SHAPES[task]}` : base;
}

/** 모델 출력(문자열)을 JSON 으로 읽고 스키마로 검사. 코드블록으로 감싸 와도 받아 준다. */
export function parseModelJson<T extends TaskName>(task: T, raw: string): TaskOutput<T> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = fillDefaults(JSON.parse(start >= 0 ? trimmed.slice(start, end + 1) : trimmed));
  return TASKS[task].schema.parse(json) as TaskOutput<T>;
}

// 스키마 강제가 없는 제공자는 null 필드를 아예 빼먹기도 한다 → 빠진 키를 기본값으로 채운다
const NULLABLE_KEYS = ['remind_at_kst', 'size', 'list', 'first_step', 'next_action'];
function fillDefaults(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fillDefaults);
  if (!v || typeof v !== 'object') return v;
  const o: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) o[k] = fillDefaults(val);
  if ('text' in o || 'action' in o) {
    for (const k of NULLABLE_KEYS) if (!(k in o)) o[k] = null;
    if ('text' in o && !('contexts' in o) && !('next_action' in o)) o.contexts = [];
  }
  return o;
}
