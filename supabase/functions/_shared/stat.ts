// supabase/functions/_shared/stat.ts
// ═══════════════════════════════════════════════════════════════════
// EF 공유 : 스탯 레벨 유틸리티 (미니 버전)
// ═══════════════════════════════════════════════════════════════════
//
// lib/stat-helpers.ts 의 서버측 파트만 옮긴 파일이다.
// EF (Deno 런타임) 는 브라우저 코드인 lib/ 를 직접 import 할 수 없으므로
// 필요한 상수·함수만 여기로 복제.
//
// 동기화 원칙 :
//   · LEVEL_THRESHOLDS · LEVEL_MAX · EXP_MAX · INITIAL_LEVEL_BUDGET 4 개 상수는
//     lib/stat-helpers.ts 와 정확히 같은 값을 유지해야 한다.
//   · SQL 마이그레이션 (GENERATED 컬럼의 CASE) 과도 정합해야 한다.
//   · 구간표를 바꾸려면 세 곳 (SQL · lib · 이 파일) 을 모두 함께 수정.
//
// 이 파일이 담지 않는 것 :
//   · UI 관련 상수 (STAT_META · 색상 · 레벨 명칭) — 서버는 필요 없음
//   · getLevelProgress · staminaFactor · performanceTotal · getLevelName —
//     UI 표시용이라 EF 에서 쓸 일 없음. 필요해지면 그때 추가.
// ═══════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────
// 스탯 종류
// ────────────────────────────────────────────────────────────────────
export type StatKey = "rhythm" | "physical" | "expression";

// ────────────────────────────────────────────────────────────────────
// 구간 경계값 (lib/stat-helpers.ts 와 sync)
//
//   index 0 = Lv0 최소 exp = 0
//   index 1 = Lv1 최소 exp = 30
//   ...
//   index 5 = Lv5 최소 exp = 450
// ────────────────────────────────────────────────────────────────────
export const LEVEL_THRESHOLDS = [0, 30, 80, 160, 280, 450] as const;
export const LEVEL_MAX = 5;
export const EXP_MAX   = 450;

// 초기 배분 총합 상한. 세 스탯 초기 레벨의 합이 이 값을 넘을 수 없다.
export const INITIAL_LEVEL_BUDGET = 5;

// ────────────────────────────────────────────────────────────────────
// exp -> level 변환
//
// DB GENERATED 컬럼의 CASE 문과 동일한 결과. 상한 초과 값이 들어와도
// 안전하게 LEVEL_MAX 로 클램프.
// ────────────────────────────────────────────────────────────────────
export function expToLevel(exp: number): number {
  const n = Number.isFinite(exp) ? Math.floor(exp) : 0;
  if (n >= LEVEL_THRESHOLDS[5]) return 5;
  if (n >= LEVEL_THRESHOLDS[4]) return 4;
  if (n >= LEVEL_THRESHOLDS[3]) return 3;
  if (n >= LEVEL_THRESHOLDS[2]) return 2;
  if (n >= LEVEL_THRESHOLDS[1]) return 1;
  return 0;
}

// ────────────────────────────────────────────────────────────────────
// level -> 그 레벨의 최소 exp
//
// 초대 발급 시 레벨 입력을 exp 로 환산할 때 사용.
// 범위 밖 입력은 클램프 후 반환.
// ────────────────────────────────────────────────────────────────────
export function levelToMinExp(level: number): number {
  const n = Number.isFinite(level) ? Math.floor(level) : 0;
  const clamped = Math.max(0, Math.min(LEVEL_MAX, n));
  return LEVEL_THRESHOLDS[clamped];
}

// ────────────────────────────────────────────────────────────────────
// 초기 레벨 배분 검증
//
// 초대 발급 시 세 스탯 초기 레벨 합이 INITIAL_LEVEL_BUDGET(5) 이하 여야 한다.
// 각 스탯은 0~5 정수여야 한다.
//
// EF 진입 지점에서 5 포인트 초과를 방어. RPC 는 이중 검증하지 않는다.
// ────────────────────────────────────────────────────────────────────
export type LevelDistribution = {
  rhythm:     number;
  physical:   number;
  expression: number;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateInitialLevelDistribution(
  input: LevelDistribution,
): ValidationResult {
  const entries: [string, number][] = [
    ["rhythm",     input.rhythm],
    ["physical",   input.physical],
    ["expression", input.expression],
  ];

  for (const [key, v] of entries) {
    if (!Number.isInteger(v)) {
      return { ok: false, reason: `${key} 레벨은 정수여야 합니다.` };
    }
    if (v < 0 || v > LEVEL_MAX) {
      return { ok: false, reason: `${key} 레벨은 0 이상 ${LEVEL_MAX} 이하여야 합니다.` };
    }
  }

  const sum = input.rhythm + input.physical + input.expression;
  if (sum > INITIAL_LEVEL_BUDGET) {
    return {
      ok: false,
      reason: `초기 레벨 합은 ${INITIAL_LEVEL_BUDGET} 이하여야 합니다. (현재 ${sum})`,
    };
  }

  return { ok: true };
}