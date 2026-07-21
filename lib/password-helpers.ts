// lib/password-helpers.ts
//
// 비밀번호 재설정 · 변경 관련 헬퍼.
//
// 두 축:
//   1) GM이 남의 비번을 재설정 (resetGmUserPassword) — EF 경유
//      · 잊어버린 유저를 위한 유일한 복구 경로 (이메일 인증 없음)
//   2) 유저 본인이 자기 비번을 변경 (changeMyPassword) — supabase-js 경유
//      · 마이패널 계정 관리 섹션에서 사용
//      · 강제 변경 팝업에서도 재사용
//
// 플래그 처리:
//   · GM 재설정 시 → password_reset_required = true (EF가 처리)
//   · 유저 본인 변경 시 → password_reset_required = false (본 파일이 처리)
//     (이미 false 인 상태에서 자발적으로 바꿔도 무해)

import { supabase } from "./supabase";
import { callEdgeFunction } from "./ef-client";
import { getCurrentUser } from "./auth-helpers";

/* ═══════════════════════════════════════════════════════════
 * GM 재설정 (EF: gm-reset-user-password)
 * ─────────────────────────────────────────────────────────── */

export type GmPasswordResetResult =
  | {
      ok: true;
      tempPassword: string;
      displayName:  string;
    }
  | {
      ok: false;
      message: string;
    };

/**
 * GM 이 특정 유저의 비번을 임시 비번으로 재설정.
 *
 * 서버 처리 (EF 참고):
 *   · GM 검증 → 12자리 랜덤 비번 생성 → auth 비번 교체
 *   · profiles.password_reset_required = true
 *
 * 반환:
 *   · ok=true 시 tempPassword 는 서버가 방금 생성한 값. 이 응답으로만 확인 가능
 *     (서버에 별도 저장 없음, 재조회 불가).
 *   · GM 은 이 값을 유저에게 전달해야 함.
 *
 * 실패 조건 (EF 응답 코드 → 사용자 메시지):
 *   · 400 shell 대상 / GM 대상 / 자기 자신
 *   · 403 GM 아님
 *   · 404 대상 없음
 *   · 500 기타
 */
export async function resetGmUserPassword(
  profileId: string
): Promise<GmPasswordResetResult> {
  const res = await callEdgeFunction<{
    success:       boolean;
    target:        { profile_id: string; display_name: string };
    temp_password: string;
  }>("gm-reset-user-password", { target_profile_id: profileId });

  if (!res.ok) {
    return { ok: false, message: res.error };
  }

  // 부분 실패(플래그 세팅 실패) 시에도 EF 가 temp_password 를 함께 반환하도록 설계됨.
  // callEdgeFunction 은 500 응답을 실패로 처리하므로, 이 케이스는 res.ok=false 로 옴.
  // 다만 res.error 문구에서 파악할 수 있도록 EF 가 안내 문구를 담아줌.

  return {
    ok:           true,
    tempPassword: res.data.temp_password,
    displayName:  res.data.target.display_name,
  };
}


/* ═══════════════════════════════════════════════════════════
 * 유저 본인 비번 변경
 * ─────────────────────────────────────────────────────────── */

export type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      reason:  "not_authenticated" | "wrong_current" | "too_short" | "same_as_current" | "update_failed" | "flag_clear_failed";
      message: string;
    };

/** Supabase auth 최소 비번 길이. 앱 정책상 최소 8자 권장. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * 유저 본인이 자기 비번을 변경.
 *
 * 흐름:
 *   1) 세션 존재 확인
 *   2) 현재 비번 재검증 (signInWithPassword 로 확인)
 *      · 세션은 이미 인증됐지만, 임시 비번 상태·오래된 세션에서 오조작 방지
 *   3) 새 비번 유효성 (길이, 현재와 다름)
 *   4) supabase.auth.updateUser({ password }) 로 교체
 *   5) profiles.password_reset_required = false (자기 행이라 RLS 통과)
 *
 * 실패 시 auth 비번은 이미 바뀌었을 수 있음 → 마지막 flag_clear_failed 케이스는
 * 유저에게 "비번은 바뀌었으나 플래그 해제에 실패, 로그아웃 후 다시 시도"로 안내.
 */
export async function changeMyPassword(
  currentPassword: string,
  newPassword:     string
): Promise<ChangePasswordResult> {
  const user = await getCurrentUser();
  if (!user?.email) {
    return {
      ok:      false,
      reason:  "not_authenticated",
      message: "로그인이 필요합니다.",
    };
  }

  /* 1) 새 비번 유효성 */
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok:      false,
      reason:  "too_short",
      message: `새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`,
    };
  }
  if (newPassword === currentPassword) {
    return {
      ok:      false,
      reason:  "same_as_current",
      message: "새 비밀번호가 현재 비밀번호와 같습니다.",
    };
  }

  /* 2) 현재 비번 재검증 */
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email:    user.email,
    password: currentPassword,
  });

  if (verifyErr) {
    return {
      ok:      false,
      reason:  "wrong_current",
      message: "현재 비밀번호가 올바르지 않습니다.",
    };
  }

  /* 3) 비번 교체 */
  const { error: updErr } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (updErr) {
    return {
      ok:      false,
      reason:  "update_failed",
      message: "비밀번호 변경에 실패하였습니다. 잠시 후 다시 시도해주십시오.",
    };
  }

  /* 4) 플래그 해제 (자기 행, RLS profiles_update_own 으로 허용) */
  const { error: flagErr } = await supabase
    .from("profiles")
    .update({ password_reset_required: false })
    .eq("user_id", user.id);

  if (flagErr) {
    console.error("[changeMyPassword] flag clear failed:", flagErr.message);
    return {
      ok:      false,
      reason:  "flag_clear_failed",
      message:
        "비밀번호는 변경되었으나 상태 갱신에 실패하였습니다. " +
        "로그아웃 후 다시 로그인해주시면 정상 처리됩니다.",
    };
  }

  return { ok: true };
}


/* ═══════════════════════════════════════════════════════════
 * 플래그 조회
 * ─────────────────────────────────────────────────────────── */

/**
 * 현재 유저의 password_reset_required 플래그 조회.
 *
 * 팝업·배너 렌더 여부 판정에 사용.
 * 미로그인·오류 시 false 반환 (안전 기본값 — 팝업이 잘못 뜨는 것보다 안 뜨는 게 안전).
 */
export async function getMyPasswordResetRequired(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("password_reset_required")
    .eq("user_id", user.id)
    .maybeSingle<{ password_reset_required: boolean }>();

  if (error || !data) return false;
  return data.password_reset_required === true;
}