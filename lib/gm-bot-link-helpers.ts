// lib/gm-bot-link-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// GM용 봇 계정 연동(bot_account_links) 관리 헬퍼
// ═══════════════════════════════════════════════════════════════════
//
// 매핑을 GM 화면에서 조회/설정/해제한다. 실제 권한 검사·처리는 서버 RPC
// (gm_get_bot_link / gm_set_bot_link / gm_delete_bot_link)가 담당하고,
// 여기서는 호출과 결과 정규화만 한다. (gm-user-helpers.ts 와 동일 패턴)
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

/** RPC 호출 결과 정규화 형태. (gm-user-helpers 와 동일) */
export type RpcResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; reason: string; message: string };

/** RPC 에러 코드 → 한국어 안내. */
const RPC_ERROR_MESSAGES: Record<string, string> = {
  auth_required:        "로그인이 필요합니다.",
  gm_only:              "GM 권한이 필요합니다.",
  profile_not_found:    "대상 유저를 찾을 수 없습니다.",
  invalid_mastodon_id:  "마스토돈 계정 ID는 숫자만 입력해주십시오.",
  mastodon_id_taken:    "이 마스토돈 계정은 이미 다른 유저와 연동되어 있습니다.",
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

// ── 조회 ───────────────────────────────────────────────────────────

export type BotLink = {
  profileId:          string;
  mastodonAccountId:  string;
  mastodonAcct:       string | null;
  updatedAt:          string;
};

/**
 * 유저의 현재 봇 매핑 조회.
 * 매핑 없으면 data = null. 실패는 ok:false.
 */
export async function getGmBotLink(
  profileId: string,
): Promise<RpcResult<BotLink | null>> {
  const { data, error } = await supabase.rpc("gm_get_bot_link", {
    p_profile_id: profileId,
  });
  if (error) {
    return { ok: false, ...normalizeRpcError(error.message) };
  }
  const rows = (data ?? []) as Array<{
    profile_id: string;
    mastodon_account_id: string;
    mastodon_acct: string | null;
    updated_at: string;
  }>;
  const row = rows[0];
  if (!row) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      profileId:         row.profile_id,
      mastodonAccountId: row.mastodon_account_id,
      mastodonAcct:      row.mastodon_acct,
      updatedAt:         row.updated_at,
    },
  };
}

// ── 설정 (UPSERT) ──────────────────────────────────────────────────

/**
 * 유저 ↔ 마스토돈 계정 매핑 설정(있으면 갱신).
 * @param mastodonAccountId 마스토돈 계정 id(숫자 문자열)
 * @param mastodonAcct      참고용 acct(선택)
 */
export async function setGmBotLink(
  profileId: string,
  mastodonAccountId: string,
  mastodonAcct?: string,
): Promise<RpcResult> {
  const { error } = await supabase.rpc("gm_set_bot_link", {
    p_profile_id:          profileId,
    p_mastodon_account_id: mastodonAccountId,
    p_mastodon_acct:       mastodonAcct && mastodonAcct.trim() !== "" ? mastodonAcct.trim() : null,
  });
  if (error) {
    return { ok: false, ...normalizeRpcError(error.message) };
  }
  return { ok: true, data: undefined };
}

// ── 해제 ───────────────────────────────────────────────────────────

export async function deleteGmBotLink(
  profileId: string,
): Promise<RpcResult> {
  const { error } = await supabase.rpc("gm_delete_bot_link", {
    p_profile_id: profileId,
  });
  if (error) {
    return { ok: false, ...normalizeRpcError(error.message) };
  }
  return { ok: true, data: undefined };
}
