// components/noticeboard/practice/clean/cleanData.ts
// ═══════════════════════════════════════════════════════════════════
// 연습실 청소 (practice_clean) — 스팟 생성 · 히트 테스트 · 채점 로직
// ═══════════════════════════════════════════════════════════════════
//
// 순수 데이터/로직만 담는다 (React 의존 없음).
// PracticeCleanGame 은 이 모듈을 호출해 먼지 스팟을 생성하고 채점한다.
//
// 카페 dishData 를 복제해서 신설. 안정성 원칙 상 카페 모듈은 참조·수정하지 않는다.
//
// 카페 설거지와의 차이 :
//   · 이름 : DishSpot → CleanSpot (도메인 명확화)
//   · 배치 : 폴라 좌표 (원형 접시) → 카티지안 (사각형 바닥)
//   · 상수 · 채점 로직 · 재진입 감지 방식은 완전 동일
//
// 스펙 (v12 §8-1 + 세션 L 결정) :
//   · 연습실 바닥 (사각형), 먼지 스팟 5~7개 랜덤
//   · 시간 제한 15초, 조기 종료 (모든 먼지 청결) 가능
//   · 드래그로 스팟 위 재진입 시 청결도 +70 (2번 지나가야 완전 소멸)
//   · 채점 :
//     - accuracyScore = round(cleaned_spots / total_spots × 100)
//                       (비율 감산 방식, 남은 먼지가 있으면 그만큼 점수 깎임)
//     - timeBonus     = 0~10, 8초 이상 남기면 만점, 3초 이하 0, 사이 선형
//     - finalScore    = min(100, accuracyScore + timeBonus)
//   · 별 1 · 난이도 가산 없음 (RPC 에서 자동 처리, practice_clean 축소 스케일)

/* ═══════════════════════════════════════════════════════════
 * 상수
 * ─────────────────────────────────────────────────────────── */

export const TIME_LIMIT_SEC       = 15;
export const TIME_BONUS_MAX       = 10;
export const TIME_BONUS_FLOOR_SEC = 3;  // 이하면 보너스 0
export const TIME_BONUS_CEIL_SEC  = 8;  // 이상이면 만점

export const SPOT_MIN_COUNT     = 5;
export const SPOT_MAX_COUNT     = 7;
export const SPOT_MIN_SIZE_PCT  = 9;    // 바닥 대비 지름 %
export const SPOT_MAX_SIZE_PCT  = 15;
// 사각형 배치 여유 (스팟이 가장자리에 붙지 않도록 안쪽으로 몰기)
export const SPOT_MARGIN_PCT    = 12;   // 좌·우·상·하 여유
export const SPOT_MIN_DISTANCE  = 16;   // 스팟간 최소 중심 거리 % (겹침 방지)
export const SCRUB_DAMAGE       = 70;   // 재진입 시 청결도 증가량
export const CLEAN_THRESHOLD    = 100;  // cleanliness 가 이 값 이상이면 완전 소멸

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

export type CleanSpot = {
  id:          string;
  x:           number; // 바닥 대비 % (0~100, 중심 기준)
  y:           number; // 바닥 대비 %
  size:        number; // 바닥 대비 지름 %
  cleanliness: number; // 0(완전 더러움) ~ 100(완전 깨끗)
};

/* ═══════════════════════════════════════════════════════════
 * 스팟 생성
 * ─────────────────────────────────────────────────────────── */

/**
 * 사각형 바닥 위에 먼지 스팟 5~7개를 랜덤 배치.
 * · 위치 : SPOT_MARGIN_PCT ~ (100 - SPOT_MARGIN_PCT) 카티지안 좌표 랜덤
 * · 겹침 방지 : SPOT_MIN_DISTANCE 이상 떨어뜨림 (30회 시도, 실패 시 강제 배치)
 * · 크기·초기 오염도 랜덤
 */
export function generateSpots(): CleanSpot[] {
  const count =
    SPOT_MIN_COUNT + Math.floor(Math.random() * (SPOT_MAX_COUNT - SPOT_MIN_COUNT + 1));
  const spots: CleanSpot[] = [];
  const maxAttempts = 30;
  const range = 100 - SPOT_MARGIN_PCT * 2;  // 배치 가능 범위 폭

  for (let i = 0; i < count; i++) {
    let placed = false;

    for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
      const x = SPOT_MARGIN_PCT + Math.random() * range;
      const y = SPOT_MARGIN_PCT + Math.random() * range;

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
        });
        placed = true;
      }
    }

    // 30회 시도 후에도 배치 실패 시 강제 배치 (겹쳐도 게임 진행 우선)
    if (!placed) {
      spots.push({
        id:          `spot_${i}`,
        x:           SPOT_MARGIN_PCT + Math.random() * range,
        y:           SPOT_MARGIN_PCT + Math.random() * range,
        size:        SPOT_MIN_SIZE_PCT + Math.random() * (SPOT_MAX_SIZE_PCT - SPOT_MIN_SIZE_PCT),
        cleanliness: 0,
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
 * 좌표는 모두 바닥 대비 % (0~100).
 * 히트 반경은 스팟 지름의 절반.
 *
 * 주의 : 바닥이 사각형이지만 스팟 자체는 원형 (border-radius: 50%) 이므로
 *        히트 판정도 원형 (유클리드 거리) 유지.
 */
export function isInsideSpot(spot: CleanSpot, cursorX: number, cursorY: number): boolean {
  const dx = spot.x - cursorX;
  const dy = spot.y - cursorY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < spot.size / 2;
}

/* ═══════════════════════════════════════════════════════════
 * 채점
 * ─────────────────────────────────────────────────────────── */

export type CleanFinalScore = {
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
  spots: CleanSpot[],
  remainingSec: number,
): CleanFinalScore {
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
export function isAllClean(spots: CleanSpot[]): boolean {
  return spots.length > 0 && spots.every((s) => s.cleanliness >= CLEAN_THRESHOLD);
}
