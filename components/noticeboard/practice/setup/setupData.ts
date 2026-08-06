// components/noticeboard/practice/setup/setupData.ts
// ═══════════════════════════════════════════════════════════════════
// 연습실 장비 세팅 (practice_setup) — 사운드 웨이브 매칭
// ═══════════════════════════════════════════════════════════════════
//
// 순수 데이터/로직만 담는다 (React 의존 없음).
//
// 게임 방식 (별 3, 잠금 없는 완전 자유 조정 방식) :
//   · Fader 4개 고정 (5종 중 랜덤 4개, 매판 조합 다름)
//   · 각 fader 0~100 범위, 목표값 표시 없음 (숫자 힌트 X)
//   · 잠금 시스템 없음 — 유저는 계속 자유롭게 조정 가능
//   · 스코프 안 목표 웨이브 (희미한 흰 선) 만이 유일한 힌트
//     - 유저 웨이브 (파랑) 를 그 위에 겹치도록 노브 조작
//     - 모든 노브 오차 ≤ PERFECT_TOLERANCE (2) 시 웨이브 녹색 변화 (완벽 매칭 표시)
//   · 유저가 "완료" 버튼 클릭 → 즉시 채점
//   · 시간 초과 (40초) → 자동 채점 (지금까지 상태)
//
// 채점 (오차 평균 기반 · 시간 곱셈) :
//   · avgError    = mean(|target - current|)                (각 노브 오차 평균)
//   · accuracyRaw = clamp(0, 100, 100 - round(avgError))    (0~100)
//   · timeMult    = TIME_MIN_MULT ~ TIME_MAX_MULT (시간 배율)
//   · finalScore  = round(accuracyRaw × timeMult)
//
//   완주 (모든 노브 정확) + 매우 빠름 → 100 (퍼펙트)
//   완주 + 시간 초과 → 50 (accuracy 100 × 0.5)
//   부분 완주 (오차 평균 15) + 여유 → 85 × 0.8 = 68
//   전혀 조정 안 함 → accuracy 는 낮으나 0 아님 (초기값에 따라 다름)

/* ═══════════════════════════════════════════════════════════
 * 상수
 * ─────────────────────────────────────────────────────────── */

export const TIME_LIMIT_SEC   = 40;

// 시간 배율 (곱셈 채점) : finalScore = accuracyRaw × timeMultiplier
export const TIME_MIN_MULT    = 0.5;   // 5초 이하 남으면 배율 최소 (완주해도 절반)
export const TIME_MAX_MULT    = 1.0;   // 25초 이상 남으면 배율 최대 (15초 안 완주)
export const TIME_FLOOR_SEC   = 5;
export const TIME_CEIL_SEC    = 25;

// Fader 개수 : 4 고정
export const FADER_COUNT      = 4;

// 목표값 범위 · 초기값과 목표값 최소 차이
export const TARGET_MIN         = 10;
export const TARGET_MAX         = 90;
export const INITIAL_OFFSET_MIN = 20;

// 웨이브 녹색 판정 : 모든 노브 오차가 이 값 이하면 완벽 매칭 (스코프 웨이브 녹색)
export const PERFECT_TOLERANCE = 2;

/* ═══════════════════════════════════════════════════════════
 * Fader 종류
 * ─────────────────────────────────────────────────────────── */

export type FaderKey = "gain" | "freq" | "phase" | "q" | "cut";

export const FADER_LABEL: Record<FaderKey, string> = {
  gain:  "GAIN",
  freq:  "FREQ",
  phase: "PHASE",
  q:     "Q",
  cut:   "CUT",
};

/**
 * Fader 값 (0~100) → 실제 웨이브 파라미터 매핑 범위.
 */
export const PARAM_MAPPING: Record<
  FaderKey,
  { min: number; max: number; def: number }
> = {
  gain:  { min: 0.3, max: 1.4,           def: 1.0 },
  freq:  { min: 1.0, max: 4.0,           def: 2.0 },
  phase: { min: 0.0, max: 2 * Math.PI,   def: 0.0 },
  q:     { min: 0.0, max: 0.5,           def: 0.0 },
  cut:   { min: 2.0, max: 6.0,           def: 3.0 },
};

export const FADER_KEYS: FaderKey[] = ["gain", "freq", "phase", "q", "cut"];

/* ═══════════════════════════════════════════════════════════
 * 타입
 *
 * · locked 필드 없음 (잠금 개념 제거)
 * · isPerfect 는 컴퓨티드 (오차 ≤ PERFECT_TOLERANCE) — 상태 아님
 * ─────────────────────────────────────────────────────────── */

export type Fader = {
  id:      string;
  key:     FaderKey;
  target:  number;
  current: number;
};

export type WaveParams = {
  gain:  number;
  freq:  number;
  phase: number;
  q:     number;
  cut:   number;
};

/* ═══════════════════════════════════════════════════════════
 * Fader 생성
 * ─────────────────────────────────────────────────────────── */

function shuffled<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * 4 fader 랜덤 생성 (5종 중 중복 없이 4개 선택).
 * 목표값 10~90, 초기값 목표와 최소 20 이상 차이.
 */
export function generateFaders(): Fader[] {
  const chosen = shuffled(FADER_KEYS).slice(0, FADER_COUNT);

  return chosen.map((key: FaderKey, i: number) => {
    const target = TARGET_MIN + Math.floor(Math.random() * (TARGET_MAX - TARGET_MIN + 1));

    const lowEnd    = target - INITIAL_OFFSET_MIN;
    const highStart = target + INITIAL_OFFSET_MIN;
    const lowSize   = Math.max(0, lowEnd + 1);
    const highSize  = Math.max(0, 100 - highStart + 1);
    let current: number;
    if (lowSize + highSize === 0) {
      current = target < 50 ? 100 : 0;
    } else {
      const pick = Math.floor(Math.random() * (lowSize + highSize));
      current = pick < lowSize ? pick : highStart + (pick - lowSize);
    }

    return {
      id:      `fader_${i}`,
      key,
      target,
      current,
    };
  });
}

/* ═══════════════════════════════════════════════════════════
 * Fader 값 갱신 (잠금 없음, 항상 자유롭게 조정 가능)
 * ─────────────────────────────────────────────────────────── */

export function updateFader(
  faders: Fader[],
  id: string,
  newValue: number,
): Fader[] {
  const clamped = Math.max(0, Math.min(100, Math.round(newValue)));
  return faders.map((f: Fader) => {
    if (f.id !== id) return f;
    return { ...f, current: clamped };
  });
}

/* ═══════════════════════════════════════════════════════════
 * 웨이브 파라미터 계산
 * ─────────────────────────────────────────────────────────── */

function faderToParam(key: FaderKey, value: number): number {
  const m = PARAM_MAPPING[key];
  const rel = Math.max(0, Math.min(100, value)) / 100;
  return m.min + rel * (m.max - m.min);
}

export function faderToWaveParams(faders: Fader[], useTarget: boolean = false): WaveParams {
  const result: WaveParams = {
    gain:  PARAM_MAPPING.gain.def,
    freq:  PARAM_MAPPING.freq.def,
    phase: PARAM_MAPPING.phase.def,
    q:     PARAM_MAPPING.q.def,
    cut:   PARAM_MAPPING.cut.def,
  };
  faders.forEach((f: Fader) => {
    const v = useTarget ? f.target : f.current;
    result[f.key] = faderToParam(f.key, v);
  });
  return result;
}

export function evaluateWave(params: WaveParams, t: number): number {
  const primary   = Math.sin(params.freq * t + params.phase);
  const secondary = params.q * Math.sin(params.cut * params.freq * t + params.phase);
  return params.gain * (primary + secondary);
}

export function wavePath(
  params: WaveParams,
  width: number,
  height: number,
  samples: number = 100,
): string {
  const midY   = height / 2;
  const scale  = height / 3.2;
  const pts: string[] = [];

  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * 2 * Math.PI;
    const x = (i / samples) * width;
    const val = evaluateWave(params, t);
    let y = midY - val * scale;
    if (y < 4)          y = 4;
    if (y > height - 4) y = height - 4;
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

/* ═══════════════════════════════════════════════════════════
 * 완벽 매칭 판정 (웨이브 녹색 시각 힌트용)
 *
 * 채점 · 자동 종료와 무관.
 * ─────────────────────────────────────────────────────────── */

export function isAllPerfect(faders: Fader[]): boolean {
  return (
    faders.length > 0 &&
    faders.every((f: Fader) => Math.abs(f.target - f.current) <= PERFECT_TOLERANCE)
  );
}

/* ═══════════════════════════════════════════════════════════
 * 채점 (오차 평균 · 시간 곱셈)
 * ─────────────────────────────────────────────────────────── */

export type SetupFinalScore = {
  finalScore:     number;  // 0~100
  accuracyScore:  number;  // 0~100 (100 - avgError)
  avgError:       number;  // 각 노브 오차 평균 (0 ~ 100)
  timeBonus:      number;  // 시간 덕분에 얻은 추가 점수 (최소 배율 대비)
  perfectCount:   number;  // 오차 ≤ PERFECT_TOLERANCE 인 노브 개수 (참고용)
  totalCount:     number;
};

/**
 * 최종 점수 계산.
 *
 * 1) 각 fader 오차 : errors[i] = |target - current|
 * 2) avgError = mean(errors)
 * 3) accuracyRaw = clamp(0, 100, 100 - round(avgError))
 * 4) timeMultiplier (시간 배율) :
 *      · remainingSec ≤ TIME_FLOOR_SEC (5)  → TIME_MIN_MULT (0.5)
 *      · remainingSec ≥ TIME_CEIL_SEC (30)  → TIME_MAX_MULT (1.0)
 *      · 그 사이 → 선형 보간
 * 5) finalScore = clamp(0, 100, round(accuracyRaw × timeMultiplier))
 *
 * 시뮬레이션 (fader 4개 기준) :
 *   모두 완벽 (오차 0) + 30초+ 남김 → 100 × 1.0 = 100 (퍼펙트)
 *   모두 완벽 + 20초 남김           → 100 × 0.8 = 80
 *   모두 완벽 + 시간 초과            → 100 × 0.5 = 50 (완주 최소)
 *   평균 오차 5 + 여유              → 95  × 0.8 = 76
 *   평균 오차 20 + 여유             → 80  × 0.8 = 64
 *   평균 오차 50 + 시간 초과         → 50  × 0.5 = 25
 */
export function calculateFinalScore(
  faders: Fader[],
  remainingSec: number,
): SetupFinalScore {
  const totalCount = faders.length;

  const errors = faders.map((f: Fader) => Math.abs(f.target - f.current));
  const avgError = totalCount === 0
    ? 0
    : errors.reduce((sum: number, e: number) => sum + e, 0) / totalCount;
  const perfectCount = errors.filter((e: number) => e <= PERFECT_TOLERANCE).length;

  const accuracyRaw = Math.max(0, Math.min(100, Math.round(100 - avgError)));

  // 시간 배율
  const remainClamped = Math.max(0, Math.min(TIME_LIMIT_SEC, remainingSec));
  let timeMultiplier: number;
  if (remainClamped <= TIME_FLOOR_SEC) {
    timeMultiplier = TIME_MIN_MULT;
  } else if (remainClamped >= TIME_CEIL_SEC) {
    timeMultiplier = TIME_MAX_MULT;
  } else {
    const range   = TIME_CEIL_SEC - TIME_FLOOR_SEC;
    const inRange = remainClamped - TIME_FLOOR_SEC;
    const t       = inRange / range;
    timeMultiplier = TIME_MIN_MULT + t * (TIME_MAX_MULT - TIME_MIN_MULT);
  }

  const finalScoreRaw = Math.round(accuracyRaw * timeMultiplier);
  const finalScore    = Math.max(0, Math.min(100, finalScoreRaw));

  const baseline = Math.round(accuracyRaw * TIME_MIN_MULT);
  const timeBonus = Math.max(0, finalScore - baseline);

  return {
    finalScore,
    accuracyScore: accuracyRaw,
    avgError:      Math.round(avgError * 10) / 10,   // 소수 첫째 자리
    timeBonus,
    perfectCount,
    totalCount,
  };
}