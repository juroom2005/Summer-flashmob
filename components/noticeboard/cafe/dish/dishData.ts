// components/noticeboard/cafe/dish/dishData.ts
// ═══════════════════════════════════════════════════════════════════
// 설거지 (cafe_dish) — 스팟 생성 · 히트 테스트 · 채점 로직
// ═══════════════════════════════════════════════════════════════════
//
// 이 파일은 순수 데이터/로직만 담는다 (React 의존 없음).
// 게임 컴포넌트(CafeDishGame)는 이 모듈을 호출해 스팟을 생성하고 채점한다.
//
// 스펙 (v11 §8-2 + 세션 K 결정) :
//   · 접시 1개, 스팟 5~7개 랜덤
//   · 시간 제한 15초, 조기 종료(전 스팟 청결) 가능
//   · 드래그로 스팟 위 재진입 시 청결도 +70 (2번 지나가야 완전 소멸)
//   · 채점 :
//     - accuracyScore = round(cleaned_spots / total_spots × 100)
//                       (비율 감산 방식, 남은 스팟이 있으면 그만큼 점수 깎임)
//     - timeBonus     = 0~10, 8초 이상 남기면 만점, 3초 이하 0, 사이 선형
//     - finalScore    = min(100, accuracyScore + timeBonus)
//   · 별 1 (난이도 가산 없음, RPC 에서 자동 처리)

/* ═══════════════════════════════════════════════════════════
 * 상수
 * ─────────────────────────────────────────────────────────── */

export const TIME_LIMIT_SEC       = 15;
export const TIME_BONUS_MAX       = 10;
export const TIME_BONUS_FLOOR_SEC = 3;  // 이하면 보너스 0
export const TIME_BONUS_CEIL_SEC  = 8;  // 이상이면 만점

export const SPOT_MIN_COUNT     = 5;
export const SPOT_MAX_COUNT     = 7;
export const SPOT_MIN_SIZE_PCT  = 9;    // 접시 대비 지름 % (약 40px @ 접시 400px)
export const SPOT_MAX_SIZE_PCT  = 25;   // 약 60px @ 접시 400px
export const SPOT_SAFE_RADIUS   = 40;   // 접시 중심 대비 최대 배치 반경 % (가장자리 여유)
export const SPOT_MIN_DISTANCE  = 16;   // 스팟간 최소 중심 거리 % (겹침 방지)
export const SCRUB_DAMAGE       = 70;   // 재진입 시 청결도 증가량
export const CLEAN_THRESHOLD    = 100;  // cleanliness 가 이 값 이상이면 완전 소멸
export const DIRT_VARIANT_COUNT = 3;    // 얼룩 png 종류 수 (public/dish/dirt_1~3.png)

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

export type DishSpot = {
  id:          string;
  x:           number; // 접시 대비 % (0~100, 중심 기준)
  y:           number; // 접시 대비 %
  size:        number; // 접시 대비 지름 %
  cleanliness: number; // 0(완전 더러움) ~ 100(완전 깨끗)
  variant:     number; // 얼룩 png 종류 (0~2), dirt_1~3.png 중 랜덤
};

/* ═══════════════════════════════════════════════════════════
 * 스팟 생성
 * ─────────────────────────────────────────────────────────── */

/**
 * 접시 위에 스팟 5~7개를 랜덤 배치.
 * · 위치 : 접시 중심 (50, 50) 기준 SPOT_SAFE_RADIUS 안 폴라 좌표
 * · 겹침 방지 : SPOT_MIN_DISTANCE 이상 떨어뜨림 (30회 시도, 실패 시 강제 배치)
 * · 크기·초기 오염도 랜덤
 */
export function generateSpots(): DishSpot[] {
  const count = SPOT_MIN_COUNT + Math.floor(Math.random() * (SPOT_MAX_COUNT - SPOT_MIN_COUNT + 1));
  const spots: DishSpot[] = [];
  const maxAttempts = 30;

  for (let i = 0; i < count; i++) {
    let placed = false;

    for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = Math.random() * SPOT_SAFE_RADIUS;
      const x      = 50 + Math.cos(angle) * radius;
      const y      = 50 + Math.sin(angle) * radius;

      // 기존 스팟과 최소 거리 확인
      const tooClose = spots.some((s) => {
        const dx = s.x - x;
        const dy = s.y - y;
        return Math.sqrt(dx * dx + dy * dy) < SPOT_MIN_DISTANCE;
      });

      if (!tooClose) {
        spots.push({
          id:          `spot_${i}`,
          x, y,
          size:        SPOT_MIN_SIZE_PCT + Math.random() * (SPOT_MAX_SIZE_PCT - SPOT_MIN_SIZE_PCT),
          cleanliness: 0,
          variant:     Math.floor(Math.random() * DIRT_VARIANT_COUNT),
        });
        placed = true;
      }
    }

    // 30회 시도 후에도 배치 실패 시 강제 배치 (겹쳐도 게임 진행 우선)
    if (!placed) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = Math.random() * SPOT_SAFE_RADIUS;
      spots.push({
        id:          `spot_${i}`,
        x:           50 + Math.cos(angle) * radius,
        y:           50 + Math.sin(angle) * radius,
        size:        SPOT_MIN_SIZE_PCT + Math.random() * (SPOT_MAX_SIZE_PCT - SPOT_MIN_SIZE_PCT),
        cleanliness: 0,
        variant:     Math.floor(Math.random() * DIRT_VARIANT_COUNT),
      });
    }
  }

  return spots;
}

/* ═══════════════════════════════════════════════════════════
 * 히트 테스트
 * ─────────────────────────────────────────────────────────── */

/**
 * 커서가 스팟 안에 있는지 판정.
 * 좌표는 모두 접시 대비 % (0~100).
 * 히트 반경은 스팟 지름의 절반.
 */
export function isInsideSpot(spot: DishSpot, cursorX: number, cursorY: number): boolean {
  const dx = spot.x - cursorX;
  const dy = spot.y - cursorY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < spot.size / 2;
}

/* ═══════════════════════════════════════════════════════════
 * 채점
 * ─────────────────────────────────────────────────────────── */

export type DishFinalScore = {
  finalScore:     number; // 0~100
  accuracyScore:  number; // 0~100 (cleaned / total × 100)
  timeBonus:      number; // 0~TIME_BONUS_MAX
  totalSpots:     number;
  cleanedSpots:   number; // cleanliness >= 100 인 개수
  remainingSpots: number; // total - cleaned
};

/**
 * 최종 점수 계산.
 * · accuracyScore = round(cleaned / total × 100)   0~100
 *   비율 감산 방식 : 남은 스팟 개수에 비례해서 점수 깎임.
 *   예 : 6개 중 2개 남으면 (4/6)×100 = 67점
 * · timeBonus :
 *     · remainingSec ≤ 3  → 0
 *     · remainingSec ≥ 8  → TIME_BONUS_MAX (10)
 *     · 그 사이           → 선형 보간
 * · finalScore = min(100, accuracyScore + timeBonus)
 */
export function calculateFinalScore(
  spots: DishSpot[],
  remainingSec: number,
): DishFinalScore {
  const totalSpots     = spots.length;
  const cleanedSpots   = spots.filter((s) => s.cleanliness >= CLEAN_THRESHOLD).length;
  const remainingSpots = totalSpots - cleanedSpots;
  const accuracyScore  = totalSpots === 0
    ? 0
    : Math.round((cleanedSpots / totalSpots) * 100);

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
    totalSpots,
    cleanedSpots,
    remainingSpots,
  };
}

/**
 * 모든 스팟이 청결한지 (조기 종료 판정용).
 */
export function isAllClean(spots: DishSpot[]): boolean {
  return spots.length > 0 && spots.every((s) => s.cleanliness >= CLEAN_THRESHOLD);
}