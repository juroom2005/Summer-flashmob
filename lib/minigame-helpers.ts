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
      // 결과 (즉시 화면에 반영할 최종 값)
      nextMobil:         number;
      nextExpressionExp: number;
      nextPhysicalExp:   number;
      mobilGained:       number;
      expressionGained:  number;
      physicalGained:    number;
      playsToday:        number;
      playsRemaining:    number;
      // 세부 breakdown (영수증 항목별 표시용)
      difficulty:            number; // 1|2|3
      mobilBase:             number;
      mobilDifficultyBonus:  number;
      mobilPerfectBonus:     number;
      expressionBase:        number;
      expressionBonus:       number;
      physicalBase:          number;
      physicalBonus:         number;
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
    difficulty:            Number(row.difficulty ?? 1),
    mobilBase:             Number(row.mobil_base ?? 0),
    mobilDifficultyBonus:  Number(row.mobil_difficulty_bonus ?? 0),
    mobilPerfectBonus:     Number(row.mobil_perfect_bonus ?? 0),
    expressionBase:        Number(row.expression_base ?? 0),
    expressionBonus:       Number(row.expression_bonus ?? 0),
    physicalBase:          Number(row.physical_base ?? 0),
    physicalBonus:         Number(row.physical_bonus ?? 0),
  };
}

/* ═══════════════════════════════════════════════════════════
 * 연습실알바 (세션 L)
 *
 * 카페 함수와 대칭. 완전 별도 RPC (play_practice_minigame).
 * 카페 코드는 이 섹션에서 절대 참조하지 않는다.
 *
 * 스탯 차이 :
 *   · 카페      : 주 스탯 = expression (표현력)
 *   · 연습실    : 주 스탯 = rhythm     (리듬감)
 *   · 부가 스탯 : 양쪽 모두 physical
 *
 * getTodayMinigameStatus 는 카테고리 무관 (카페 + 연습실 통합 카운트) 이므로
 * 이 섹션에서 별도 정의하지 않고 카페 섹션의 것을 그대로 재사용한다.
 * normalizePlayError · PLAY_ERROR_MESSAGES 도 재사용 (같은 예외 문자열).
 * ─────────────────────────────────────────────────────────── */

// 연습실 미니게임 code (seed 와 일치)
export type PracticeMinigameCode =
  | "practice_clean"
  | "practice_stock"
  | "practice_setup";

// 완주 결과 (play_practice_minigame 반환)
export type PracticePlayResult =
  | {
      ok: true;
      // 결과 (즉시 화면에 반영할 최종 값)
      nextMobil:      number;
      nextRhythmExp:  number;
      nextPhysicalExp:number;
      mobilGained:    number;
      rhythmGained:   number;
      physicalGained: number;
      playsToday:     number;
      playsRemaining: number;
      // 세부 breakdown (영수증 항목별 표시용)
      difficulty:            number; // 1|2|3
      mobilBase:             number;
      mobilDifficultyBonus:  number;
      mobilPerfectBonus:     number;
      rhythmBase:            number;
      rhythmBonus:           number;
      physicalBase:          number;
      physicalBonus:         number;
    }
  | { ok: false; reason: string; message: string };

/**
 * 연습실 미니게임 마스터 3종 조회.
 * RLS minigames_select_all 로 누구나 조회 가능.
 * is_active=true 만 · code 오름차순.
 */
export async function listPracticeMinigames(): Promise<MinigameRow[]> {
  const { data, error } = await supabase
    .from("minigames")
    .select(
      "id, code, name, category, subtype, target_stat, base_stat_gain, base_mobil_gain, is_active, metadata"
    )
    .eq("category", "practice_room")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error || !data) {
    console.error("[listPracticeMinigames] failed:", error?.message);
    return [];
  }
  return data as MinigameRow[];
}

/**
 * 연습실 미니게임 완주 결과 제출. RPC play_practice_minigame 호출.
 *
 * 서버 처리 (RPC 참고, 카페와 대칭) :
 *   · 인증 · 미니게임 활성 · score 범위 · 카테고리 검증 ('practice_room')
 *   · profiles FOR UPDATE 로 유저 단위 직렬화
 *   · 하루 3회 검증 (카페 + 연습실 통합 카운트, 락 획득 후)
 *   · mobil 구간표 지급 + 100점 퍼펙트 보너스
 *     - practice_clean 은 축소 스케일 (별 1 밸런스, 카페 설거지와 동일)
 *   · 리듬감 exp +5 · 체력 exp +8 (450 상한 clamp)
 *   · minigame_plays 이력 저장 (target_stat='rhythm')
 *
 * 성공 시 window "profile-changed" 이벤트 발행 → 헤더 mobil · 스탯 재조회.
 *
 * @param code          연습실 미니게임 code
 * @param score         0~100 정수 점수
 * @param resultDetail  게임별 결과 상세. 선택.
 */
export async function playPracticeMinigame(
  code: PracticeMinigameCode,
  score: number,
  resultDetail: Record<string, unknown> = {}
): Promise<PracticePlayResult> {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));

  const { data, error } = await supabase.rpc("play_practice_minigame", {
    p_minigame_code: code,
    p_score:         safeScore,
    p_result_detail: resultDetail,
  });

  if (error) {
    console.error("[playPracticeMinigame] failed:", error.message);
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
    nextMobil:      Number(row.next_mobil ?? 0),
    nextRhythmExp:  Number(row.next_rhythm_exp ?? 0),
    nextPhysicalExp:Number(row.next_physical_exp ?? 0),
    mobilGained:    Number(row.mobil_gained ?? 0),
    rhythmGained:   Number(row.rhythm_gained ?? 0),
    physicalGained: Number(row.physical_gained ?? 0),
    playsToday:     Number(row.plays_today ?? 0),
    playsRemaining: Number(row.plays_remaining ?? 0),
    difficulty:            Number(row.difficulty ?? 1),
    mobilBase:             Number(row.mobil_base ?? 0),
    mobilDifficultyBonus:  Number(row.mobil_difficulty_bonus ?? 0),
    mobilPerfectBonus:     Number(row.mobil_perfect_bonus ?? 0),
    rhythmBase:            Number(row.rhythm_base ?? 0),
    rhythmBonus:           Number(row.rhythm_bonus ?? 0),
    physicalBase:          Number(row.physical_base ?? 0),
    physicalBonus:         Number(row.physical_bonus ?? 0),
  };
}

/* ═══════════════════════════════════════════════════════════
 * 리듬게임 (세션 M)
 *
 * 카페 · 연습실과 완전 별도 RPC (play_rhythm_minigame).
 * 카페 · 연습실 코드는 이 섹션에서 절대 참조하지 않는다.
 *
 * 근본 차이 (알바와의 트레이드) :
 *   · mobil 지급 없음 (알바는 mobil 위주)
 *   · 선택 스탯 대량 상승 (18~30, 알바의 3~5배)
 *   · 시작 전 스탯 선택 (리듬감 / 표현력) → 선택한 스탯만 상승
 *   · 체력 exp 부가 (7~12)
 *
 * getTodayMinigameStatus 는 카테고리 무관 통합 카운트이므로 재사용.
 * normalizePlayError · PLAY_ERROR_MESSAGES 도 재사용 (같은 예외 문자열).
 * 단 리듬 고유 예외 (invalid_selected_stat) 는 아래에서 추가 매핑.
 * ─────────────────────────────────────────────────────────── */

// 리듬게임 code (seed 와 일치)
export type RhythmMinigameCode = "rhythm";

// 선택 스탯 (시작 전 UI 선택)
export type RhythmSelectedStat = "rhythm" | "expression";

// 리듬게임 고유 예외 메시지 (카페 매핑에 없는 것만 추가)
const RHYTHM_EXTRA_ERROR_MESSAGES: Record<string, string> = {
  invalid_selected_stat: "성장시킬 스탯을 올바르게 선택해 주십시오.",
};

function normalizeRhythmError(message: string | undefined): {
  reason:  string;
  message: string;
} {
  const raw = (message ?? "").trim();
  // 리듬 고유 예외 먼저 확인
  for (const code of Object.keys(RHYTHM_EXTRA_ERROR_MESSAGES)) {
    if (raw.includes(code)) {
      return { reason: code, message: RHYTHM_EXTRA_ERROR_MESSAGES[code] };
    }
  }
  // 공통 예외는 카페 매핑 재사용
  return normalizePlayError(message);
}

// 완주 결과 (play_rhythm_minigame 반환)
export type RhythmPlayResult =
  | {
      ok: true;
      nextMobil:            number; // 변경 없음 (정보용)
      nextSelectedStatExp:  number; // 선택 스탯 (리듬감 또는 표현력) 지급 후 exp
      nextPhysicalExp:      number;
      mobilGained:          number; // 항상 0
      selectedStat:         RhythmSelectedStat;
      selectedStatGained:   number; // 18~30
      physicalGained:       number; // 7~12
      playsToday:           number;
      playsRemaining:       number;
      // 세부 breakdown (영수증 항목별 표시용)
      difficulty:           number; // 항상 3
      selectedStatBase:     number;
      selectedStatRangeMin: number;
      selectedStatRangeMax: number;
      physicalBase:         number;
    }
  | { ok: false; reason: string; message: string };

/**
 * 리듬게임 마스터 조회 (초안은 단일 row).
 * RLS minigames_select_all 로 누구나 조회 가능.
 * is_active=true 만.
 */
export async function listRhythmMinigames(): Promise<MinigameRow[]> {
  const { data, error } = await supabase
    .from("minigames")
    .select(
      "id, code, name, category, subtype, target_stat, base_stat_gain, base_mobil_gain, is_active, metadata"
    )
    .eq("category", "rhythm_game")
    .eq("is_active", true)
    .order("code", { ascending: true });

  if (error || !data) {
    console.error("[listRhythmMinigames] failed:", error?.message);
    return [];
  }
  return data as MinigameRow[];
}

/**
 * 리듬게임 완주 결과 제출. RPC play_rhythm_minigame 호출.
 *
 * 서버 처리 (RPC 참고) :
 *   · 인증 · 미니게임 활성 · score 범위 · 선택 스탯 · 카테고리 검증
 *   · profiles FOR UPDATE 로 유저 단위 직렬화
 *   · 하루 3회 검증 (카페 + 연습실 + 리듬 통합 카운트)
 *   · 점수 구간표로 선택 스탯 exp (18~30) · 체력 exp (7~12) 산정
 *   · 선택 스탯 컬럼만 UPDATE (rhythm_exp 또는 expression_exp), mobil 무변경
 *   · minigame_plays 이력 저장 (target_stat = 선택값, mobil_gained=0)
 *
 * 성공 시 window "profile-changed" 이벤트 발행 → 헤더 · 스탯 재조회.
 *
 * @param code          리듬 미니게임 code ("rhythm")
 * @param score         0~100 정수 점수
 * @param selectedStat  시작 전 선택한 스탯 ("rhythm" | "expression")
 * @param resultDetail  게임별 결과 상세 (판정 카운트 · 콤보 등). 선택.
 */
export async function playRhythmMinigame(
  code: RhythmMinigameCode,
  score: number,
  selectedStat: RhythmSelectedStat,
  resultDetail: Record<string, unknown> = {}
): Promise<RhythmPlayResult> {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));

  const { data, error } = await supabase.rpc("play_rhythm_minigame", {
    p_minigame_code: code,
    p_score:         safeScore,
    p_selected_stat: selectedStat,
    p_result_detail: resultDetail,
  });

  if (error) {
    console.error("[playRhythmMinigame] failed:", error.message);
    return { ok: false, ...normalizeRhythmError(error.message) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return {
      ok: false,
      reason: "empty_result",
      message: "처리 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주십시오.",
    };
  }

  // 프로필 변경 알림 브로드캐스트 (mobil 은 안 바뀌지만 스탯 exp 갱신됨)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("profile-changed"));
  }

  // selected_stat 은 'rhythm' | 'expression' 만 서버가 반환하지만 방어적 캐스팅
  const rawSelected = String(row.selected_stat ?? selectedStat);
  const safeSelected: RhythmSelectedStat =
    rawSelected === "expression" ? "expression" : "rhythm";

  return {
    ok: true,
    nextMobil:            Number(row.next_mobil ?? 0),
    nextSelectedStatExp:  Number(row.next_selected_stat_exp ?? 0),
    nextPhysicalExp:      Number(row.next_physical_exp ?? 0),
    mobilGained:          Number(row.mobil_gained ?? 0),
    selectedStat:         safeSelected,
    selectedStatGained:   Number(row.selected_stat_gained ?? 0),
    physicalGained:       Number(row.physical_gained ?? 0),
    playsToday:           Number(row.plays_today ?? 0),
    playsRemaining:       Number(row.plays_remaining ?? 0),
    difficulty:           Number(row.difficulty ?? 3),
    selectedStatBase:     Number(row.selected_stat_base ?? 0),
    selectedStatRangeMin: Number(row.selected_stat_range_min ?? 0),
    selectedStatRangeMax: Number(row.selected_stat_range_max ?? 0),
    physicalBase:         Number(row.physical_base ?? 0),
  };
}