// lib/session-chat-helpers.ts
//
// 세션 채팅(GM 스크립트 + 방별 실시간 채팅 + 주사위) 데이터 접근 헬퍼.
// 스키마: sql/pending/2026-08-27_session_chat.sql
//
// 방침:
//   · 쓰기는 전부 RPC 경유(테이블에 직접 INSERT/UPDATE 정책 없음)
//   · 읽기는 RLS 로 보호된 SELECT (메시지) + RPC (방 목록)
//   · 실패 시 안전한 기본값 반환. 예외를 위로 던지지 않음
//   · Realtime 구독은 컴포넌트 쪽에서. 이 파일은 순수 데이터 접근만.
//
// 조회 구조 (2026-08-28 페이지네이션 개편):
//   · 스크립트(kind='script')는 방당 소수라 항상 전량 조회.
//   · 채팅 스트림(chat/roll/system)은 최신 CHAT_INITIAL_LOAD 건 + 위로
//     스크롤 시 CHAT_OLDER_PAGE 건씩 추가 조회(created_at 커서).
//   · 모든 조회는 소프트 삭제 행(툼스톤)을 "포함"해서 가져온다.
//     화면 상태가 교체가 아니라 병합으로 유지되기 때문에, 삭제 반영은
//     툼스톤이 같은 id 의 살아있는 행을 덮어쓰고 mergeSessionMessages 의
//     deleted_at 필터에서 걸러지는 방식으로 일어난다. 툼스톤을 빼고
//     조회하면 삭제가 화면에 반영되지 않으니 필터를 다시 넣지 말 것.
//
// 기존 gm-chat-helpers(1:1 문의 채팅)와는 완전히 별개. 서로 참조하지 않음.

import { supabase } from "./supabase";

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

export type SessionRoomMember = {
  profile_id: string;
  name:       string;
};

export type SessionRoom = {
  id:              string;
  name:            string;
  is_open:         boolean;
  is_archived:     boolean;
  created_at:      string;
  updated_at:      string;
  /** GM 이거나 멤버면 true. false 면 목록에만 보이고 입장 불가. */
  can_enter:       boolean;
  member_count:    number;
  members:         SessionRoomMember[];
  last_message_at: string | null;
};

export type SessionMessageKind = "chat" | "script" | "roll" | "system";
export type SessionSenderRole  = "user" | "gm" | "system";

export type DanceResult =
  | "critical_success"
  | "extreme_success"
  | "hard_success"
  | "success"
  | "fail"
  | "fumble";

export type SessionRollMeta =
  | { roll_type: "d100"; value: number }
  | { roll_type: "coin"; result: "success" | "fail" }
  | { roll_type: "dance"; value: number; total: number; result: DanceResult };

export type SessionMessage = {
  id:                string;
  room_id:           string;
  sender_profile_id: string | null;
  sender_role:       SessionSenderRole;
  sender_name:       string;
  kind:              SessionMessageKind;
  content:           string;
  meta:              SessionRollMeta | null;
  edited_at:         string | null;
  deleted_at:        string | null;
  created_at:        string;
};

export type RollType = "d100" | "coin" | "dance";

/** RPC 호출 결과 정규화 형태. */
export type SessionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; reason: string; message: string };

/** RPC 에러 코드 → 한국어 안내 문구. */
const RPC_ERROR_MESSAGES: Record<string, string> = {
  auth_required:         "로그인이 필요합니다.",
  gm_only:               "GM 권한이 필요합니다.",
  profile_not_found:     "프로필을 찾을 수 없습니다.",
  account_deactivated:   "비활성화된 계정입니다.",
  room_not_found:        "방을 찾을 수 없습니다.",
  room_closed:           "닫힌 방입니다. 열람만 가능합니다.",
  not_a_member:          "이 방의 참가자가 아닙니다.",
  session_chat_disabled: "지금은 조사방을 사용할 수 없습니다.",
  empty_content:         "내용을 입력해주십시오.",
  content_too_long:      "내용이 너무 깁니다.",
  invalid_roll_type:     "주사위 종류가 올바르지 않습니다.",
  invalid_room_name:     "방 이름은 1~60자여야 합니다.",
  message_not_found:     "메시지를 찾을 수 없습니다.",
};

function normalizeRpcError(message: string | undefined): {
  reason: string;
  message: string;
} {
  const raw = (message ?? "").trim();
  for (const code of Object.keys(RPC_ERROR_MESSAGES)) {
    if (raw.includes(code)) {
      return { reason: code, message: RPC_ERROR_MESSAGES[code] };
    }
  }
  return {
    reason:  "unknown",
    message: "처리 중 오류가 발생하였습니다. 잠시 후 다시 시도해주십시오.",
  };
}

/** RETURNS <table row> 형 RPC 는 객체 1개 또는 배열로 올 수 있어 첫 행으로 정규화. */
function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

/* 메시지 렌더용 SELECT 컬럼 목록(고정) */
const MESSAGE_COLUMNS =
  "id, room_id, sender_profile_id, sender_role, sender_name, kind, content, meta, edited_at, deleted_at, created_at";

/** 채팅 스트림 최초 로드 건수. */
export const CHAT_INITIAL_LOAD = 300;
/** 위로 스크롤 시 한 번에 추가 로드하는 건수. */
export const CHAT_OLDER_PAGE = 200;
/** 스크립트 전량 조회의 안전 상한. 방당 스크립트는 많아야 수십 건. */
export const SCRIPT_FETCH_CAP = 500;


/* ═══════════════════════════════════════════════════════════
 * 공통 조회
 * ─────────────────────────────────────────────────────────── */

/** 노출 토글 상태. 실패 시 false(숨김이 안전). */
export async function getSessionChatEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc("session_get_enabled");
  if (error) {
    console.error("[getSessionChatEnabled] failed:", error.message);
    return false;
  }
  return data === true;
}

/**
 * 방 목록. 유저는 활성 방 전체(입장 가능 여부는 can_enter), GM 은 보관 포함 가능.
 * 실패 시 빈 배열.
 */
export async function listSessionRooms(includeArchived = false): Promise<SessionRoom[]> {
  const { data, error } = await supabase.rpc("session_list_rooms", {
    p_include_archived: includeArchived,
  });
  if (error) {
    console.error("[listSessionRooms] failed:", error.message);
    return [];
  }
  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows.map((r) => ({
    id:              String(r.id),
    name:            String(r.name ?? ""),
    is_open:         r.is_open === true,
    is_archived:     r.is_archived === true,
    created_at:      String(r.created_at),
    updated_at:      String(r.updated_at),
    can_enter:       r.can_enter === true,
    member_count:    Number(r.member_count ?? 0),
    members:         Array.isArray(r.members) ? (r.members as SessionRoomMember[]) : [],
    last_message_at: (r.last_message_at as string | null) ?? null,
  }));
}

/** 채팅 스트림 조회 결과. hasMore 는 커서 이전에 더 남았는지. */
export type ChatFetchResult = {
  ok:       boolean;
  messages: SessionMessage[];
  hasMore:  boolean;
};

/**
 * 스크립트 전량 조회 (툼스톤 포함, 오래된 순).
 * ok=false 는 네트워크·권한 오류 — 호출부는 화면을 지우지 말 것.
 */
export async function fetchSessionScripts(
  roomId: string
): Promise<{ ok: boolean; messages: SessionMessage[] }> {
  const { data, error } = await supabase
    .from("session_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .eq("kind", "script")
    .order("created_at", { ascending: false })
    .limit(SCRIPT_FETCH_CAP);

  if (error) {
    console.error("[fetchSessionScripts] failed:", error.message);
    return { ok: false, messages: [] };
  }
  const rows = ((data as SessionMessage[] | null) ?? []).slice();
  rows.reverse();
  return { ok: true, messages: rows };
}

/**
 * 채팅 스트림(script 제외) 최신 CHAT_INITIAL_LOAD 건 (툼스톤 포함, 오래된 순).
 * limit+1 로 요청해 hasMore 를 정확히 판정한다.
 */
export async function fetchSessionChats(roomId: string): Promise<ChatFetchResult> {
  const { data, error } = await supabase
    .from("session_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .neq("kind", "script")
    .order("created_at", { ascending: false })
    .limit(CHAT_INITIAL_LOAD + 1);

  if (error) {
    console.error("[fetchSessionChats] failed:", error.message);
    return { ok: false, messages: [], hasMore: false };
  }
  const rows = ((data as SessionMessage[] | null) ?? []).slice();
  const hasMore = rows.length > CHAT_INITIAL_LOAD;
  if (hasMore) rows.length = CHAT_INITIAL_LOAD;
  rows.reverse();
  return { ok: true, messages: rows, hasMore };
}

/**
 * 커서(beforeCreatedAt) 이전의 채팅 스트림 CHAT_OLDER_PAGE 건
 * (툼스톤 포함, 오래된 순). 위로 스크롤 시 추가 로드용.
 *
 * 커서는 created_at 단독 비교(lt)라, 정확히 같은 타임스탬프(µs)의 행이
 * 경계에 겹치면 이론상 건너뛸 수 있다. timestamptz 마이크로초 정밀도에서
 * 이 규모(25인 미만)로는 실질 발생하지 않아 단순함을 택했다.
 */
export async function fetchOlderSessionChats(
  roomId: string,
  beforeCreatedAt: string
): Promise<ChatFetchResult> {
  const { data, error } = await supabase
    .from("session_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .neq("kind", "script")
    .lt("created_at", beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(CHAT_OLDER_PAGE + 1);

  if (error) {
    console.error("[fetchOlderSessionChats] failed:", error.message);
    return { ok: false, messages: [], hasMore: false };
  }
  const rows = ((data as SessionMessage[] | null) ?? []).slice();
  const hasMore = rows.length > CHAT_OLDER_PAGE;
  if (hasMore) rows.length = CHAT_OLDER_PAGE;
  rows.reverse();
  return { ok: true, messages: rows, hasMore };
}


/* ═══════════════════════════════════════════════════════════
 * 발언 (유저·GM)
 * ─────────────────────────────────────────────────────────── */

export async function sendSessionMessage(
  roomId: string,
  content: string
): Promise<SessionResult<SessionMessage>> {
  const { data, error } = await supabase.rpc("session_send_message", {
    p_room_id: roomId,
    p_content: content,
  });
  if (error) {
    const n = normalizeRpcError(error.message);
    return { ok: false, ...n };
  }
  const row = firstRow<SessionMessage>(data);
  if (!row) return { ok: false, reason: "unknown", message: RPC_ERROR_MESSAGES.empty_content };
  return { ok: true, data: row };
}

export async function rollSessionDice(
  roomId: string,
  rollType: RollType
): Promise<SessionResult<SessionMessage>> {
  const { data, error } = await supabase.rpc("session_roll", {
    p_room_id:   roomId,
    p_roll_type: rollType,
  });
  if (error) {
    const n = normalizeRpcError(error.message);
    return { ok: false, ...n };
  }
  const row = firstRow<SessionMessage>(data);
  if (!row) return { ok: false, reason: "unknown", message: "주사위 결과를 받지 못했습니다." };
  return { ok: true, data: row };
}


/* ═══════════════════════════════════════════════════════════
 * GM 전용
 * ─────────────────────────────────────────────────────────── */

export async function gmSetSessionChatEnabled(enabled: boolean): Promise<SessionResult<boolean>> {
  const { data, error } = await supabase.rpc("session_gm_set_enabled", { p_enabled: enabled });
  if (error) return { ok: false, ...normalizeRpcError(error.message) };
  return { ok: true, data: data === true };
}

export async function gmCreateSessionRoom(
  name: string,
  memberProfileIds: string[]
): Promise<SessionResult<string>> {
  const { data, error } = await supabase.rpc("session_gm_create_room", {
    p_name:               name,
    p_member_profile_ids: memberProfileIds,
  });
  if (error) return { ok: false, ...normalizeRpcError(error.message) };
  if (typeof data !== "string") {
    return { ok: false, reason: "unknown", message: "방 생성 결과를 받지 못했습니다." };
  }
  return { ok: true, data };
}

export async function gmSetSessionRoomMembers(
  roomId: string,
  memberProfileIds: string[]
): Promise<SessionResult<number>> {
  const { data, error } = await supabase.rpc("session_gm_set_members", {
    p_room_id:            roomId,
    p_member_profile_ids: memberProfileIds,
  });
  if (error) return { ok: false, ...normalizeRpcError(error.message) };
  return { ok: true, data: Number(data ?? 0) };
}

export async function gmUpdateSessionRoom(
  roomId: string,
  patch: { name?: string; isOpen?: boolean }
): Promise<SessionResult> {
  const { error } = await supabase.rpc("session_gm_update_room", {
    p_room_id: roomId,
    p_name:    patch.name ?? null,
    p_is_open: patch.isOpen ?? null,
  });
  if (error) return { ok: false, ...normalizeRpcError(error.message) };
  return { ok: true, data: undefined };
}

export async function gmSetSessionRoomArchived(
  roomId: string,
  archived: boolean
): Promise<SessionResult> {
  const { error } = await supabase.rpc("session_gm_set_archived", {
    p_room_id:  roomId,
    p_archived: archived,
  });
  if (error) return { ok: false, ...normalizeRpcError(error.message) };
  return { ok: true, data: undefined };
}

export async function gmPostSessionScript(
  roomId: string,
  content: string
): Promise<SessionResult<SessionMessage>> {
  const { data, error } = await supabase.rpc("session_gm_post_script", {
    p_room_id: roomId,
    p_content: content,
  });
  if (error) return { ok: false, ...normalizeRpcError(error.message) };
  const row = firstRow<SessionMessage>(data);
  if (!row) return { ok: false, reason: "unknown", message: "게시 결과를 받지 못했습니다." };
  return { ok: true, data: row };
}

export async function gmUpdateSessionScript(
  messageId: string,
  content: string
): Promise<SessionResult<SessionMessage>> {
  const { data, error } = await supabase.rpc("session_gm_update_script", {
    p_message_id: messageId,
    p_content:    content,
  });
  if (error) return { ok: false, ...normalizeRpcError(error.message) };
  const row = firstRow<SessionMessage>(data);
  if (!row) return { ok: false, reason: "unknown", message: "수정 결과를 받지 못했습니다." };
  return { ok: true, data: row };
}

export async function gmDeleteSessionMessage(messageId: string): Promise<SessionResult> {
  const { error } = await supabase.rpc("session_gm_delete_message", {
    p_message_id: messageId,
  });
  if (error) return { ok: false, ...normalizeRpcError(error.message) };
  return { ok: true, data: undefined };
}


/* ═══════════════════════════════════════════════════════════
 * 유틸
 * ─────────────────────────────────────────────────────────── */

/**
 * 메시지 병합: id 기준 중복 제거 + created_at 오름차순.
 * Realtime INSERT / 재동기화 / 이전 페이지 로드가 섞여도 순서·중복이
 * 깨지지 않게 한다. UPDATE(수정·소프트삭제)는 같은 id 를 덮어쓴다.
 * 툼스톤(deleted_at 있음)은 같은 id 의 살아있는 행을 덮어쓴 뒤 아래
 * 필터에서 제거된다 — 이것이 병합 방식에서의 삭제 반영 경로다.
 */
export function mergeSessionMessages(
  prev: SessionMessage[],
  incoming: SessionMessage[]
): SessionMessage[] {
  const map = new Map<string, SessionMessage>();
  for (const m of prev)     map.set(m.id, m);
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values())
    .filter((m) => !m.deleted_at)
    .sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    );
}