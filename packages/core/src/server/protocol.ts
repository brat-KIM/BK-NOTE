import type { Item, List, TableName } from '../model';

/** 기기 → 서버 저장 요청. base 는 「바꾸기 전에 내가 알던 값」(필드별 충돌 판정용). */
export interface SaveRequest {
  table: TableName;
  id: string;
  patch: Record<string, unknown>;
  base: Record<string, unknown>;
  insert: boolean;
  device: string;
}

export interface SaveResult {
  /** 저장 후 서버 행. 서버에 없는 행을 고치려 했으면 null(이미 영구 삭제됨). */
  row: Item | List | null;
  /** 본문이 양쪽에서 바뀌었을 때 만들어진 「충돌 사본」 항목. */
  copy?: Item | null;
}

export interface PullResult {
  items: Item[];
  lists: List[];
  /** 다음 pull 기준 시각(서버 시계). */
  serverTime: string;
}

export interface Session {
  userId: string;
  email: string | null;
}

/**
 * 서버 연동부. Supabase 구현(supabaseAdapter)과 테스트용 메모리 구현(memoryServer)이 있다.
 * 서버가 없으면(local-only) 어댑터 없이 기기 안에서만 동작한다.
 */
export interface ServerAdapter {
  save(req: SaveRequest): Promise<SaveResult>;
  pull(since: string | null): Promise<PullResult>;
  /** 실시간 변경 구독. 해제 함수를 돌려준다. */
  subscribe(onRow: (table: TableName, row: Item | List) => void, onStatus?: (s: RealtimeStatus) => void): () => void;
}

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

export class NetworkError extends Error {}
