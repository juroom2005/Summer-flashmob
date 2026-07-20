// lib/gm-chat-helpers.ts
//
// GM 1:1 채팅 관련 데이터 접근 헬퍼.
// 스키마: sql/2026-07-20_gm_chat.sql (테이블 2개 + RPC 4개 + 트리거)
//
// 방침:
//   · UPDATE는 반드시 RPC 경유 (RLS 정책 상 직접 UPDATE 정책 없음)
//   · INSERT는 유저·GM 모두 RLS로 방어. sender_profile_id는 서버측 재검증됨
//   · 실패 시 안전한 기본값 반환 (null / 0 / 빈 배열). 예외를 위로 던지지 않음
//     — 뱃지 미표시 < 뱃지 오류 표시가 안전이라는 판단
//
// Realtime 구독은 별도 훅에서 처리. 이 파일은 순수 데이터 접근만.

import { supabase } from "./supabase";
import { getCurrentProfile } from "./auth-helpers";

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

/**
 * gm_conversations 원본 행.
 */
export type GmConversationRow = {
  id:                 string;
  user_id:            string;
  user_profile_id:    string;
  last_user_msg_at:   string | null;
  last_gm_msg_at:     string | null;
  user_last_read_at:  string;
  gm_last_read_at:    string;
  created_at:         string;
  updated_at:         string;
};

/**
 * GM 목록 UI 전용 형태. profile 조인 + 개별 unread_count 포함.
 */
export type GmConversationForGm = {
  id:                 string;
  user_id:            string;
  user_profile_id:    string;
  last_user_msg_at:   string | null;
  last_gm_msg_at:     string | null;
  gm_last_read_at:    string;
  updated_at:         string;
  user_profile: {
    id:           string;
    family_name:  string | null;
    given_name:   string | null;
  } | null;
  unread_count:       number;
};

export type GmChatMessage = {
  id:                 string;
  conversation_id:    string;
  sender_role:        "user" | "gm" | "system";
  sender_profile_id:  string | null;
  msg_type:           "text" | "system_resolved";
  content:            string;
  created_at:         string;
};

export type SendResult =
  | { ok: true;  message: GmChatMessage }
  | { ok: false; reason: "empty" | "too_long" | "no_profile" | "insert_failed" };


/* ═══════════════════════════════════════════════════════════
 * 공통 · 방 확보·조회
 * ─────────────────────────────────────────────────────────── */

/**
 * 세션 유저의 방을 확보하고 id 반환.
 * 없으면 생성, 있으면 그대로. race 안전(ON CONFLICT DO NOTHING).
 *
 * 실패 조건:
 *   · 미로그인 → null
 *   · profile 없음 → null
 *   · GM 계정 → null (GM은 자기 방 없음)
 */
export async function ensureMyGmConversation(): Promise<string | null> {
  const { data, error } = await supabase.rpc("ensure_gm_conversation");
  if (error) {
    console.error("[ensureMyGmConversation] failed:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * 세션 유저의 방 행 조회. 없으면 null.
 * user_last_read_at 등 뱃지 계산에 필요한 값 포함.
 *
 * 이 함수는 방을 생성하지 않음. 최초 진입 시엔 ensureMyGmConversation 먼저 호출.
 */
export async function getMyGmConversation(): Promise<GmConversationRow | null> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("gm_conversations")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getMyGmConversation] failed:", error.message);
    return null;
  }
  return (data as GmConversationRow | null) ?? null;
}


/* ═══════════════════════════════════════════════════════════
 * 유저용 · 메시지 조회·전송·읽음
 * ─────────────────────────────────────────────────────────── */

/**
 * 세션 유저 방의 메시지 전체 로드 (오래된 것부터).
 * 실패 시 빈 배열.
 *
 * 25명 규모·문의 성격이라 페이지네이션 미구현.
 * 향후 방 하나가 5000건 넘어가면 페이지네이션 도입 검토.
 */
export async function listMyGmMessages(
  conversationId: string
): Promise<GmChatMessage[]> {
  const { data, error } = await supabase
    .from("gm_conversation_messages")
    .select("id, conversation_id, sender_role, sender_profile_id, msg_type, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .returns<GmChatMessage[]>();

  if (error) {
    console.error("[listMyGmMessages] failed:", error.message);
    return [];
  }
  return data ?? [];
}

/**
 * 유저가 자기 방에 텍스트 메시지 전송.
 * 성공 시 서버 반환값 그대로 반환 (낙관적 UI 없이 서버 응답으로 append).
 */
export async function sendMyGmMessage(
  conversationId: string,
  rawContent:     string
): Promise<SendResult> {
  const content = rawContent.trim();
  if (content.length === 0)  return { ok: false, reason: "empty" };
  if (content.length > 2000) return { ok: false, reason: "too_long" };

  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, reason: "no_profile" };

  const { data, error } = await supabase
    .from("gm_conversation_messages")
    .insert({
      conversation_id:    conversationId,
      sender_role:        "user",
      sender_profile_id:  profile.id,
      msg_type:           "text",
      content,
    })
    .select("id, conversation_id, sender_role, sender_profile_id, msg_type, content, created_at")
    .single()
    .returns<GmChatMessage>();

  if (error || !data) {
    console.error("[sendMyGmMessage] failed:", error?.message);
    return { ok: false, reason: "insert_failed" };
  }
  return { ok: true, message: data };
}

/**
 * 유저 관점 미읽음 메시지 개수 (관리자호출 아이콘 뱃지용).
 *
 * 정의: 자기 방의 메시지 중 sender_role IN ('gm','system')이며
 *       created_at > user_last_read_at인 것의 개수.
 *
 * 방이 없거나 오류면 0.
 * 완료 안내(system_resolved)도 뱃지에 포함 — 유저가 확인해야 할 사건이므로.
 */
export async function getMyGmUnreadCount(): Promise<number> {
  const conv = await getMyGmConversation();
  if (!conv) return 0;

  const { count, error } = await supabase
    .from("gm_conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conv.id)
    .in("sender_role", ["gm", "system"])
    .gt("created_at", conv.user_last_read_at);

  if (error) {
    console.error("[getMyGmUnreadCount] failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * 세션 유저가 특정 방을 방금까지 읽었다고 스탬프 갱신.
 * 오버레이 열림 시·새 메시지 도착 시(스크롤 하단이면) 호출.
 */
export async function markMyGmConversationRead(
  conversationId: string
): Promise<{ ok: boolean }> {
  const { error } = await supabase.rpc(
    "mark_gm_conversation_read_user",
    { p_conversation_id: conversationId }
  );
  if (error) {
    console.error("[markMyGmConversationRead] failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}


/* ═══════════════════════════════════════════════════════════
 * GM용 · 방 목록·메시지 조회·전송·완료 처리·읽음
 *
 * 모든 GM 함수는 GM 아닌 세션이 호출해도 RLS가 조용히 막음 (빈 결과·성공 false).
 * ─────────────────────────────────────────────────────────── */

/**
 * GM용 방 목록 조회.
 *
 * 반환 형태: 각 방마다 프로필 조인 + 개별 unread_count 포함.
 * 정렬: last_user_msg_at DESC NULLS LAST, 그다음 updated_at DESC.
 *
 * unread_count는 방마다 별도 count 쿼리(Promise.all 병렬).
 * 25명 규모라 최대 25회 count. 향후 방 수 증가 시 SQL view 또는 RPC 도입 검토.
 */
export async function listGmConversations(): Promise<GmConversationForGm[]> {
  const { data, error } = await supabase
    .from("gm_conversations")
    .select(`
      id,
      user_id,
      user_profile_id,
      last_user_msg_at,
      last_gm_msg_at,
      gm_last_read_at,
      updated_at,
      user_profile:profiles!user_profile_id (
        id,
        family_name,
        given_name
      )
    `)
    .order("last_user_msg_at", { ascending: false, nullsFirst: false })
    .order("updated_at",       { ascending: false });

  if (error || !data) {
    console.error("[listGmConversations] failed:", error?.message);
    return [];
  }

  const rows = data as unknown as Array<Omit<GmConversationForGm, "unread_count">>;
  const withUnread = await Promise.all(
    rows.map(async (row) => {
      const unread = await getGmUnreadCountForRoom(row.id, row.gm_last_read_at);
      return { ...row, unread_count: unread };
    })
  );

  return withUnread;
}

/**
 * GM 관점 미읽음 방 개수 (관리자호출 아이콘 뱃지용).
 *
 * 정의: last_user_msg_at IS NOT NULL AND last_user_msg_at > gm_last_read_at인 방 수.
 *
 * 구현 노트:
 *   Supabase JS의 filter는 컬럼 대 컬럼 비교를 지원 안 함. 따라서 서버측 count 쿼리로
 *   해결하지 못하고, 두 컬럼을 받아와 클라이언트에서 비교. 방 수가 25 규모라 부담 낮음.
 *   방 수가 급증하면 count_gm_unread_rooms() RPC 추가 도입.
 *
 * RLS 상 GM만 SELECT 가능 — GM 아닌 유저가 호출하면 빈 결과 → 0 반환 (안전).
 */
export async function getGmUnreadRoomCount(): Promise<number> {
  const { data, error } = await supabase
    .from("gm_conversations")
    .select("last_user_msg_at, gm_last_read_at");

  if (error || !data) {
    console.error("[getGmUnreadRoomCount] failed:", error?.message);
    return 0;
  }

  let n = 0;
  for (const row of data as Array<{ last_user_msg_at: string | null; gm_last_read_at: string }>) {
    if (row.last_user_msg_at && row.last_user_msg_at > row.gm_last_read_at) n++;
  }
  return n;
}

/**
 * 특정 방의 미읽음 유저 메시지 개수 (GM 관점, 방 목록 안 개별 뱃지용).
 *
 * @param conversationId  방 id
 * @param gmLastReadAt    해당 방의 gm_last_read_at (호출자가 이미 알고 있으므로 인자로)
 *
 * 정의: sender_role='user' AND created_at > gmLastReadAt인 메시지 수.
 * 실패 시 0.
 */
export async function getGmUnreadCountForRoom(
  conversationId: string,
  gmLastReadAt:   string
): Promise<number> {
  const { count, error } = await supabase
    .from("gm_conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender_role", "user")
    .gt("created_at", gmLastReadAt);

  if (error) {
    console.error("[getGmUnreadCountForRoom] failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * GM용 · 특정 방 메시지 전체 로드 (오래된 것부터).
 */
export async function listGmMessages(
  conversationId: string
): Promise<GmChatMessage[]> {
  const { data, error } = await supabase
    .from("gm_conversation_messages")
    .select("id, conversation_id, sender_role, sender_profile_id, msg_type, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .returns<GmChatMessage[]>();

  if (error) {
    console.error("[listGmMessages] failed:", error.message);
    return [];
  }
  return data ?? [];
}

/**
 * GM이 특정 방에 텍스트 메시지 전송.
 * 실패 조건은 sendMyGmMessage와 대칭.
 * profile.is_gm 사전 체크 (RLS가 최종 방어이지만, 클라이언트에서도 미리 컷).
 */
export async function sendGmMessage(
  conversationId: string,
  rawContent:     string
): Promise<SendResult> {
  const content = rawContent.trim();
  if (content.length === 0)  return { ok: false, reason: "empty" };
  if (content.length > 2000) return { ok: false, reason: "too_long" };

  const profile = await getCurrentProfile();
  if (!profile || !profile.is_gm) return { ok: false, reason: "no_profile" };

  const { data, error } = await supabase
    .from("gm_conversation_messages")
    .insert({
      conversation_id:    conversationId,
      sender_role:        "gm",
      sender_profile_id:  profile.id,
      msg_type:           "text",
      content,
    })
    .select("id, conversation_id, sender_role, sender_profile_id, msg_type, content, created_at")
    .single()
    .returns<GmChatMessage>();

  if (error || !data) {
    console.error("[sendGmMessage] failed:", error?.message);
    return { ok: false, reason: "insert_failed" };
  }
  return { ok: true, message: data };
}

/**
 * 완료 처리. system_resolved 메시지 1건 삽입.
 * 방 자체는 계속 살아있음. 완료 후에도 유저는 자유롭게 메시지 전송 가능.
 * 표시 시각은 삽입 시점의 created_at (진실 공급원).
 */
export async function resolveGmConversation(
  conversationId: string
): Promise<{ ok: boolean; messageId: string | null }> {
  const { data, error } = await supabase.rpc(
    "resolve_gm_conversation",
    { p_conversation_id: conversationId }
  );
  if (error) {
    console.error("[resolveGmConversation] failed:", error.message);
    return { ok: false, messageId: null };
  }
  return { ok: true, messageId: (data as string | null) ?? null };
}

/**
 * GM이 특정 방을 방금까지 읽었다고 스탬프 갱신.
 * 방 목록에서 방을 열 때·해당 방에 새 메시지 도착 시(방 열려있으면) 호출.
 */
export async function markGmConversationReadForGm(
  conversationId: string
): Promise<{ ok: boolean }> {
  const { error } = await supabase.rpc(
    "mark_gm_conversation_read_gm",
    { p_conversation_id: conversationId }
  );
  if (error) {
    console.error("[markGmConversationReadForGm] failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}