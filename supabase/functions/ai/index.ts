// AI 중계(Edge Function). 기기에는 API 키가 없고 여기서만 쓴다.
// 1순위 Claude Haiku 5.5 → 실패하면 Gemini(무료 티어 가능) → 둘 다 실패하면 503(앱은 AI 없이 동작).
// 비밀값(supabase secrets set): ANTHROPIC_API_KEY, GEMINI_API_KEY(선택), AI_DAILY_LIMIT(기본 200), GEMINI_MODEL(선택)
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createClient } from '@supabase/supabase-js';
import { parseModelJson, systemPrompt, TASK_NAMES, TASKS, type TaskName } from '../../../packages/core/src/ai/tasks.ts';

const CLAUDE_MODEL = 'claude-haiku-5-5';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function runClaude(task: TaskName, input: unknown) {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
  const def = TASKS[task];
  const response = await client.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system: systemPrompt(task, false),
    messages: [{ role: 'user', content: (def.user as (i: unknown) => string)(input) }],
    output_config: { effort: 'low', format: zodOutputFormat(def.schema) },
  });
  if (response.stop_reason === 'refusal') throw new Error('refusal');
  if (!response.parsed_output) throw new Error('no parsed output');
  return { provider: 'claude', output: response.parsed_output };
}

async function runGemini(task: TaskName, input: unknown) {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-lite-latest';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(task, true) }] },
      contents: [{ role: 'user', parts: [{ text: (TASKS[task].user as (i: unknown) => string)(input) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  return { provider: 'gemini', output: parseModelJson(task, text) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

  // 로그인한 사용자만(사용량 상한은 사용자별)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return json({ error: 'unauthorized' }, 401);

  const { task, input } = (await req.json().catch(() => ({}))) as { task?: TaskName; input?: unknown };
  if (!task || !TASK_NAMES.includes(task)) return json({ error: 'unknown task' }, 400);

  const limit = Number(Deno.env.get('AI_DAILY_LIMIT') ?? 200);
  const { data: allowed, error: limitErr } = await supabase.rpc('ai_take', { p_limit: limit });
  if (limitErr) return json({ error: limitErr.message }, 500);
  if (!allowed) return json({ error: 'daily limit', code: 'limit' }, 429);

  const errors: string[] = [];
  for (const run of [runClaude, runGemini]) {
    try {
      return json(await run(task, input));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  console.error('ai failed', errors);
  return json({ error: 'ai unavailable', code: 'failed', detail: errors }, 503);
});
