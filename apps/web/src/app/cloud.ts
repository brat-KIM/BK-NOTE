// Supabase 연동(서버 어댑터 + 로그인). 설정값이 없으면 쓰이지 않는다(local-only).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  NetworkError,
  type Item,
  type List,
  type PullResult,
  type RealtimeStatus,
  type SaveRequest,
  type SaveResult,
  type ServerAdapter,
  type Session,
  type TableName,
} from '@bk-note/core';

export interface Cloud {
  client: SupabaseClient;
  adapter: ServerAdapter;
  getSession(): Promise<Session | null>;
  onSession(fn: (s: Session | null) => void): () => void;
  /** 매직 링크 + 6자리 코드 메일 발송 */
  sendLoginEmail(email: string): Promise<void>;
  /** 메일의 6자리 코드로 로그인(데스크톱 앱처럼 링크를 열 수 없을 때) */
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  /** AI 중계 함수 호출 */
  invoke<T>(fn: string, body: unknown): Promise<T>;
}

export async function createCloud(url: string, anonKey: string): Promise<Cloud> {
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  const toSession = (s: { user: { id: string; email?: string | null } } | null): Session | null =>
    s ? { userId: s.user.id, email: s.user.email ?? null } : null;

  return {
    client,
    adapter: new SupabaseAdapter(client),
    async getSession() {
      const { data } = await client.auth.getSession();
      return toSession(data.session);
    },
    onSession(fn) {
      const { data } = client.auth.onAuthStateChange((_e, s) => fn(toSession(s)));
      return () => data.subscription.unsubscribe();
    },
    async sendLoginEmail(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: location.origin },
      });
      if (error) throw error;
    },
    async verifyCode(email, code) {
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw error;
    },
    async signOut() {
      await client.auth.signOut({ scope: 'global' });
    },
    async invoke<T>(fn: string, body: unknown) {
      const { data, error } = await client.functions.invoke(fn, { body: body as Record<string, unknown> });
      if (error) throw error;
      return data as T;
    },
  };
}

function isNetworkError(e: { message?: string; code?: string; status?: number } | null) {
  if (!e) return false;
  const m = e.message ?? '';
  return /fetch|network|Load failed|timeout/i.test(m) || e.status === 0;
}

export class SupabaseAdapter implements ServerAdapter {
  constructor(private client: SupabaseClient) {}

  async save(req: SaveRequest): Promise<SaveResult> {
    const { data, error } = await this.client.rpc('save_row', {
      p_table: req.table,
      p_id: req.id,
      p_patch: req.patch,
      p_base: req.base,
      p_insert: req.insert,
      p_device: req.device,
    });
    if (error) throw isNetworkError(error) ? new NetworkError(error.message) : new Error(error.message);
    return data as SaveResult;
  }

  async pull(since: string | null): Promise<PullResult> {
    const { data, error } = await this.client.rpc('pull_rows', { p_since: since });
    if (error) throw isNetworkError(error) ? new NetworkError(error.message) : new Error(error.message);
    const d = data as { items: Item[]; lists: List[]; server_time: string };
    return { items: d.items ?? [], lists: d.lists ?? [], serverTime: d.server_time };
  }

  subscribe(onRow: (t: TableName, r: Item | List) => void, onStatus?: (s: RealtimeStatus) => void) {
    onStatus?.('connecting');
    let channel: ReturnType<SupabaseClient['channel']> | null = null;
    let cancelled = false;
    void (async () => {
      const { data } = await this.client.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid || cancelled) {
        onStatus?.('offline');
        return;
      }
      channel = this.client.channel(`rows:${uid}`);
      for (const table of ['items', 'lists'] as const) {
        channel.on(
          'postgres_changes' as never,
          { event: '*', schema: 'public', table, filter: `owner=eq.${uid}` },
          (payload: { new: Item | List }) => {
            if (payload.new && 'id' in payload.new) onRow(table, payload.new);
          },
        );
      }
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') onStatus?.('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus?.('offline');
      });
    })();
    return () => {
      cancelled = true;
      if (channel) void this.client.removeChannel(channel);
    };
  }
}
