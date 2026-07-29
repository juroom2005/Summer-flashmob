// lib/minigame-helpers.ts
//
// 미니게임 (카페알바) 상태 조회 · 결과 제출 헬퍼.
//
// 스키마 · RPC:
//   · sql/applied/2026-07-29_minigame_cafe_seed.sql  (minigames row 3종)
//   · sql/applied/2026-07-29_minigame_cafe_rpcs.sql
//       - get_today_minigame_status()          : 오늘 소진/잔여 · 전역 활성
//       - play_cafe_minigame(code, score, jsonb): 완주 결과 제출 · 보상 지급
//
// 방침:
//   · 완주 성공 시 window.dispatchEvent("profile-changed") 로 알림
//     → useCurrentUser 등이 리슨하여 mobil · exp 재조회
//   · 예외는 catch 후 { ok:false, reason, message } 로 정규화
//     → 호출부가 try/catch 없이 분기 가능
//   · 하루 카운트 검증 · 보상 계산 · exp 상한 clamp 는 모두 RPC (서버) 가 담당.
//     클라이언트는 score (0~100) 와 result_detail 만 넘긴다.
//
// 주의:
//   · 이 헬퍼는 "완주" 결과만 제출한다. 중도 이탈은 아무 호출도 하지 않으므로
//     카운트가 차감되지 않는다 (세션 J 확정 방침).

import { supabase } from "./supabase";

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

// 카페 미니게임 code (seed 와 일치)
export type CafeMinigameCode = "cafe_order" | "cafe_mix" | "cafe_dish";

// minigames 마스터 row (조회용)
export type MinigameRow = {
  id:            string;
  code:          string;
  name:          string;
  category:      string;
  subtype:       string;
  target_stat:   "rhythm" | "physical" | "expression" | null;
  base_stat_gain:  number;
  base_mobil_gain: number;
  is_active:     boolean;
  metadata:      Record<string, unknown>;
};

// 오늘 상태 (get_today_minigame_status 반환)
export type TodayMinigameStatus = {
  playsToday:      number;
  playsRemaining:  number;
  dailyLimit:      number;
  minigameEnabled: boolean;
};

// 완주 결과 (play_cafe_minigame 반환)
export type PlayResult =
  | {
      ok: true;
      nextMobil:         number;
      nextExpressionExp: number;
      nextPhysicalExp:   number;
      mobilGained:       number;
      expressionGained:  number;
      physicalGained:    number;
      playsToday:        number;
      playsRemaining:    number;
    }
  | { ok: false; reason: string; message: string };

/* ═══════════════════════════════════════════════════════════
 * 에러 매핑
 * ─────────────────────────────────────────────────────────── */

const PLAY_ERROR_MESSAGES: Record<string, string> = {
  auth_required:        "로그인이 필요합니다.",
  profile_not_found:    "프로필 정보를 확인할 수 없습니다.",
  minigame_disabled:    "미니게임이 점검 중입니다. 잠시 후 다시 시도해 주십시오.",
  minigame_not_found:   "미니게임을 찾을 수 없습니다.",
  minigame_inactive:    "현재 이용할 수 없는 미니게임입니다.",
  invalid_category:     "미니게임 종류가 올바르지 않습니다.",
  invalid_score:        "점수 값이 올바르지 않습니다.",
  daily_limit_exceeded: "오늘 이용 가능한 횟수를 모두 사용하셨습니다.",
};

function normalizePlayError(message: string | undefined): {
  reason:  string;
  message: string;
} {
  const raw = (message ?? "").trim();
  for (const code of Object.keys(PLAY_ERROR_MESSAGES)) {
    if (raw.includes(code)) {
      return { reason: code, message: PLAY_ERROR_MESSAGES[code] };
    }
  }
  return {
    reason:  "unknown",
    message: "처리 중 오류가 발생하였습니다. 잠시 후 다시 시도해 주십시오.",
  };
}

/* ═══════════════════════════════════════════════════════════
 * 조회
 * ─────────────────────────────────────────────────────────── */

/**
 * 오늘 소진 · 남은 횟수 · 미니게임 전역 활성 상태 조회.
 * RPC get_today_minigame_status 호출.
 *
 * 실패 시 안전 기본값 반환 (진입 자체는 되도록, 단 남은 횟수 0 · 비활성 취급).
 * 로그인 안 된 상태에서 호출되면 auth_required 예외 → null 반환.
 */
export async function getTodayMinigameStatus(): Promise<TodayMinigameStatus | null> {
  const { data, error } = await supabase.rpc("get_today_minigame_status");

  if (error) {
    console.error("[getTodayMinigameStatus] failed:", error.message);
    return null;
  }

  // RETURNS TABLE → 배열로 옴. 첫 행 사용.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    playsToday:      Number(row.plays_today ?? 0),
    playsRemaining:  Number(row.plays_remaining ?? 0),
    dailyLimit:      Number(row.daily_limit ?? 3),
    minigameEnabled: row.minigame_enabled === true,
  };
}

/**
 * 카페 미니게임 마스터 3종 조회.
 * RLS minigames_select_all 로 누구나 조회 가능.
 * is_active=true 만 · code 오름차순.
 */
export async function listCafeMinigames(): Promise<MinigameRow[]> {
  const { data, error } = await supabase
    .from("minigames")
    .select(
      "id, code, name, category, subtype, target_stat, base_stat_gain, base_mobil_gain, is_active, metadata"
    )
    .eq("category", "cafe")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error || !data) {
    console.error("[listCafeMinigames] failed:", error?.message);
    return [];
  }
  return data as MinigameRow[];
}

/* ═══════════════════════════════════════════════════════════
 * 결과 제출
 * ─────────────────────────────────────────────────────────── */

/**
 * 카페 미니게임 완주 결과 제출. RPC play_cafe_minigame 호출.
 *
 * 서버 처리 (RPC 참고):
 *   · 인증 · 미니게임 활성 · score 범위 · 카테고리 검증
 *   · profiles FOR UPDATE 로 유저 단위 직렬화
 *   · 하루 3회 검증 (락 획득 후)
 *   · mobil 구간표 지급 + 100점 퍼펙트 보너스
 *   · 표현 exp +5 · 체력 exp +8 (450 상한 clamp)
 *   · minigame_plays 이력 저장
 *
 * 성공 시 window "profile-changed" 이벤트 발행 → 헤더 mobil · 스탯 재조회.
 *
 * @param code          카페 미니게임 code
 * @param score         0~100 정수 점수
 * @param resultDetail  게임별 결과 상세 (미스 수 · 레이어 순서 등). 선택.
 */
export async function playCafeMinigame(
  code: CafeMinigameCode,
  score: number,
  resultDetail: Record<string, unknown> = {}
): Promise<PlayResult> {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));

  const { data, error } = await supabase.rpc("play_cafe_minigame", {
    p_minigame_code: code,
    p_score:         safeScore,
    p_result_detail: resultDetail,
  });

  if (error) {
    console.error("[playCafeMinigame] failed:", error.message);
    return { ok: false, ...normalizePlayError(error.message) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return {
      ok: false,
      reason: "empty_result",
      message: "처리 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주십시오.",
    };
  }

  // 프로필 변경 알림 브로드캐스트 (mobil · exp 재조회 유도)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("profile-changed"));
  }

  return {
    ok: true,
    nextMobil:         Number(row.next_mobil ?? 0),
    nextExpressionExp: Number(row.next_expression_exp ?? 0),
    nextPhysicalExp:   Number(row.next_physical_exp ?? 0),
    mobilGained:       Number(row.mobil_gained ?? 0),
    expressionGained:  Number(row.expression_gained ?? 0),
    physicalGained:    Number(row.physical_gained ?? 0),
    playsToday:        Number(row.plays_today ?? 0),
    playsRemaining:    Number(row.plays_remaining ?? 0),
  };
}
