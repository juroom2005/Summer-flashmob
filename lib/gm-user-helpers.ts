// lib/gm-user-helpers.ts
//
// GM 유저 관리 데이터 접근 헬퍼.
//
// 스키마: sql/2026-07-20_gm_user_admin.sql
//   · profiles.deactivated_at 컬럼
//   · RPC 7개 (assert_caller_is_gm 포함)
// Edge Function: gm-delete-user (완전 삭제 전용, service_role 필요)
//
// 스탯 개편 반영 (v8 §2-4, §4-1):
//   · profiles.*_stat (0~100) → *_exp (0~450) + *_level (0~5, DB GENERATED)
//   · gm_list_users / gm_adjust_user_stats RPC 시그니처 재정의됨
//     → sql/applied/2026-07-24_stat_level_gm_rpcs.sql
//   · RPC 파라미터명은 유지 (p_rhythm_delta 등). "스탯 종류" 를 가리키므로
//     이름 변경 불필요.
//   · StatDeltas.rhythm 등도 동일한 이유로 필드명 유지.
//
// 방침:
//   · profiles UPDATE RLS는 확대하지 않음 → 모든 수정은 RPC 경유
//   · RPC는 예외를 던지므로, 여기서 잡아서 { ok, reason } 형태로 정규화
//     (호출부가 try/catch 없이 분기할 수 있게)
//   · 조회 실패는 빈 배열 반환 (목록이 안 뜨는 편이 잘못 뜨는 것보다 안전)
//
// mobil 지급 주의:
//   · 절대값 덮어쓰기 없음. 반드시 증감(delta) + mobil_grants 이력 기록
//   · granted_by 는 EF/RPC 내부에서 auth.uid() 로 자동 기록 (호출부 관여 불필요)

import { supabase } from "./supabase";
import { callEdgeFunction } from "./ef-client";

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

export type GmUserRow = {
  id:               string;
  user_id:          string | null;
  email:            string | null;
  family_name:      string | null;
  given_name:       string | null;
  age:              number | null;
  gender:           "male" | "female" | "other" | null;
  school_name:      string | null;
  grade:            number | null;

  // 스탯 : exp (누적 경험치) + level (DB GENERATED)
  // 전부 NOT NULL. level 은 GENERATED STORED 라 exp 와 항상 정합.
  rhythm_exp:       number;
  rhythm_level:     number;
  physical_exp:     number;
  physical_level:   number;
  expression_exp:   number;
  expression_level: number;

  mobil:            number;
  is_gm:            boolean;
  /** user_id가 있으면 가입 완료, 없으면 shell(초대만 발급된 상태) */
  is_registered:    boolean;
  /** NULL이면 활성, 값이 있으면 비활성 시각 */
  deactivated_at:   string | null;
  created_at:       string;
};

/** RPC 호출 결과 정규화 형태. */
export type RpcResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; reason: string; message: string };

/** RPC 에러 코드 → 한국어 안내 문구. */
const RPC_ERROR_MESSAGES: Record<string, string> = {
  auth_required:        "로그인이 필요합니다.",
  gm_only:              "GM 권한이 필요합니다.",
  profile_not_found:    "대상 유저를 찾을 수 없습니다.",
  invalid_profile_id:   "유저 식별자가 올바르지 않습니다.",
  invalid_age:          "나이는 1에서 150 사이여야 합니다.",
  invalid_gender:       "성별 값이 올바르지 않습니다.",
  invalid_grade:        "학년은 1에서 3 사이여야 합니다.",
  invalid_family_name:  "성을 입력해주십시오.",
  invalid_given_name:   "이름을 입력해주십시오.",
  invalid_amount:       "지급 수량이 올바르지 않습니다.",
  insufficient_mobil:   "차감 후 잔액이 음수가 됩니다.",
  cannot_deactivate_gm: "GM 계정은 비활성화할 수 없습니다.",
  invalid_avatar_data:  "이미지 형식이 올바르지 않습니다.",
};

/**
 * Postgres 예외 메시지에서 RAISE EXCEPTION 코드를 추출.
 * supabase-js는 error.message에 예외 메시지를 그대로 담아준다.
 */
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


/* ═══════════════════════════════════════════════════════════
 * 조회
 * ─────────────────────────────────────────────────────────── */

/**
 * GM용 유저 목록 조회.
 *
 * @param includeInactive  true면 비활성 유저도 포함
 *
 * 정렬: GM 우선 → created_at DESC
 * shell profile(미가입)도 포함되며 is_registered=false 로 구분.
 * 실패 시 빈 배열.
 */
export async function listGmUsers(
  includeInactive: boolean
): Promise<GmUserRow[]> {
  const { data, error } = await supabase.rpc("gm_list_users", {
    p_include_inactive: includeInactive,
  });

  if (error) {
    console.error("[listGmUsers] failed:", error.message);
    return [];
  }
  return (data as GmUserRow[] | null) ?? [];
}


/* ═══════════════════════════════════════════════════════════
 * 기본 정보 수정
 * ─────────────────────────────────────────────────────────── */

export type GmProfilePatch = {
  family_name?: string;
  given_name?:  string;
  age?:         number;
  gender?:      "male" | "female" | "other";
  school_name?: string;
  grade?:       number;
};

/**
 * 기본 정보 수정.
 *
 * 넘기지 않은 필드(undefined)는 변경되지 않음.
 * RPC 내부에서 COALESCE로 처리되므로 부분 수정 가능.
 *
 * 수정 대상 밖:
 *   · is_gm            — protect_is_gm_column 트리거가 차단
 *   · mobil            — grantMobil() 사용
 *   · 스탯 3종         — adjustGmUserStats() 사용
 *   · 학생증 커스텀     — 본인 소관, GM 수정 대상 아님
 */
export async function updateGmUserProfile(
  profileId: string,
  patch:     GmProfilePatch
): Promise<RpcResult> {
  const { error } = await supabase.rpc("gm_update_user_profile", {
    p_profile_id:  profileId,
    p_family_name: patch.family_name ?? null,
    p_given_name:  patch.given_name  ?? null,
    p_age:         patch.age         ?? null,
    p_gender:      patch.gender      ?? null,
    p_school_name: patch.school_name ?? null,
    p_grade:       patch.grade       ?? null,
  });

  if (error) {
    const n = normalizeRpcError(error.message);
    console.error("[updateGmUserProfile] failed:", error.message);
    return { ok: false, ...n };
  }
 return { ok: true, data: undefined };
}


/* ═══════════════════════════════════════════════════════════
 * 학생증 두상 이미지 (GM 이 넣어줌)
 * ─────────────────────────────────────────────────────────── */

/**
 * 대상 유저의 학생증 두상(avatar) 조회.
 *
 * gm_list_users 반환에 avatar_url 을 넣지 않고 별도 단건 조회로 격리한 이유:
 *   - 목록 RPC 시그니처(RETURNS TABLE) 변경은 파급이 크고 위험.
 *   - 두상은 dataURL 이라 용량이 커, 목록 전체에 실으면 목록 조회가 무거워짐.
 * 관리 UI 가 유저를 선택했을 때만 이 함수로 현재 두상을 불러온다.
 *
 * 반환:
 *   · 두상 있으면 dataURL(또는 URL) 문자열
 *   · 미설정이면 null
 *   · 조회 실패면 null (미리보기라 조용히 없음 처리가 안전)
 */
export async function getGmUserAvatar(
  profileId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("gm_get_user_avatar", {
    p_profile_id: profileId,
  });

  if (error) {
    console.error("[getGmUserAvatar] failed:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * 대상 유저의 학생증 두상(avatar) 설정/삭제.
 *
 * @param avatarUrl  dataURL(또는 http URL) 문자열. null 이면 두상 삭제.
 *
 * - GM 전용 RPC(gm_set_user_avatar, SECURITY DEFINER)로 남의 행을 UPDATE.
 *   (본인 UPDATE RLS 로는 남의 프로필을 못 건드리므로 RPC 경유가 필수)
 * - 형식은 서버(RPC·컬럼 CHECK)와 클라 양쪽에서 방어. 여기서도 명백히
 *   이상한 값은 호출 전에 걸러 불필요한 왕복/오염을 예방.
 * - 대용량 방지를 위한 리사이즈·압축은 호출부(업로드 UI)에서 수행한다.
 */
export async function setGmUserAvatar(
  profileId: string,
  avatarUrl: string | null
): Promise<RpcResult> {
  if (
    avatarUrl !== null &&
    !avatarUrl.startsWith("data:image/") &&
    !avatarUrl.startsWith("http")
  ) {
    return {
      ok:      false,
      reason:  "invalid_avatar_data",
      message: RPC_ERROR_MESSAGES.invalid_avatar_data,
    };
  }

  const { error } = await supabase.rpc("gm_set_user_avatar", {
    p_profile_id: profileId,
    p_avatar_url: avatarUrl,
  });

  if (error) {
    const n = normalizeRpcError(error.message);
    console.error("[setGmUserAvatar] failed:", error.message);
    return { ok: false, ...n };
  }
  return { ok: true, data: undefined };
}


/* ═══════════════════════════════════════════════════════════
 * 스탯 조정 (증감)
 * ─────────────────────────────────────────────────────────── */
/**
 * 스탯 증감 델타.
 * 필드명은 "스탯 종류" 를 가리키므로 유지. 실제 값은 exp 델타이다.
 */
export type StatDeltas = {
  rhythm?:     number;
  physical?:   number;
  expression?: number;
};

/**
 * 스탯 조정 결과.
 * DB 가 UPDATE 후 반환한 최종 exp + level. level 은 DB GENERATED 라 정합 보장.
 */
export type StatResult = {
  rhythm_exp:       number;
  rhythm_level:     number;
  physical_exp:     number;
  physical_level:   number;
  expression_exp:   number;
  expression_level: number;
};

/**
 * 스탯 증감. 결과값은 서버에서 0~450으로 클램프됨.
 *
 * 절대값 지정이 아니라 증감 방식인 이유:
 *   · 동시 편집 시 덮어쓰기 사고 회피
 *   · UI가 델타 버튼(-100/-10/+10/+100 등) 이라 자연스러움
 *
 * 반환 data에 조정 후 최종 스탯 6개 필드(exp + level 쌍 × 3)가 담김
 * → 낙관적 UI 없이 서버값으로 반영. level 재계산 불필요.
 */
export async function adjustGmUserStats(
  profileId: string,
  deltas:    StatDeltas
): Promise<RpcResult<StatResult>> {
  const { data, error } = await supabase.rpc("gm_adjust_user_stats", {
    p_profile_id:       profileId,
    p_rhythm_delta:     deltas.rhythm     ?? 0,
    p_physical_delta:   deltas.physical   ?? 0,
    p_expression_delta: deltas.expression ?? 0,
  });

  if (error) {
    const n = normalizeRpcError(error.message);
    console.error("[adjustGmUserStats] failed:", error.message);
    return { ok: false, ...n };
  }

  // RETURNS TABLE 이라 배열로 옴
  const rows = (data as StatResult[] | null) ?? [];
  const row  = rows[0];
  if (!row) {
    return {
      ok:      false,
      reason:  "unknown",
      message: "조정 결과를 확인하지 못하였습니다.",
    };
  }
  return { ok: true, data: row };
}


/* ═══════════════════════════════════════════════════════════
 * mobil 지급 / 차감
 * ─────────────────────────────────────────────────────────── */

/**
 * mobil 증감 + mobil_grants 이력 자동 기록.
 *
 * @param amount  0이 아닌 정수. 음수면 차감.
 * @param note    지급 사유 메모 (선택)
 *
 * 서버 처리:
 *   · FOR UPDATE 행 잠금 → 동시 지급 경합 차단
 *   · 차감 결과가 음수면 거부 (insufficient_mobil)
 *   · grant_type='gm_grant', granted_by=auth.uid() 자동 기록
 *
 * 반환 data는 조정 후 최종 잔액.
 */
export async function grantGmMobil(
  profileId: string,
  amount:    number,
  note?:     string
): Promise<RpcResult<number>> {
  if (!Number.isInteger(amount) || amount === 0) {
    return {
      ok:      false,
      reason:  "invalid_amount",
      message: RPC_ERROR_MESSAGES.invalid_amount,
    };
  }

  const { data, error } = await supabase.rpc("gm_grant_mobil", {
    p_profile_id: profileId,
    p_amount:     amount,
    p_note:       note?.trim() ? note.trim() : null,
  });

  if (error) {
    const n = normalizeRpcError(error.message);
    console.error("[grantGmMobil] failed:", error.message);
    return { ok: false, ...n };
  }

  return { ok: true, data: (data as number) ?? 0 };
}


/* ═══════════════════════════════════════════════════════════
 * 비활성화 / 복구 (보수적 삭제)
 * ─────────────────────────────────────────────────────────── */

/**
 * 유저 비활성화. 데이터는 전부 보존되며 노출에서만 제외.
 * 되돌리기 가능(reactivateGmUser).
 * GM 계정은 비활성화 불가.
 */
export async function deactivateGmUser(
  profileId: string
): Promise<RpcResult> {
  const { error } = await supabase.rpc("gm_deactivate_user", {
    p_profile_id: profileId,
  });

  if (error) {
    const n = normalizeRpcError(error.message);
    console.error("[deactivateGmUser] failed:", error.message);
    return { ok: false, ...n };
  }
  return { ok: true, data: undefined };
}

/** 비활성화된 유저 복구. */
export async function reactivateGmUser(
  profileId: string
): Promise<RpcResult> {
  const { error } = await supabase.rpc("gm_reactivate_user", {
    p_profile_id: profileId,
  });

  if (error) {
    const n = normalizeRpcError(error.message);
    console.error("[reactivateGmUser] failed:", error.message);
    return { ok: false, ...n };
  }
  return { ok: true, data: undefined };
}


/* ═══════════════════════════════════════════════════════════
 * 완전 삭제 (Edge Function: gm-delete-user)
 * ─────────────────────────────────────────────────────────── */

/** dry_run 응답: 삭제 시 영향 범위. */
export type DeletePreview = {
  dry_run: true;
  target: {
    profile_id:    string;
    user_id:       string | null;
    display_name:  string;
    is_registered: boolean;
  };
  will_delete:    Record<string, number>;
  will_anonymize: Record<string, number>;
};

/** 실삭제 응답. */
export type DeleteResult = {
  dry_run: false;
  success: true;
  target: {
    profile_id:    string;
    user_id:       string | null;
    display_name:  string;
    is_registered: boolean;
  };
  deleted:    Record<string, number>;
  anonymized: Record<string, number>;
};

/**
 * 완전 삭제 미리보기.
 * 실제로 지우지 않고 영향 범위만 집계해 반환.
 *
 * UI 흐름 권장: 미리보기 → 사용자 확인 → 실삭제
 */
export async function previewGmUserDeletion(
  profileId: string
): Promise<RpcResult<DeletePreview>> {
  const res = await callEdgeFunction<DeletePreview>("gm-delete-user", {
    target_profile_id: profileId,
    dry_run:           true,
  });

  if (!res.ok) {
    return {
      ok:      false,
      reason:  `http_${res.status}`,
      message: res.error,
    };
  }
  return { ok: true, data: res.data };
}

/**
 * 완전 삭제 실행.
 *
 * 되돌릴 수 없음. 호출 전 반드시 previewGmUserDeletion 결과를 사용자에게 보여줄 것.
 *
 * 처리 내용:
 *   · 가입 유저  → auth 계정 삭제 → profiles CASCADE 연쇄
 *   · shell 유저 → profiles 직접 삭제 → CASCADE 연쇄
 *
 * 함께 사라지는 것: 초대코드·인벤토리·뱃지·미니게임 기록·스티커·상점 구매 이력·
 *                  mobil 지급 이력·GM 채팅방 전체(메시지 포함)
 */
export async function deleteGmUserPermanently(
  profileId: string
): Promise<RpcResult<DeleteResult>> {
  const res = await callEdgeFunction<DeleteResult>("gm-delete-user", {
    target_profile_id: profileId,
    dry_run:           false,
  });

  if (!res.ok) {
    return {
      ok:      false,
      reason:  `http_${res.status}`,
      message: res.error,
    };
  }
  return { ok: true, data: res.data };
}

/* ═══════════════════════════════════════════════════════════
 * 미니게임 (GM 관리)
 * ─────────────────────────────────────────────────────────── */

export type GmMinigameHistoryRow = {
  id:            string;
  minigame_code: string;
  minigame_name: string;
  score:         number;
  stat_gained:   number;
  mobil_gained:  number;
  target_stat:   "rhythm" | "physical" | "expression" | null;
  played_at:     string;
  result_detail: Record<string, unknown> | null;
};

export type GmMinigameTodayResult = {
  playsToday:     number;
  dailyLimit:     number;
  playsRemaining: number;
  playDate:       string;
  history:        GmMinigameHistoryRow[];
};

/**
 * 대상 유저의 오늘(KST) 미니게임 완주 이력 조회.
 * GM 만 호출 가능.
 *
 * 실패 시 정규화된 RpcResult 반환.
 */
export async function getGmUserMinigameToday(
  profileId: string
): Promise<RpcResult<GmMinigameTodayResult>> {
  const { data, error } = await supabase.rpc("gm_get_user_minigame_today", {
    p_profile_id: profileId,
  });

  if (error) {
    const n = normalizeRpcError(error.message);
    console.error("[getGmUserMinigameToday] failed:", error.message);
    return { ok: false, ...n };
  }

  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  const row  = rows[0];
  if (!row) {
    return {
      ok:      false,
      reason:  "unknown",
      message: "조회 결과를 확인하지 못하였습니다.",
    };
  }

  return {
    ok: true,
    data: {
      playsToday:     Number(row.plays_today ?? 0),
      dailyLimit:     Number(row.daily_limit ?? 3),
      playsRemaining: Number(row.plays_remaining ?? 0),
      playDate:       String(row.play_date ?? ""),
      history:        (row.history as GmMinigameHistoryRow[] | null) ?? [],
    },
  };
}

export type GmMinigameResetResult = {
  deletedCount: number;
  playDate:     string;
};

/**
 * 대상 유저의 오늘(KST) 미니게임 완주 이력 리셋 (전부 삭제).
 * GM 만 호출 가능.
 *
 * 주의 :
 *   · 이미 지급된 mobil/exp 는 되돌리지 않는다. 회수 필요 시 스탯/모빌
 *     조정 패널로 별도 처리.
 *   · 이 함수는 "오늘 카운트만 리셋" 하는 역할.
 *
 * 실패 시 정규화된 RpcResult 반환.
 */
export async function resetGmUserMinigameToday(
  profileId: string
): Promise<RpcResult<GmMinigameResetResult>> {
  const { data, error } = await supabase.rpc("gm_reset_user_minigame_today", {
    p_profile_id: profileId,
  });

  if (error) {
    const n = normalizeRpcError(error.message);
    console.error("[resetGmUserMinigameToday] failed:", error.message);
    return { ok: false, ...n };
  }

  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  const row  = rows[0];
  if (!row) {
    return {
      ok:      false,
      reason:  "unknown",
      message: "리셋 결과를 확인하지 못하였습니다.",
    };
  }

  return {
    ok: true,
    data: {
      deletedCount: Number(row.deleted_count ?? 0),
      playDate:     String(row.play_date ?? ""),
    },
  };
}