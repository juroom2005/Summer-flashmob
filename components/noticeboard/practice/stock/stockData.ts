// components/noticeboard/practice/stock/stockData.ts
// ═══════════════════════════════════════════════════════════════════
// 연습실 재고 정리 (practice_stock) — 슬롯 생성 · 드롭 판정 · 채점
// ═══════════════════════════════════════════════════════════════════
//
// 순수 데이터/로직만 담는다 (React 의존 없음).
// PracticeStockGame 은 이 모듈을 호출해 슬롯을 생성·판정·채점한다.
//
// 게임 방식 (세션 L 별 2, 카페 mix 대칭) :
//   · 창고 : 5종 박스 (📄 악보 · 🎤 마이크 · 🎧 헤드폰 · 💧 물병 · 🧻 수건)
//     항상 창고 자리에 있음. 유저가 클릭하면 박스 하나 뽑아서 드래그.
//   · 선반 : 3~5개 슬롯, 각 슬롯에 지시 품목·목표 수량 표시.
//   · 유저는 창고에서 박스를 뽑아 정확한 슬롯에 드롭.
//   · 옳은 슬롯 + 아직 도달 안 함 → 카운트 +1
//   · 잘못된 슬롯 · 초과 슬롯 · 바깥 드롭 → 박스 사라짐 (감점 없음)
//   · 모든 슬롯 목표 도달 → 조기 종료 · 채점
//   · 시간 초과 → 채점 (지금까지 상태로)
//
// 채점 (RPC 인터페이스 무변경, result_detail 필드명만 다름) :
//   · accuracyScore = round(전체 currentQty 합 / 전체 targetQty 합 × 100)
//   · timeBonus     = 0~10, 빡빡한 구간 (5~15초)
//   · finalScore    = min(100, accuracyScore + timeBonus)
//   · 별 2 · 난이도 가산 +400 · 리듬감 +1 (RPC 자동 처리)

/* ═══════════════════════════════════════════════════════════
 * 상수
 * ─────────────────────────────────────────────────────────── */

export const TIME_LIMIT_SEC       = 30;
export const TIME_BONUS_MAX       = 20;
// 빡빡한 시간 보너스 구간 : 20초 이상 남겨야 (= 10초 안 완주) 만점
export const TIME_BONUS_FLOOR_SEC = 5;   // 이하면 보너스 0
export const TIME_BONUS_CEIL_SEC  = 20;  // 이상이면 만점

// 정확도 가중치 : accuracyRaw × ACCURACY_WEIGHT 만큼만 최종 점수에 반영.
// 즉 정확도 100 % 여도 accuracy 만으로는 80점. 시간 보너스 (최대 20) 로 나머지를 채워야 100.
// → 정확도만 챙기고 시간 방치하면 만점 불가. 빠른 완주도 채점 기준.
export const ACCURACY_WEIGHT      = 0.8;

export const SLOT_MIN_COUNT     = 3;
export const SLOT_MAX_COUNT     = 5;
export const QTY_MIN            = 1;
export const QTY_MAX            = 5;

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

/**
 * 재고 품목 종류. 이모지로 시각화 (박스 위에 스티커처럼 붙임).
 * 향후 이미지 애셋 교체 시 STOCK_EMOJI → STOCK_IMAGE 로 자연스럽게 이식 가능.
 */
export type StockItemKey = "score" | "mic" | "headphone" | "water" | "towel";

export const STOCK_EMOJI: Record<StockItemKey, string> = {
  score:     "📄",
  mic:       "🎤",
  headphone: "🎧",
  water:     "💧",
  towel:     "🧻",
};

export const STOCK_LABEL: Record<StockItemKey, string> = {
  score:     "악보",
  mic:       "마이크",
  headphone: "헤드폰",
  water:     "물병",
  towel:     "수건",
};

export const STOCK_KEYS: StockItemKey[] = ["score", "mic", "headphone", "water", "towel"];

/**
 * 선반 슬롯.
 *   itemKey    : 이 슬롯에서 요구하는 품목
 *   targetQty  : 목표 수량
 *   currentQty : 현재 배치된 수량 (0 ~ targetQty)
 */
export type StockSlot = {
  id:         string;
  itemKey:    StockItemKey;
  targetQty:  number;
  currentQty: number;
};

/* ═══════════════════════════════════════════════════════════
 * 슬롯 생성
 * ─────────────────────────────────────────────────────────── */

/**
 * 3~5개 슬롯 랜덤 생성.
 * · 슬롯 개수 : SLOT_MIN_COUNT ~ SLOT_MAX_COUNT 랜덤
 * · 각 슬롯 품목 : 5종 중 랜덤 (같은 품목이 두 슬롯에 반복될 수 있음 — 5종 중 3~5 슬롯이라 자연스러움)
 * · 각 슬롯 목표 수량 : QTY_MIN ~ QTY_MAX 랜덤
 *
 * 같은 품목이 두 슬롯에 나오면 유저에겐 "구분 : 왼쪽 3개 vs 오른쪽 2개" 처럼
 * 슬롯 위치로 구별. 어느 슬롯이 먼저 채워지든 상관없음 (양쪽 다 채워야 완료).
 */
export function generateSlots(): StockSlot[] {
  const count =
    SLOT_MIN_COUNT +
    Math.floor(Math.random() * (SLOT_MAX_COUNT - SLOT_MIN_COUNT + 1));
  const slots: StockSlot[] = [];

  for (let i = 0; i < count; i++) {
    const key = STOCK_KEYS[Math.floor(Math.random() * STOCK_KEYS.length)];
    const qty = QTY_MIN + Math.floor(Math.random() * (QTY_MAX - QTY_MIN + 1));
    slots.push({
      id:         `slot_${i}`,
      itemKey:    key,
      targetQty:  qty,
      currentQty: 0,
    });
  }

  return slots;
}

/* ═══════════════════════════════════════════════════════════
 * 드롭 판정
 * ─────────────────────────────────────────────────────────── */

export type DropResult =
  | { kind: "hit";       slotId: string }  // 옳은 슬롯 · 카운트 반영
  | { kind: "wrong_slot" }                 // 잘못된 품목 슬롯
  | { kind: "full_slot" }                  // 이미 도달한 슬롯
  | { kind: "outside" };                   // 슬롯 바깥 드롭

/**
 * 지정된 슬롯 id 에 특정 품목을 드롭하려 할 때의 결과.
 * · slotId 가 null 이면 "outside"
 * · slotId 가 있어도 품목 불일치면 "wrong_slot"
 * · 슬롯 목표 도달했으면 "full_slot"
 * · 나머지는 "hit"
 *
 * 드롭한 슬롯 자체 판정 (slotId 매칭) 은 UI 쪽에서 pointerup 좌표 → 슬롯 rect
 * 히트 테스트로 결정. 이 함수는 그 결과 slotId 만 받아서 상태 검증.
 */
export function evaluateDrop(
  slots: StockSlot[],
  itemKey: StockItemKey,
  slotId: string | null,
): DropResult {
  if (!slotId) return { kind: "outside" };
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return { kind: "outside" };
  if (slot.itemKey !== itemKey) return { kind: "wrong_slot" };
  if (slot.currentQty >= slot.targetQty) return { kind: "full_slot" };
  return { kind: "hit", slotId };
}

/* ═══════════════════════════════════════════════════════════
 * 채점
 * ─────────────────────────────────────────────────────────── */

export type StockFinalScore = {
  finalScore:      number;  // 0~100
  accuracyScore:   number;  // 0~100
  timeBonus:       number;  // 0~TIME_BONUS_MAX
  totalTargetQty:  number;  // 모든 슬롯 목표 합
  totalCurrentQty: number;  // 모든 슬롯 현재 합
  completedSlots:  number;  // 목표 도달한 슬롯 개수
  totalSlots:      number;
};

/**
 * 최종 점수 계산 (2 단계).
 *
 * 1) accuracyRaw    = round(전체 currentQty / 전체 targetQty × 100)   0~100
 *    · 부분 배치도 부분 점수 (비율 기반)
 *    · detail 저장 · UI 표시용 원본 정확도
 *
 * 2) 최종 점수 :
 *    · accuracyWeighted = round(accuracyRaw × ACCURACY_WEIGHT)         0~80
 *    · timeBonusRaw     = 시간 남은량 → 구간 계산                       0~TIME_BONUS_MAX (20)
 *        · remainingSec ≤ 5   → 0
 *        · remainingSec ≥ 20  → 20 (매우 빡빡, 30초 중 20초 이상 남겨야 만점)
 *        · 그 사이            → 선형 보간
 *    · timeBonus        = round(timeBonusRaw × accuracyRaw / 100)      정확도 비율로 스케일
 *        · 정확도 0 이면 시간 보너스도 0 (아무것도 안 하고 시간만 남겨도 점수 없음)
 *    · finalScore       = min(100, accuracyWeighted + timeBonus)
 *
 * 시뮬레이션 :
 *   정확도 100 % + 20초 이상 남김 → 80 + 20 = 100 (퍼펙트, 서버 +300 보너스)
 *   정확도 100 % + 12초 남김      → 80 + 9  = 89
 *   정확도 100 % + 5초 이하 남김  → 80 + 0  = 80  (완주만 하면 최소 80 보장)
 *   정확도 50 %  + 20초 남김      → 40 + 10 = 50
 *   정확도 0 %   + 30초 남김      → 0  + 0  = 0
 *
 * StockFinalScore 반환 :
 *   · accuracyScore : accuracyRaw (원본 0~100, detail 저장·표시용)
 *   · timeBonus     : 최종 반영값 (곱 반영 후, 0~20)
 */
export function calculateFinalScore(
  slots: StockSlot[],
  remainingSec: number,
): StockFinalScore {
  const totalTargetQty  = slots.reduce((sum: number, s: StockSlot) => sum + s.targetQty, 0);
  const totalCurrentQty = slots.reduce((sum: number, s: StockSlot) => sum + s.currentQty, 0);
  const completedSlots  = slots.filter((s: StockSlot) => s.currentQty >= s.targetQty).length;
  const totalSlots      = slots.length;
  const accuracyRaw     = totalTargetQty === 0
    ? 0
    : Math.round((totalCurrentQty / totalTargetQty) * 100);

  // 시간 보너스 raw (구간 계산)
  const remainClamped = Math.max(0, Math.min(TIME_LIMIT_SEC, remainingSec));
  let bonusRaw: number;
  if (remainClamped <= TIME_BONUS_FLOOR_SEC) {
    bonusRaw = 0;
  } else if (remainClamped >= TIME_BONUS_CEIL_SEC) {
    bonusRaw = TIME_BONUS_MAX;
  } else {
    const range   = TIME_BONUS_CEIL_SEC - TIME_BONUS_FLOOR_SEC;
    const inRange = remainClamped - TIME_BONUS_FLOOR_SEC;
    bonusRaw = Math.round((inRange / range) * TIME_BONUS_MAX);
  }

  // 시간 보너스는 정확도 비율로 스케일 (정확도 0 → 시간 보너스 0)
  const timeBonus        = Math.round(bonusRaw * (accuracyRaw / 100));
  const accuracyWeighted = Math.round(accuracyRaw * ACCURACY_WEIGHT);
  const finalScore       = Math.min(100, accuracyWeighted + timeBonus);

  return {
    finalScore,
    accuracyScore:   accuracyRaw,   // detail · 표시용 원본 (0~100)
    timeBonus,                       // 최종 반영값 (0~20)
    totalTargetQty,
    totalCurrentQty,
    completedSlots,
    totalSlots,
  };
}

/**
 * 모든 슬롯이 목표 도달 상태인지 (조기 종료 판정용).
 */
export function isAllComplete(slots: StockSlot[]): boolean {
  return slots.length > 0 && slots.every((s) => s.currentQty >= s.targetQty);
}