// components/noticeboard/cafe/mix/mixData.ts
// ═══════════════════════════════════════════════════════════════════
// 음료 제조 (cafe_mix) — 재료 · 음료 레시피 · 모디파이어 · 채점 로직
// ═══════════════════════════════════════════════════════════════════
//
// 이 파일은 순수 데이터/로직만 담는다 (React 의존 없음).
// 게임 컴포넌트(CafeMixGame)는 이 모듈을 호출해 오더를 뽑고 채점한다.
//
// 용어:
//   · Ingredient : 재료 (10종). 사용자가 자판에서 클릭해 컵에 쌓는 단위
//   · Drink      : 음료 (8종). 각 음료는 고정 base recipe 를 가진다
//   · Modifier   : 특수 요청 (7종). base recipe 를 변형해 실제 정답 recipe 생성
//   · Recipe     : IngredientKey[] — index 0 이 컵 바닥, 마지막이 상단
//   · Order      : 손님 한 명의 오더 = { drink, baseRecipe, recipe, modifiers }
//
// v11 §8-1 확정 스펙 + 게임감 강화:
//   · 레시피북 상시 노출 (기억 게임 아님). base recipe 는 책에 표시됨
//   · 모디파이어는 티켓의 배지로 표시. 사용자가 읽고 recipe 변형 계산해야 함
//   · 1잔 만 제조
//   · 오답도 컵에 쌓임 (UI 표시), 채점은 recipe 길이만큼 위치 비교
//   · 채점 : 정확도 100점 + 시간 보너스 0~15점 = 최대 100점 (cap)
//     - accuracyScore = round((correct / total) × 100)   0~100
//     - timeBonus :
//         · remainingSec ≤ 20  → 0
//         · remainingSec ≥ 40  → 15 (만점)
//         · 그 사이           → 선형 보간
//     - finalScore = min(100, accuracyScore + timeBonus)
//     - 완벽 (정확도 100) 이면 시간 무관 무조건 100점
//   · 시간 제한 45초, 초과 시 자동 채점 (지금까지 쌓은 상태로)
//
// 확률 :
//   · 음료 : 층 수별 가중치 (3층 0.7 / 4층 1.0 / 5층 1.3)
//            + 핫 부스트 (카푸치노 · 핫초코 각 +0.5)
//   · 모디파이어 : 없음 30% / 1개 55% / 2개 15%
//                  카테고리 상호 배제 (같은 축의 +/− 는 동시에 안 나옴)

/* ═══════════════════════════════════════════════════════════
 * 재료 정의 (10종)
 * ─────────────────────────────────────────────────────────── */

export type IngredientKey =
  | "ice"
  | "milk"
  | "espresso"
  | "choco_syrup"
  | "vanilla_syrup"
  | "caramel_syrup"
  | "whip"
  | "choco_powder"
  | "cream"
  | "fruit_jam"
  | "dark_chocolate";

export type Ingredient = {
  key:   IngredientKey;
  label: string; // 자판 · 레시피북 표시명
  color: string; // 컵 안 층 색 (그라디언트 계산의 원색)
  emoji?: string; // 층 안에 표시할 이모지 (다크초콜릿 전용, 텐션용)
};

// 각 재료의 표시 정보
export const INGREDIENTS: Record<IngredientKey, Ingredient> = {
  ice:            { key: "ice",            label: "얼음",       color: "#cfe8f2" },
  milk:           { key: "milk",           label: "우유",       color: "#f5f0e6" },
  espresso:       { key: "espresso",       label: "에스프레소", color: "#3b2418" },
  choco_syrup:    { key: "choco_syrup",    label: "초코시럽",   color: "#5a3020" },
  vanilla_syrup:  { key: "vanilla_syrup",  label: "바닐라시럽", color: "#e8d69a" },
  caramel_syrup:  { key: "caramel_syrup",  label: "캐러멜시럽", color: "#b47a3a" },
  whip:           { key: "whip",           label: "휘핑크림",   color: "#fff8ec" },
  choco_powder:   { key: "choco_powder",   label: "초코파우더", color: "#4a2a1c" },
  cream:          { key: "cream",          label: "생크림",     color: "#fbf5e3" },
  fruit_jam:      { key: "fruit_jam",      label: "과일청",     color: "#d94a6f" },
  dark_chocolate: { key: "dark_chocolate", label: "다크초콜릿", color: "#1f0f08", emoji: "🍫" },
};

// 자판 노출 순서 (11종). 5×3 그리드 마지막 4칸은 빈칸.
export const INGREDIENT_LIST: IngredientKey[] = [
  "ice",
  "milk",
  "espresso",
  "choco_syrup",
  "vanilla_syrup",
  "caramel_syrup",
  "whip",
  "choco_powder",
  "cream",
  "fruit_jam",
  "dark_chocolate",
];

/* ═══════════════════════════════════════════════════════════
 * 음료 정의 (8종)
 * ─────────────────────────────────────────────────────────── */

export type DrinkKey =
  | "americano"
  | "cafelatte"
  | "cappuccino"
  | "vanilla_latte"
  | "hot_chocolate"
  | "strawberry_latte"
  | "caramel_macchiato"
  | "cafe_mocha"
  | "raw_chocolate_latte";

export type Recipe = IngredientKey[]; // index 0 = 바닥, 마지막 = 상단

export type Drink = {
  key:    DrinkKey;
  label:  string; // 오더 티켓 · 레시피북 표시명
  recipe: Recipe;
  /**
   * 오더 생성 시 base recipe 위에 다크초콜릿을 랜덤 개수 (1~3개) 삽입.
   * 생초코라떼 전용 플래그. choco_syrup 뒤에 순차 삽입됨 (없으면 최상단).
   */
  randomChocolate?: boolean;
};

// v11 §8-1 확정 레시피 (배열 순서 = 컵 바닥부터 상단까지)
export const DRINKS: Record<DrinkKey, Drink> = {
  americano: {
    key:    "americano",
    label:  "아메리카노",
    recipe: ["ice", "espresso", "ice"],
  },
  cafelatte: {
    key:    "cafelatte",
    label:  "카페라떼",
    recipe: ["ice", "espresso", "milk"],
  },
  cappuccino: {
    key:    "cappuccino",
    label:  "카푸치노",
    recipe: ["espresso", "milk", "choco_powder"],
  },
  vanilla_latte: {
    key:    "vanilla_latte",
    label:  "바닐라라떼",
    recipe: ["ice", "vanilla_syrup", "espresso", "milk"],
  },
  hot_chocolate: {
    key:    "hot_chocolate",
    label:  "핫초코",
    recipe: ["milk", "choco_syrup", "choco_powder", "whip"],
  },
  strawberry_latte: {
    key:    "strawberry_latte",
    label:  "딸기라떼",
    recipe: ["ice", "fruit_jam", "milk", "cream"],
  },
  caramel_macchiato: {
    key:    "caramel_macchiato",
    label:  "카라멜마키아토",
    recipe: ["ice", "caramel_syrup", "espresso", "milk", "whip"],
  },
  cafe_mocha: {
    key:    "cafe_mocha",
    label:  "카페모카",
    recipe: ["ice", "choco_syrup", "espresso", "milk", "whip"],
  },
  raw_chocolate_latte: {
    key:             "raw_chocolate_latte",
    label:           "생초코라떼",
    // base 는 초콜릿 없이 정의. 오더 생성 시 랜덤 1~3개 삽입됨.
    // 레시피북에는 이 base 를 그대로 표시. 실제 정답은 recipe 필드로 별도 관리.
    recipe:          ["ice", "milk", "choco_syrup", "whip"],
    randomChocolate: true,
  },
};

// 랜덤 픽 대상 (레시피북 정렬 순서로도 사용).
// 층수 낮은 것 → 많은 것 순 (사용자가 레시피북 훑을 때 자연스러운 흐름).
// 생초코라떼는 base 4층이지만 초콜릿 랜덤 삽입으로 실제 5~7층 → 마지막 배치.
export const DRINK_LIST: DrinkKey[] = [
  "americano",           // 3층
  "cafelatte",           // 3층
  "cappuccino",          // 3층
  "vanilla_latte",       // 4층
  "hot_chocolate",       // 4층
  "strawberry_latte",    // 4층
  "caramel_macchiato",   // 5층
  "cafe_mocha",          // 5층
  "raw_chocolate_latte", // 5~7층 (랜덤)
];

/* ═══════════════════════════════════════════════════════════
 * 모디파이어 정의 (7종, 특수 요청)
 *
 * · 카테고리 상호 배제: 같은 카테고리 내 +/− 는 동시에 안 나옴
 *   (샷 추가 + 샷 빼기 같은 모순 방지)
 * · 각 음료별 적용 가능 모디파이어는 base recipe 재료 기반 자동 판정
 * ─────────────────────────────────────────────────────────── */

export type ModifierKey =
  | "extra_ice"
  | "no_ice"
  | "extra_shot"
  | "no_shot"
  | "extra_whip"
  | "no_whip"
  | "extra_syrup"
  | "no_chocolate";

export type ModifierCategory = "ice" | "shot" | "whip" | "syrup" | "chocolate";

export type Modifier = {
  key:      ModifierKey;
  label:    string;           // "얼음 추가" 풀 표기
  short:    string;           // "+얼음"    배지용 짧은 표기
  category: ModifierCategory; // 상호 배제 판정용
};

export const MODIFIERS: Record<ModifierKey, Modifier> = {
  extra_ice:    { key: "extra_ice",    label: "얼음 추가",    short: "+얼음",    category: "ice"       },
  no_ice:       { key: "no_ice",       label: "얼음 빼기",    short: "-얼음",    category: "ice"       },
  extra_shot:   { key: "extra_shot",   label: "샷 추가",      short: "+샷",      category: "shot"      },
  no_shot:      { key: "no_shot",      label: "샷 빼기",      short: "-샷",      category: "shot"      },
  extra_whip:   { key: "extra_whip",   label: "휘핑 추가",    short: "+휘핑",    category: "whip"      },
  no_whip:      { key: "no_whip",      label: "휘핑 빼기",    short: "-휘핑",    category: "whip"      },
  extra_syrup:  { key: "extra_syrup",  label: "시럽 두 배",   short: "×2 시럽",  category: "syrup"     },
  no_chocolate: { key: "no_chocolate", label: "초콜릿 빼기",  short: "-초콜릿",  category: "chocolate" },
};

const SYRUP_INGREDIENTS: IngredientKey[] = [
  "vanilla_syrup",
  "caramel_syrup",
  "choco_syrup",
  "fruit_jam", // 청 계열이지만 시럽류로 취급
];

/**
 * base recipe 를 보고 이 음료에 적용 가능한 모디파이어 목록 반환.
 * · ice   있음 → extra_ice, no_ice
 * · espresso 있음 → extra_shot, no_shot
 * · whip  있음 → extra_whip, no_whip
 * · whip  없음 → extra_whip 만 (원래 없는 음료에도 추가 가능)
 * · 시럽 있음 → extra_syrup
 * · 다크초콜릿 있음 → no_chocolate (생초코라떼 전용)
 */
export function getApplicableModifiers(base: Recipe): ModifierKey[] {
  const result: ModifierKey[] = [];
  if (base.includes("ice"))            result.push("extra_ice", "no_ice");
  if (base.includes("espresso"))       result.push("extra_shot", "no_shot");
  if (base.includes("whip"))           result.push("extra_whip", "no_whip");
  else                                  result.push("extra_whip");
  if (base.some((r) => SYRUP_INGREDIENTS.includes(r))) result.push("extra_syrup");
  if (base.includes("dark_chocolate")) result.push("no_chocolate");
  return result;
}

/**
 * base recipe 에 모디파이어들을 순서대로 적용해 최종 정답 recipe 생성.
 *
 * 규칙:
 *   · extra_X : 마지막 X 위치 뒤에 하나 삽입. X 없으면 규칙별 fallback.
 *   · no_X    : X 를 배열에서 모두 제거.
 *   · extra_syrup : 시럽 계열 (SYRUP_INGREDIENTS) 중 배열에 있는 것을
 *                   찾아 마지막 위치 뒤에 하나 삽입 (첫 매칭만).
 */
export function applyModifiers(base: Recipe, mods: ModifierKey[]): Recipe {
  let recipe: IngredientKey[] = [...base];

  for (const mod of mods) {
    switch (mod) {
      case "extra_ice": {
        const i = recipe.lastIndexOf("ice");
        if (i >= 0) recipe.splice(i + 1, 0, "ice");
        else        recipe.unshift("ice");
        break;
      }
      case "no_ice": {
        recipe = recipe.filter((r) => r !== "ice");
        break;
      }
      case "extra_shot": {
        const i = recipe.lastIndexOf("espresso");
        if (i >= 0) recipe.splice(i + 1, 0, "espresso");
        break;
      }
      case "no_shot": {
        recipe = recipe.filter((r) => r !== "espresso");
        break;
      }
      case "extra_whip": {
        const i = recipe.lastIndexOf("whip");
        if (i >= 0) recipe.splice(i + 1, 0, "whip");
        else        recipe.push("whip"); // 최상단에 추가
        break;
      }
      case "no_whip": {
        recipe = recipe.filter((r) => r !== "whip");
        break;
      }
      case "extra_syrup": {
        for (const s of SYRUP_INGREDIENTS) {
          const i = recipe.lastIndexOf(s);
          if (i >= 0) {
            recipe.splice(i + 1, 0, s);
            break;
          }
        }
        break;
      }
      case "no_chocolate": {
        recipe = recipe.filter((r) => r !== "dark_chocolate");
        break;
      }
    }
  }

  return recipe;
}

/* ═══════════════════════════════════════════════════════════
 * 오더 생성 (가중치 + 모디파이어)
 * ─────────────────────────────────────────────────────────── */

export type MixOrder = {
  drink:      DrinkKey;
  label:      string;         // 손님 표시용
  baseRecipe: Recipe;          // 원본 레시피 (레시피북 표시용)
  recipe:     Recipe;          // 실제 정답 (모디파이어 적용된)
  modifiers:  ModifierKey[];   // 적용된 모디파이어 목록 (0~2개)
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 층 수 · 핫 부스트 · 특수 음료 가중치 (v11 §8-1 확장).
 * 3층 0.7 · 4층 1.0 · 5층 1.3
 * 카푸치노 · 핫초코 각 +0.5 (핫 부스트)
 * 생초코라떼 : base 4층이지만 초콜릿 랜덤 삽입으로 실제 5~7층 → 0.8 (약간 낮게)
 */
function getDrinkWeight(drink: DrinkKey): number {
  if (drink === "raw_chocolate_latte") return 0.8;

  const layers = DRINKS[drink].recipe.length;
  let weight = 1.0;
  if (layers === 3)      weight = 0.7;
  else if (layers === 5) weight = 1.3;
  if (drink === "cappuccino" || drink === "hot_chocolate") {
    weight += 0.5;
  }
  return weight;
}

/**
 * 가중치 기반 랜덤 픽. 모든 가중치가 0 이면 균등 fallback.
 */
function pickWeighted<T>(items: T[], getWeight: (item: T) => number): T {
  const weights = items.map(getWeight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return pick(items);
  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];
    if (rand < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * 다크초콜릿 랜덤 삽입 (생초코라떼 전용).
 * · 개수 : 1 · 2 · 3 개 균등 확률
 * · 위치 : choco_syrup 마지막 등장 뒤에 순차 삽입. 없으면 배열 마지막에 추가.
 * · no_chocolate 모디파이어가 있으면 삽입 후에도 제거되지만, 이 함수 자체는
 *   base recipe 단계에서 실행되므로 modifier 처리 전에 이루어진다.
 */
function insertRandomChocolate(base: Recipe): Recipe {
  const count = 1 + Math.floor(Math.random() * 3); // 1~3
  const recipe: IngredientKey[] = [...base];
  const anchor = recipe.lastIndexOf("choco_syrup");
  const insertAt = anchor >= 0 ? anchor + 1 : recipe.length;
  const chocolates: IngredientKey[] = Array(count).fill("dark_chocolate");
  recipe.splice(insertAt, 0, ...chocolates);
  return recipe;
}

/**
 * 모디파이어 개수 확률: 없음 30% / 1개 55% / 2개 15%.
 * 카테고리 상호 배제 자동 처리.
 */
function pickModifiers(base: Recipe): ModifierKey[] {
  const rand = Math.random();
  let count: number;
  if (rand < 0.3)      count = 0;
  else if (rand < 0.85) count = 1;
  else                  count = 2;

  if (count === 0) return [];

  const applicable = getApplicableModifiers(base);
  if (applicable.length === 0) return [];

  const picked: ModifierKey[] = [];
  const usedCategories = new Set<ModifierCategory>();

  for (let i = 0; i < count; i++) {
    // 이미 사용된 카테고리는 제외 (상호 배제)
    const candidates = applicable.filter(
      (m) => !usedCategories.has(MODIFIERS[m].category)
    );
    if (candidates.length === 0) break;
    const chosen = pick(candidates);
    picked.push(chosen);
    usedCategories.add(MODIFIERS[chosen].category);
  }

  return picked;
}

/**
 * 손님 한 명의 랜덤 오더 생성.
 * · 음료 : 가중치 기반 (getDrinkWeight)
 * · 다크초콜릿 : randomChocolate 플래그가 있는 음료면 recipe 계산 시 1~3개 삽입
 *   (모디파이어 판정에도 이 초콜릿이 반영됨 → no_chocolate 가능)
 * · 모디파이어 : 없음 30% / 1개 55% / 2개 15%, 카테고리 배제
 *
 * baseRecipe : 레시피북에 표시되는 "원본" 레시피 (초콜릿 미포함).
 * recipe     : 실제 정답 (초콜릿 삽입 + 모디파이어 적용).
 */
export function generateOrder(): MixOrder {
  const key          = pickWeighted(DRINK_LIST, getDrinkWeight);
  const drink        = DRINKS[key];
  const originalBase = drink.recipe;

  // 모디파이어 판정 · recipe 계산의 시작점으로 초콜릿 삽입 반영본 사용
  const baseWithChocolate = drink.randomChocolate
    ? insertRandomChocolate(originalBase)
    : originalBase;

  const modifiers = pickModifiers(baseWithChocolate);
  const recipe    = applyModifiers(baseWithChocolate, modifiers);

  return {
    drink:      key,
    label:      drink.label,
    baseRecipe: originalBase, // 레시피북 표시용 (초콜릿 없음)
    recipe,
    modifiers,
  };
}

/* ═══════════════════════════════════════════════════════════
 * 점수 계산
 *
 * 정확도 100점 만점 + 시간 보너스 0~15점 (임계값 · 짜게).
 * 최종 = min(100, 정확도 + 시간 보너스).
 *
 * 규칙:
 *   · 완벽 (정확도 100) 이면 시간 무관 무조건 100점 (사용자 원문 :
 *     "만점 받으면 100점 나와야 하는데")
 *   · 시간 보너스는 짜게 : 40초 이상 남기고 완성해야 만점 (15) 확보.
 *                            20초 이하로 떨어지면 0점 하한.
 *   · 시간 보너스는 오답을 회복시키는 "여지" 로 작동 (완벽 아니어도
 *     빨리 완성하면 부분 회복). 다만 짜서 완전 회복은 어려움.
 * ─────────────────────────────────────────────────────────── */

export const TIME_LIMIT_SEC        = 45;
export const TIME_BONUS_MAX        = 15;
export const TIME_BONUS_FLOOR_SEC  = 20; // 이하면 보너스 0
export const TIME_BONUS_CEIL_SEC   = 40; // 이상이면 보너스 만점

export type MixFinalScore = {
  finalScore:    number; // 0~100
  accuracyScore: number; // 0~100 (정확도, cap 전)
  timeBonus:     number; // 0~TIME_BONUS_MAX
};

/**
 * 최종 점수 계산.
 *
 * · accuracyScore = round((correct / total) × 100)   0~100
 * · timeBonus :
 *     · remainingSec ≤ 20  → 0
 *     · remainingSec ≥ 40  → TIME_BONUS_MAX (15)
 *     · 그 사이           → round((remainingSec - 20) / 20 × 15)  선형 보간
 * · finalScore = min(100, accuracyScore + timeBonus)
 *
 * total 이 0 이면 accuracyScore 0, 시간 보너스만 반영 (cap 15).
 */
export function calculateFinalScore(
  correct: number,
  total: number,
  remainingSec: number,
): MixFinalScore {
  const acc = total === 0 ? 0 : Math.round((correct / total) * 100);

  const remainClamped = Math.max(0, Math.min(TIME_LIMIT_SEC, remainingSec));
  let bonus: number;
  if (remainClamped <= TIME_BONUS_FLOOR_SEC) {
    bonus = 0;
  } else if (remainClamped >= TIME_BONUS_CEIL_SEC) {
    bonus = TIME_BONUS_MAX;
  } else {
    const range   = TIME_BONUS_CEIL_SEC - TIME_BONUS_FLOOR_SEC; // 20
    const inRange = remainClamped - TIME_BONUS_FLOOR_SEC;
    bonus = Math.round((inRange / range) * TIME_BONUS_MAX);
  }

  return {
    finalScore:    Math.min(100, acc + bonus),
    accuracyScore: acc,
    timeBonus:     bonus,
  };
}

/* ═══════════════════════════════════════════════════════════
 * 채점
 * ─────────────────────────────────────────────────────────── */

export type MixScoreResult = {
  score:   number;         // 0~100
  correct: number;         // 위치별 정답 수
  total:   number;         // recipe 길이
  hits:    boolean[];      // 위치별 정답/오답 (recipe 길이만큼)
};

/**
 * 위치별 채점 (v11 §8-1 확정 규칙).
 *
 * · recipe 각 위치 i 에 대해 input[i] === recipe[i] 이면 정답.
 * · input 이 recipe 보다 짧으면 부족한 위치는 undefined 로 자동 오답.
 * · input 이 recipe 보다 길어도 초과분은 채점 대상 아님 (오답도 컵에 쌓이지만
 *   채점은 recipe 길이만큼만).
 *
 * 예:
 *   recipe = ["ice", "espresso", "milk"]        (카페라떼)
 *   input  = ["ice", "milk",     "espresso"]    → correct=1 (0번 위치만), score=33
 *   input  = ["ice", "espresso", "milk", "whip"] → correct=3, score=100 (초과 whip 무시)
 *   input  = ["ice", "espresso"]                 → correct=2, score=67 (마지막 위치 미입력)
 */
export function scoreLayers(recipe: Recipe, input: IngredientKey[]): MixScoreResult {
  const total = recipe.length;
  const hits: boolean[] = [];
  let correct = 0;

  for (let i = 0; i < total; i++) {
    const ok = input[i] === recipe[i];
    hits.push(ok);
    if (ok) correct++;
  }

  const score = total === 0 ? 0 : Math.round((correct / total) * 100);
  return { score, correct, total, hits };
}

/* ═══════════════════════════════════════════════════════════
 * 표시 헬퍼
 * ─────────────────────────────────────────────────────────── */

/**
 * 레시피를 사람이 읽는 문장으로 변환.
 * 레시피북 카드 · 리워드 팝업 breakdown · resultDetail 저장용.
 * 배열은 바닥→상단 순이므로 그대로 화살표로 이어붙이면 쌓는 순서가 됨.
 */
export function recipeToText(recipe: Recipe): string {
  return recipe.map((k) => INGREDIENTS[k].label).join(" → ");
}

/**
 * 유저 입력을 문자열 배열로 (resultDetail.input_layers 저장용).
 */
export function inputToLabels(input: IngredientKey[]): string[] {
  return input.map((k) => INGREDIENTS[k]?.label ?? k);
}

/**
 * 아이스 음료 판정: 레시피에 얼음이 하나라도 포함되면 아이스잔.
 * 컴포넌트에서 컵 SVG 를 머그 vs 아이스잔으로 분기할 때 사용.
 *
 * 8종 분류 (v11 §8-1 레시피 기준):
 *   · 아이스잔 (6종): 아메리카노, 카페라떼, 바닐라라떼, 딸기라떼,
 *                     카라멜마키아토, 카페모카
 *   · 머그컵   (2종): 카푸치노, 핫초코
 */
export function isIcedDrink(recipe: Recipe): boolean {
  return recipe.includes("ice");
}

/**
 * 레시피북 검색: 음료 이름(label) · 재료 이름(label) · 재료 key 로 부분 일치.
 * 대소문자 무시. 공백 트리밍.
 *
 * @param query 유저가 입력한 검색어 (빈 문자열이면 전체 반환)
 */
export function searchDrinks(query: string): DrinkKey[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...DRINK_LIST];

  return DRINK_LIST.filter((k) => {
    const d = DRINKS[k];
    // 음료명 매치
    if (d.label.toLowerCase().includes(q)) return true;
    // 재료명 매치
    return d.recipe.some((ing) => {
      const info = INGREDIENTS[ing];
      return (
        info.label.toLowerCase().includes(q) ||
        info.key.toLowerCase().includes(q)
      );
    });
  });
}