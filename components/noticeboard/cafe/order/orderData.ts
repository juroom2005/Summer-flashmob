// components/noticeboard/cafe/order/orderData.ts
// ═══════════════════════════════════════════════════════════════════
// 주문 받기 (cafe_order) — 옵션 데이터 · 랜덤 주문 생성 · 채점 로직
// ═══════════════════════════════════════════════════════════════════
//
// 이 파일은 순수 데이터/로직만 담는다 (React 의존 없음).
// 게임 컴포넌트(CafeOrderGame)는 이 모듈을 호출해 주문을 생성하고 채점한다.
//
// 용어:
//   · Axis    : 옵션 축 (온도 · 얼음 · 샷 · 휘핑 · 시럽 · 과일 · 베이스 · 탄산 · 토핑)
//   · Option  : 한 축에서 선택된 값 (axisKey + valueKey)
//   · Order   : 손님 한 명의 주문 = 음료 종류 + 옵션 시퀀스
//
// 주문 시퀀스 순서 (제시·입력 순서) 규칙:
//   음료 종류 → 온도 → 얼음(있을 때만) → 샷 → 휘핑 → 시럽
//   에이드    → 과일 → 베이스 → 탄산 → 얼음 → 토핑
//   (음료 종류 자체도 시퀀스 첫 항목으로 포함되어 버튼 입력 대상)
//
// 확정 스펙 (세션 J):
//   · 커피3종(아메·라떼·핫초코): 온도 4종(핫/아이스/미지근/펄펄)
//   · 프라페·에이드: 온도 고정(아이스). 온도 옵션 시퀀스에 넣지 않음
//   · 얼음: 요구 시에만 시퀀스에 포함(핫이어도 요구 가능). 확률로 결정
//   · 채점: score = round(정답수 / 총옵션수 × 100), 합산(틀린 것만 미스)

/* ═══════════════════════════════════════════════════════════
 * 축 · 값 정의
 * ─────────────────────────────────────────────────────────── */

export type AxisKey =
  | "drink"
  | "temp"
  | "ice"
  | "shot"
  | "whip"
  | "syrup"
  | "fruit"
  | "base"
  | "soda"
  | "topping";

export type OptionValue = { key: string; label: string };

// 각 축의 선택 가능한 값 목록
export const AXIS_VALUES: Record<AxisKey, OptionValue[]> = {
  drink: [
    { key: "americano", label: "아메리카노" },
    { key: "latte",     label: "라떼" },
    { key: "cocoa",     label: "핫초코" },
    { key: "frappe",    label: "프라페" },
    { key: "ade",       label: "에이드" },
  ],
  temp: [
    { key: "hot",   label: "핫" },
    { key: "iced",  label: "아이스" },
    { key: "warm",  label: "미지근하게" },
    { key: "boil",  label: "펄펄 끓게" },
  ],
  ice: [
    { key: "lots",  label: "얼음 많이" },
    { key: "normal",label: "얼음 보통" },
    { key: "less",  label: "얼음 적게" },
    { key: "one",   label: "얼음 한 개만" },
    { key: "max",   label: "얼음 왕창" },
  ],
  shot: [
    { key: "shot0", label: "0샷" },
    { key: "shot1", label: "1샷" },
    { key: "shot2", label: "2샷" },
    { key: "shot3", label: "3샷" },
  ],
  whip: [
    { key: "none", label: "휘핑 없음" },
    { key: "less", label: "휘핑 적게" },
    { key: "lots", label: "휘핑 많이" },
    { key: "max",  label: "휘핑 왕창" },
  ],
  syrup: [
    { key: "none", label: "시럽 없음" },
    { key: "less", label: "시럽 적게" },
    { key: "lots", label: "시럽 많이" },
  ],
  fruit: [
    { key: "grapefruit",   label: "자몽" },
    { key: "greengrape",   label: "청포도" },
    { key: "lemon",        label: "레몬" },
    { key: "passionfruit", label: "패션후르츠" },
    { key: "blueberry",    label: "블루베리" },
  ],
  base: [
    { key: "light", label: "베이스 적게" },
    { key: "rich",  label: "베이스 진하게" },
  ],
  soda: [
    { key: "yes", label: "탄산 있음" },
    { key: "no",  label: "탄산 없음" },
  ],
  topping: [
    { key: "none", label: "토핑 없음" },
    { key: "yes",  label: "과일 토핑 추가" },
  ],
};

// 축 표시명 (버튼 그룹 헤더용)
export const AXIS_LABELS: Record<AxisKey, string> = {
  drink:   "음료",
  temp:    "온도",
  ice:     "얼음",
  shot:    "샷",
  whip:    "휘핑",
  syrup:   "시럽",
  fruit:   "과일",
  base:    "베이스",
  soda:    "탄산",
  topping: "토핑",
};

// 축별 컬러칩 색 (POS 키패드 기능키 색 구분). 이미지의 컬러 기능키 참고.
export const AXIS_COLORS: Record<AxisKey, string> = {
  drink:   "#5b6b8c",
  temp:    "#d94f4f",
  ice:     "#3aa0d6",
  shot:    "#8a6d3b",
  whip:    "#c98bcf",
  syrup:   "#e0913a",
  fruit:   "#4fae6a",
  base:    "#7d8a3b",
  soda:    "#3ab0a0",
  topping: "#b07d4f",
};

/* ═══════════════════════════════════════════════════════════
 * 음료별 축 구성
 * ─────────────────────────────────────────────────────────── */

export type DrinkKey = "americano" | "latte" | "cocoa" | "frappe" | "ade";

// 온도 고정 음료: 온도 옵션을 주문에 넣지 않고, UI 에서 고정 온도 배지로 표시.
// (프라페·에이드는 아이스 고정)
export const FIXED_TEMP: Partial<Record<DrinkKey, string>> = {
  frappe: "아이스",
  ade:    "아이스",
};

// 음료 종류(drink) 를 제외한, 그 뒤에 붙는 축 순서.
// temp 고정 음료(frappe·ade)는 temp 를 넣지 않는다.
// ice 는 요구 시에만 들어가므로 여기서는 "후보"이며 실제 포함은 생성 시 확률 결정.
const DRINK_AXES: Record<DrinkKey, AxisKey[]> = {
  americano: ["temp", "shot", "syrup"],
  latte:     ["temp", "shot", "whip", "syrup"],
  cocoa:     ["temp", "whip", "syrup"],
  frappe:    ["shot", "whip", "syrup"],           // 온도 고정(아이스)
  ade:       ["fruit", "base", "soda", "topping"],// 온도 고정(아이스)
};

// 얼음 축을 가질 수 있는 음료 (요구 시 temp 뒤 / 특정 위치에 삽입)
// 커피3종·프라페는 얼음 후보. 에이드는 자체 얼음 위치가 정해져 있음.
const ICE_CAPABLE: Record<DrinkKey, boolean> = {
  americano: true,
  latte:     true,
  cocoa:     true,
  frappe:    true,
  ade:       true, // 에이드도 얼음 있음. 단 삽입 위치가 다름(soda 뒤)
};

// 얼음이 주문에 포함될 확률
const ICE_PROBABILITY = 0.6;

/* ═══════════════════════════════════════════════════════════
 * 주문 타입
 * ─────────────────────────────────────────────────────────── */

// 주문 한 항목 = 축 + 그 축에서 고른 값
export type OrderItem = {
  axis:  AxisKey;
  value: OptionValue;
};

// 손님 한 명의 주문
export type CustomerOrder = {
  drink: DrinkKey;
  items: OrderItem[]; // 입력해야 하는 시퀀스 (drink 포함, 순서 = 제시 순서)
};

/* ═══════════════════════════════════════════════════════════
 * 랜덤 유틸
 * ─────────────────────────────────────────────────────────── */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickValue(axis: AxisKey): OptionValue {
  return pick(AXIS_VALUES[axis]);
}

/* ═══════════════════════════════════════════════════════════
 * 주문 생성
 * ─────────────────────────────────────────────────────────── */

/**
 * 손님 한 명의 랜덤 주문 생성.
 * 시퀀스 첫 항목은 항상 drink(음료 종류).
 */
export function generateOrder(): CustomerOrder {
  const drink = pick(AXIS_VALUES.drink).key as DrinkKey;
  const items: OrderItem[] = [];

  // 1) 음료 종류 (항상 첫 항목)
  items.push({
    axis: "drink",
    value: AXIS_VALUES.drink.find((v) => v.key === drink)!,
  });

  const axes = DRINK_AXES[drink];
  const wantIce = ICE_CAPABLE[drink] && Math.random() < ICE_PROBABILITY;

  if (drink === "ade") {
    // 에이드: fruit → base → soda → (ice) → topping
    for (const axis of axes) {
      if (axis === "topping" && wantIce) {
        // topping 앞에 ice 삽입
        items.push({ axis: "ice", value: pickValue("ice") });
      }
      items.push({ axis, value: pickValue(axis) });
    }
  } else {
    // 커피3종·프라페: [temp?] → (ice) → shot/whip/syrup...
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
      items.push({ axis, value: pickValue(axis) });
      // temp 바로 뒤(또는 temp 고정 음료는 첫 축 뒤)에 ice 삽입
      const isFirstRealAxis = i === 0;
      if (isFirstRealAxis && wantIce) {
        items.push({ axis: "ice", value: pickValue("ice") });
      }
    }
  }

  return { drink, items };
}

/**
 * 손님 2명 주문 생성 (기본 라운드).
 */
export function generateRound(count = 2): CustomerOrder[] {
  return Array.from({ length: count }, () => generateOrder());
}

/* ═══════════════════════════════════════════════════════════
 * 입력 버튼 레이아웃
 * ─────────────────────────────────────────────────────────── */

// 화면에 항상 노출되는 버튼 그룹 순서 (O2=a: 모든 버튼 상시 노출).
// 유저는 이 버튼들 중에서 제시된 주문 순서대로 누른다.
//
// 배치 원칙: wide 축(값 4개 이상, 전체폭 사용) 을 앞에 모으고,
// 좁은 축(값 2~3개, 반폭 사용) 을 뒤에 모아 2컬럼 그리드에 빈칸 없이 배치.
// 이 순서는 UI 자판 순서일 뿐 게임 채점 로직(order.items 순서) 과는 무관.
export const BUTTON_LAYOUT: AxisKey[] = [
  "drink",
  "temp",
  "ice",
  "shot",
  "whip",
  "fruit",
  "syrup",
  "base",
  "soda",
  "topping",
];

/* ═══════════════════════════════════════════════════════════
 * 채점
 * ─────────────────────────────────────────────────────────── */

// 유저 입력 한 번 = 누른 버튼의 축+값
export type InputEntry = { axis: AxisKey; valueKey: string };

export type OrderScoreResult = {
  score:        number;   // 0~100
  totalOptions: number;   // 전체 옵션 수 (두 손님 합)
  correct:      number;   // 맞은 옵션 수
  miss:         number;   // 틀린 옵션 수
  perCustomer:  { correct: number; total: number }[];
};

/**
 * 채점: 각 손님의 주문 시퀀스와 유저 입력 시퀀스를 위치별로 비교.
 *
 * 위치별 비교 이유:
 *   · 입력 종료가 "옵션 개수만큼 누르면 자동"(C1=a)이라
 *     유저 입력 길이 = 주문 길이가 보장됨.
 *   · 순서와 값이 모두 맞아야 정답. (axis, valueKey) 둘 다 일치.
 *   · 오답이어도 계속 진행하므로 위치는 어긋나지 않음(항상 i번째끼리 비교).
 *
 * @param orders  손님별 주문
 * @param inputs  손님별 유저 입력 시퀀스
 */
export function scoreOrders(
  orders: CustomerOrder[],
  inputs: InputEntry[][]
): OrderScoreResult {
  let totalOptions = 0;
  let correct = 0;
  const perCustomer: { correct: number; total: number }[] = [];

  orders.forEach((order, ci) => {
    const seq = order.items;
    const inp = inputs[ci] ?? [];
    let cCorrect = 0;

    seq.forEach((item, i) => {
      totalOptions += 1;
      const got = inp[i];
      if (got && got.axis === item.axis && got.valueKey === item.value.key) {
        correct += 1;
        cCorrect += 1;
      }
    });

    perCustomer.push({ correct: cCorrect, total: seq.length });
  });

  const miss = totalOptions - correct;
  const score =
    totalOptions === 0 ? 0 : Math.round((correct / totalOptions) * 100);

  return { score, totalOptions, correct, miss, perCustomer };
}

/* ═══════════════════════════════════════════════════════════
 * 표시 헬퍼
 * ─────────────────────────────────────────────────────────── */

// 주문을 사람이 읽는 문장으로 (리워드 팝업 · 리뷰용)
export function orderToText(order: CustomerOrder): string {
  return order.items.map((it) => it.value.label).join(" · ");
}

// 손님 한 명의 입력을 채점 (즉시 채점용).
// 위치별로 (axis, valueKey) 일치 여부 비교.
export function scoreOneCustomer(
  order: CustomerOrder,
  input: InputEntry[]
): { correct: number; total: number; itemHits: boolean[] } {
  const itemHits = order.items.map((item, i) => {
    const got = input[i];
    return !!got && got.axis === item.axis && got.valueKey === item.value.key;
  });
  const correct = itemHits.filter(Boolean).length;
  return { correct, total: order.items.length, itemHits };
}