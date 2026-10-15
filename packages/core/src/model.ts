// 데이터 모델. supabase/migrations/0001_init.sql 의 테이블과 1:1로 맞춘다.

export type Context = 'office' | 'home' | 'phone';
export type Size = '5m' | '30m' | 'big';
export type ListKind = 'normal' | 'daily';

/** TipTap(ProseMirror) JSON. 항목 본문은 문단 하나에 인라인 서식만 쓴다. */
export interface RichDoc {
  type: 'doc';
  content?: RichNode[];
}
export interface RichNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
}

export interface Item {
  id: string;
  list_id: string;
  parent_id: string | null;
  content: RichDoc;
  plain: string;
  color: string | null;
  pinned: boolean;
  contexts: Context[];
  size: Size | null;
  remind_at: string | null;
  snoozed_until: string | null;
  done_at: string | null;
  deleted_at: string | null;
  no_ai: boolean;
  sort_key: string;
  version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface List {
  id: string;
  name: string;
  kind: ListKind;
  sort_key: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export type TableName = 'items' | 'lists';
export type Row<T extends TableName> = T extends 'items' ? Item : List;

/** 서버가 관리하는 필드. 클라이언트 patch 에 넣지 않는다. */
export const SERVER_FIELDS = ['version', 'updated_at', 'updated_by', 'created_at'] as const;

/** 양쪽에서 바뀌면 「충돌 사본」을 만드는 필드. 나머지는 나중에 저장한 쪽이 이긴다. */
export const CONFLICT_FIELDS = ['content', 'plain'] as const;

export const ITEM_FIELDS = [
  'list_id', 'parent_id', 'content', 'plain', 'color', 'pinned', 'contexts', 'size',
  'remind_at', 'snoozed_until', 'done_at', 'deleted_at', 'no_ai', 'sort_key',
] as const;
export const LIST_FIELDS = ['name', 'kind', 'sort_key', 'deleted_at'] as const;

export function textDoc(text: string): RichDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  };
}

export function plainText(doc: RichDoc | RichNode): string {
  const parts: string[] = [];
  const walk = (n: RichNode | RichDoc, depth: number) => {
    if ('text' in n && typeof n.text === 'string') parts.push(n.text);
    if (n.type === 'hardBreak') parts.push('\n');
    n.content?.forEach((c, i) => {
      if (depth === 0 && i > 0) parts.push('\n');
      walk(c, depth + 1);
    });
  };
  walk(doc, 0);
  return parts.join('');
}

/** 값 비교(배열·객체 포함). 서버의 jsonb 비교와 같은 의미. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
