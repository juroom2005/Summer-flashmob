// components/noticeboard/practice/clean/cleanData.ts
// ═══════════════════════════════════════════════════════════════════
// 연습실 청소 (practice_clean) — 쓰레기 아이템 생성 · 드롭 판정 · 채점
// ═══════════════════════════════════════════════════════════════════
//
// 순수 데이터/로직만 담는다 (React 의존 없음).
// PracticeCleanGame 은 이 모듈을 호출해 쓰레기를 생성·판정·채점한다.
//
// 게임 방식 (세션 L 재설계) :
//   · 연습실 바닥 (사각형) 위에 쓰레기 5~7개 랜덤 배치
//   · 하단 오른쪽 코너에 쓰레기통 고정
//   · 유저가 쓰레기를 드래그해서 쓰레기통에 드롭 → 수거
//   · 쓰레기통 밖에서 드롭 → 놓은 위치에 그대로 남음 (관대함, 재시도 가능)
//   · 20초 안에 최대한 많이 수거
//
// 이전 방식 (설거지형) 과의 차이 :
//   · 재진입 문지르기 → 드래그 & 드롭
//   · 얼룩 청결도 → 아이템 상태 (idle | picked_up | in_bin)
//   · 카페 설거지와 시각·조작 모두 완전 차별화
//
// 채점 (이전과 동일 인터페이스 유지 → RPC 무변경) :
//   · accuracyScore = round(collected / total × 100)
//   · timeBonus     = 0~10, 8초 이상 남기면 만점, 3초 이하 0, 사이 선형
//   · finalScore    = min(100, accuracyScore + timeBonus)
//   · 별 1 · 난이도 가산 없음 (RPC 에서 축소 스케일 자동 처리)

/* ═══════════════════════════════════════════════════════════
 * 상수
 * ─────────────────────────────────────────────────────────── */

export const TIME_LIMIT_SEC       = 20;
export const TIME_BONUS_MAX       = 10;
export const TIME_BONUS_FLOOR_SEC = 3;  // 이하면 보너스 0
export const TIME_BONUS_CEIL_SEC  = 8;  // 이상이면 만점

export const TRASH_MIN_COUNT    = 5;
export const TRASH_MAX_COUNT    = 7;

// 아이템 배치 여유 (좌·상 여유. 우·하 쪽은 쓰레기통을 피해서 별도 계산)
export const ITEM_MARGIN_PCT    = 8;
// 아이템간 최소 중심 거리 (겹침 방지)
export const ITEM_MIN_DISTANCE  = 18;
// pickup 히트 반경 (아이템 중심에서 이 거리 안 클릭 시 잡힘)
export const PICKUP_HIT_RADIUS  = 8;  // 바닥 대비 %

// 쓰레기통 (하단 오른쪽 코너 고정)
export const BIN_CENTER_X = 84;  // 바닥 대비 % (중심)
export const BIN_CENTER_Y = 82;
export const BIN_HALF_W   = 12;  // 반너비 %
export const BIN_HALF_H   = 12;  // 반높이 %

// 아이템 배치 시 쓰레기통 영역과의 최소 여유 (아이템이 통 위에 겹치지 않게)
export const BIN_SAFE_PAD = 4;   // %

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

/**
 * 쓰레기 종류. 이모지로 시각적 다양성 확보.
 * 향후 아이템별 특수 로직 붙일 수 있는 여지 (예: 무거운 아이템은 드래그 저항 등)
 */
export type TrashKind = "paper" | "can" | "cup" | "bottle" | "peel";

export const TRASH_EMOJI: Record<TrashKind, string> = {
  paper:  "📄",
  can:    "🥫",
  cup:    "🥤",
  bottle: "🧴",
  peel:   "🍌",
};

const TRASH_KINDS: TrashKind[] = ["paper", "can", "cup", "bottle", "peel"];

/**
 * 아이템 상태.
 *   idle       : 바닥에 놓임. pickup 대기
 *   picked_up  : 유저가 드래그 중. 커서를 따라다님
 *   in_bin     : 쓰레기통에 들어감. 화면에서 사라짐. 수거 카운트에 포함
 */
export type TrashStatus = "idle" | "picked_up" | "in_bin";

export type TrashItem = {
  id:      string;
  kind:    TrashKind;
  x:       number;      // 바닥 대비 % (0~100, 중심 기준)
  y:       number;
  status:  TrashStatus;
};

/* ═══════════════════════════════════════════════════════════
 * 쓰레기 배치
 * ─────────────────────────────────────────────────────────── */

/**
 * 쓰레기통 영역 안에 좌표가 걸치는지 (여유 포함).
 * 아이템 배치 시 이 영역을 피해서 배치 (통 위에 겹치지 않게).
 */
function overlapsWithBin(x: number, y: number): boolean {
  const halfW = BIN_HALF_W + BIN_SAFE_PAD;
  const halfH = BIN_HALF_H + BIN_SAFE_PAD;
  return (
    x >= BIN_CENTER_X - halfW &&
    x <= BIN_CENTER_X + halfW &&
    y >= BIN_CENTER_Y - halfH &&
    y <= BIN_CENTER_Y + halfH
  );
}

/**
 * 사각형 바닥 위에 쓰레기 5~7개를 랜덤 배치.
 * · 위치 : ITEM_MARGIN_PCT ~ (100 - ITEM_MARGIN_PCT) 카티지안 좌표 랜덤
 * · 쓰레기통 영역 회피
 * · 겹침 방지 : ITEM_MIN_DISTANCE 이상 떨어뜨림 (30회 시도, 실패 시 강제 배치)
 * · 종류 랜덤 (5종 균등)
 */
export function generateTrashItems(): TrashItem[] {
  const count =
    TRASH_MIN_COUNT +
    Math.floor(Math.random() * (TRASH_MAX_COUNT - TRASH_MIN_COUNT + 1));
  const items: TrashItem[] = [];
  const maxAttempts = 30;
  const range = 100 - ITEM_MARGIN_PCT * 2;

  for (let i = 0; i < count; i++) {
    let placed = false;

    for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
      const x = ITEM_MARGIN_PCT + Math.random() * range;
      const y = ITEM_MARGIN_PCT + Math.random() * range;

      // 쓰레기통 위 회피
      if (overlapsWithBin(x, y)) continue;

      // 기존 아이템과 최소 거리 확인
      const tooClose = items.some((it) => {
        const dx = it.x - x;
        const dy = it.y - y;
        return Math.sqrt(dx * dx + dy * dy) < ITEM_MIN_DISTANCE;
      });

      if (!tooClose) {
        items.push({
          id:     `trash_${i}`,
          kind:   TRASH_KINDS[Math.floor(Math.random() * TRASH_KINDS.length)],
          x, y,
          status: "idle",
        });
        placed = true;
      }
    }

    // 30회 시도 후에도 배치 실패 시 강제 배치 (쓰레기통 회피만 유지)
    if (!placed) {
      let fx = ITEM_MARGIN_PCT + Math.random() * range;
      let fy = ITEM_MARGIN_PCT + Math.random() * range;
      // 최소한 쓰레기통 위는 피함 (게임 진행 우선)
      let guard = 20;
      while (overlapsWithBin(fx, fy) && guard-- > 0) {
        fx = ITEM_MARGIN_PCT + Math.random() * range;
        fy = ITEM_MARGIN_PCT + Math.random() * range;
      }
      items.push({
        id:     `trash_${i}`,
        kind:   TRASH_KINDS[Math.floor(Math.random() * TRASH_KINDS.length)],
        x:      fx,
        y:      fy,
        status: "idle",
      });
    }
  }

  return items;
}

/* ═══════════════════════════════════════════════════════════
 * pickup · drop 판정
 * ─────────────────────────────────────────────────────────── */

/**
 * pointerdown 위치에서 pickup 대상 아이템 찾기.
 * · 여러 아이템이 반경 안에 있으면 배열 뒤쪽 (렌더 상 위쪽) 우선
 * · idle 상태만 대상 (in_bin · picked_up 은 무시)
 * · 반환 : 아이템 id 또는 null
 */
export function findPickupTarget(
  items: TrashItem[],
  cursorX: number,
  cursorY: number,
): string | null {
  // 뒤에서 앞으로 (렌더 z-order 상 위쪽 우선)
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.status !== "idle") continue;
    const dx = it.x - cursorX;
    const dy = it.y - cursorY;
    if (Math.sqrt(dx * dx + dy * dy) < PICKUP_HIT_RADIUS) {
      return it.id;
    }
  }
  return null;
}

/**
 * 커서가 쓰레기통 사각형 영역 안인지 판정 (drop 성공 여부).
 * 좌표는 바닥 대비 % (0~100).
 */
export function isOverBin(cursorX: number, cursorY: number): boolean {
  return (
    cursorX >= BIN_CENTER_X - BIN_HALF_W &&
    cursorX <= BIN_CENTER_X + BIN_HALF_W &&
    cursorY >= BIN_CENTER_Y - BIN_HALF_H &&
    cursorY <= BIN_CENTER_Y + BIN_HALF_H
  );
}

/* ═══════════════════════════════════════════════════════════
 * 채점
 * ─────────────────────────────────────────────────────────── */

export type CleanFinalScore = {
  finalScore:      number; // 0~100
  accuracyScore:   number; // 0~100 (collected / total × 100)
  timeBonus:       number; // 0~TIME_BONUS_MAX
  totalItems:      number;
  collectedItems:  number; // in_bin 인 개수
  remainingItems:  number; // total - collected
};

/**
 * 최종 점수 계산.
 * · accuracyScore = round(collected / total × 100)   0~100
 *   비율 감산 방식 : 남은 쓰레기 개수에 비례해서 점수 깎임.
 * · timeBonus :
 *     · remainingSec ≤ 3  → 0
 *     · remainingSec ≥ 8  → TIME_BONUS_MAX (10)
 *     · 그 사이           → 선형 보간
 * · finalScore = min(100, accuracyScore + timeBonus)
 */
export function calculateFinalScore(
  items: TrashItem[],
  remainingSec: number,
): CleanFinalScore {
  const totalItems     = items.length;
  const collectedItems = items.filter((it) => it.status === "in_bin").length;
  const remainingItems = totalItems - collectedItems;
  const accuracyScore  = totalItems === 0
    ? 0
    : Math.round((collectedItems / totalItems) * 100);

  const remainClamped = Math.max(0, Math.min(TIME_LIMIT_SEC, remainingSec));
  let bonus: number;
  if (remainClamped <= TIME_BONUS_FLOOR_SEC) {
    bonus = 0;
  } else if (remainClamped >= TIME_BONUS_CEIL_SEC) {
    bonus = TIME_BONUS_MAX;
  } else {
    const range   = TIME_BONUS_CEIL_SEC - TIME_BONUS_FLOOR_SEC;
    const inRange = remainClamped - TIME_BONUS_FLOOR_SEC;
    bonus = Math.round((inRange / range) * TIME_BONUS_MAX);
  }

  return {
    finalScore:     Math.min(100, accuracyScore + bonus),
    accuracyScore,
    timeBonus:      bonus,
    totalItems,
    collectedItems,
    remainingItems,
  };
}

/**
 * 모든 쓰레기가 수거됐는지 (조기 종료 판정용).
 */
export function isAllCollected(items: TrashItem[]): boolean {
  return items.length > 0 && items.every((it) => it.status === "in_bin");
}