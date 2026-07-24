// lib/stat-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// 스탯 레벨 시스템 유틸리티
// ═══════════════════════════════════════════════════════════════════
//
// v8 §2-4 확정 기획 반영. 스탯은 세 종류 (리듬감·체력·표현력) 이며
// 각각 exp 누적(0~450) 으로 저장되고 level(0~5) 이 파생된다.
//
// 이 파일이 담는 것 :
//   - 구간 경계값 상수
//   - 스탯 메타 정보 (표시명 · 레벨별 명칭)
//   - exp <-> level 변환
//   - 구간 진행률 계산
//   - 체력계수 · 실질 스탯 · 종합 퍼포먼스 계산
//   - 5 포인트 초기 배분 검증
//
// 이 파일이 담지 않는 것 :
//   - 유리병 색상 · 무지개 렌더 등 UI 시각 요소
//     (사용처 컴포넌트 내부에 둔다. 예: MyPanel)
//
// DB 와의 동기화 :
//   sql/applied/2026-07-24_stat_level_migration.sql 의 GENERATED 컬럼
//   CASE 문이 이 파일의 LEVEL_THRESHOLDS 와 정확히 같은 결과를 내야 한다.
//   구간표를 바꾸려면 반드시 SQL 마이그레이션 + 이 상수 두 곳을 함께 갱신.
// ═══════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────
// 스탯 종류
// ────────────────────────────────────────────────────────────────────
export type StatKey = "rhythm" | "physical" | "expression";

export const STAT_KEYS: readonly StatKey[] = [
  "rhythm",
  "physical",
  "expression",
] as const;

// ────────────────────────────────────────────────────────────────────
// 구간 경계값
//
//   index 0 = Lv0 의 최소 exp = 0
//   index 1 = Lv1 의 최소 exp = 30
//   ...
//   index 5 = Lv5 의 최소 exp = 450
//
// LEVEL_MAX = 5 는 최상위 레벨. exp 상한도 450 이며 그 이상은 DB CHECK 로 컷.
// ────────────────────────────────────────────────────────────────────
export const LEVEL_THRESHOLDS = [0, 30, 80, 160, 280, 450] as const;
export const LEVEL_MAX = 5;
export const EXP_MAX   = 450;

// 초기 배분 총합 상한 (v8 §2-4).
// 초대 발급 시 세 스탯의 초기 레벨 합이 이 값을 초과할 수 없다.
export const INITIAL_LEVEL_BUDGET = 5;

// ────────────────────────────────────────────────────────────────────
// 스탯 메타 정보
//
// label       : UI 노출 표시명
// levelNames  : Lv0 ~ Lv5 명칭 (index = level).
//               초기값은 v8 §2-4 표 기준. 추후 GM 관리 탭에서 편집 가능하게
//               DB 이관 예정 (§3-4, §4-2).
// ────────────────────────────────────────────────────────────────────
type StatMeta = {
  label:      string;
  levelNames: readonly [string, string, string, string, string, string];
};

export const STAT_META: Readonly<Record<StatKey, StatMeta>> = {
  rhythm: {
    label:      "리듬감",
    levelNames: [
      "박치",
      "박자는 안다",
      "몸이 반응함",
      "리듬을 탄다",
      "비트의 지배자",
      "음악 그 자체",
    ],
  },
  physical: {
    label:      "체력",
    levelNames: [
      "병약",
      "평범한 체력",
      "단련된 몸",
      "지치지 않는",
      "강철 체력",
      "무한 동력",
    ],
  },
  expression: {
    label:      "표현력",
    levelNames: [
      "무표정",
      "어색한 미소",
      "감정이 보인다",
      "시선을 끄는",
      "무대를 삼키는",
      "카리스마",
    ],
  },
} as const;

// ────────────────────────────────────────────────────────────────────
// exp -> level 변환
//
// DB 의 GENERATED 컬럼 CASE 문과 동일한 결과를 내야 한다.
// 상한 초과 값이 들어와도 안전하게 LEVEL_MAX 로 클램프.
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
// 초대 발급 시 GM 이 레벨을 입력하면 이 값으로 exp 를 세팅한다.
// 범위 밖 입력은 안전하게 클램프 후 반환.
// ────────────────────────────────────────────────────────────────────
export function levelToMinExp(level: number): number {
  const n = Number.isFinite(level) ? Math.floor(level) : 0;
  const clamped = Math.max(0, Math.min(LEVEL_MAX, n));
  return LEVEL_THRESHOLDS[clamped];
}

// ────────────────────────────────────────────────────────────────────
// 다음 레벨의 최소 exp
//
// 최상위 레벨(5) 이면 자기 자신을 반환. UI 표시용.
// ────────────────────────────────────────────────────────────────────
export function nextLevelMinExp(level: number): number {
  const n = Math.max(0, Math.min(LEVEL_MAX, Math.floor(level)));
  if (n >= LEVEL_MAX) return LEVEL_THRESHOLDS[LEVEL_MAX];
  return LEVEL_THRESHOLDS[n + 1];
}

// ────────────────────────────────────────────────────────────────────
// 구간 진행률 (0.0 ~ 1.0)
//
// 현재 exp 가 현 레벨 구간 내에서 어디쯤인지.
// 최상위 레벨(5) 이면 항상 1.0. 유리병 UI 높이 계산 등에서 사용.
// ────────────────────────────────────────────────────────────────────
export type LevelProgress = {
  level:       number;   // 현재 레벨
  currentExp:  number;   // 현재 누적 exp
  levelMinExp: number;   // 현 레벨 구간 시작 exp
  nextMinExp:  number;   // 다음 레벨 시작 exp (최상위면 자기 자신)
  gained:      number;   // 이 구간에서 얻은 exp (currentExp - levelMinExp)
  needed:      number;   // 이 구간 전체 폭 (nextMinExp - levelMinExp)
  ratio:       number;   // 0.0 ~ 1.0. 최상위 레벨이면 1.0
  toNext:      number;   // 다음 레벨까지 남은 exp. 최상위면 0
};

export function getLevelProgress(exp: number): LevelProgress {
  const currentExp  = Math.max(0, Math.min(EXP_MAX, Math.floor(Number.isFinite(exp) ? exp : 0)));
  const level       = expToLevel(currentExp);
  const levelMinExp = LEVEL_THRESHOLDS[level];
  const nextMinExp  = nextLevelMinExp(level);
  const gained      = currentExp - levelMinExp;
  const needed      = nextMinExp - levelMinExp;
  const ratio       = level >= LEVEL_MAX ? 1 : (needed > 0 ? gained / needed : 0);
  const toNext      = level >= LEVEL_MAX ? 0 : Math.max(0, nextMinExp - currentExp);

  return { level, currentExp, levelMinExp, nextMinExp, gained, needed, ratio, toNext };
}

// ────────────────────────────────────────────────────────────────────
// 체력계수
//
//   계수 = 0.5 + 0.1 × 체력레벨
//   Lv0 = 0.5 ... Lv5 = 1.0
//
// 소수 부동소수점 오차 방지를 위해 정수 계산 후 나눗셈.
// ────────────────────────────────────────────────────────────────────
export function staminaFactor(physicalLevel: number): number {
  const lv = Math.max(0, Math.min(LEVEL_MAX, Math.floor(physicalLevel)));
  return (5 + lv) / 10;
}

// ────────────────────────────────────────────────────────────────────
// 실질 스탯 (표시용 · 정수 반올림)
//
//   실질 = 대상 레벨 × 체력계수
//
// 예 : 리듬 Lv4, 체력 Lv3 → 4 × 0.8 = 3.2 → 3
// ────────────────────────────────────────────────────────────────────
export function effectiveStat(targetLevel: number, physicalLevel: number): number {
  const lv     = Math.max(0, Math.min(LEVEL_MAX, Math.floor(targetLevel)));
  const factor = staminaFactor(physicalLevel);
  return Math.round(lv * factor);
}

// ────────────────────────────────────────────────────────────────────
// 종합 퍼포먼스 (0 ~ 100 점, 정수 반올림)
//
//   종합 = (리듬레벨 + 표현레벨) × 체력계수 × 10
//
// 최대치 : (5+5) × 1.0 × 10 = 100
// 최소치 : (0+0) × 0.5 × 10 = 0
// ────────────────────────────────────────────────────────────────────
export function performanceTotal(
  rhythmLevel:     number,
  expressionLevel: number,
  physicalLevel:   number,
): number {
  const r = Math.max(0, Math.min(LEVEL_MAX, Math.floor(rhythmLevel)));
  const e = Math.max(0, Math.min(LEVEL_MAX, Math.floor(expressionLevel)));
  return Math.round((r + e) * staminaFactor(physicalLevel) * 10);
}

// ────────────────────────────────────────────────────────────────────
// 초기 레벨 배분 검증
//
// 초대 발급 시 세 스탯의 초기 레벨 합이 INITIAL_LEVEL_BUDGET(5) 이하 여야 한다.
// 각 스탯은 0~5 정수여야 한다.
//
// 서버(EF · RPC) 와 클라이언트(GM 초대 폼) 양쪽에서 사용.
// 서버 검증이 최종 방어선이지만 UI 에서도 미리 검증해 사용자 경험을 개선한다.
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
  const { rhythm, physical, expression } = input;

  for (const [key, v] of Object.entries(input) as [string, number][]) {
    if (!Number.isInteger(v)) {
      return { ok: false, reason: `${key} 레벨은 정수여야 합니다.` };
    }
    if (v < 0 || v > LEVEL_MAX) {
      return { ok: false, reason: `${key} 레벨은 0 이상 ${LEVEL_MAX} 이하여야 합니다.` };
    }
  }

  const sum = rhythm + physical + expression;
  if (sum > INITIAL_LEVEL_BUDGET) {
    return {
      ok: false,
      reason: `초기 레벨 합은 ${INITIAL_LEVEL_BUDGET} 이하여야 합니다. (현재 ${sum})`,
    };
  }

  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────
// 레벨 명칭 조회 헬퍼
//
// 안전 조회. 범위 밖이면 마지막/처음 이름으로 폴백.
// ────────────────────────────────────────────────────────────────────
export function getLevelName(stat: StatKey, level: number): string {
  const names = STAT_META[stat].levelNames;
  const clamped = Math.max(0, Math.min(LEVEL_MAX, Math.floor(level)));
  return names[clamped];
}