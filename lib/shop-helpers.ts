// lib/shop-helpers.ts
//
// 매점 카탈로그 조회 · 구매 · 인벤토리 상태 조회 헬퍼.
//
// 스키마: sql/2026-07-20_shop_init.sql
// RPC 확장: sql/applied/2026-07-27_shop_other_type_purchase.sql
//   · purchase_shop_item 이 item_type = 'other' (이벤트성 아이템) 지원 추가
//
// 방침:
//   · 구매 성공 시 window.dispatchEvent("profile-changed") 로 알림
//     → useCurrentUser 등이 리슨하여 mobil 잔액을 재조회
//   · 예외는 catch 후 { ok:false, reason, message } 로 정규화
//     → 호출부가 try/catch 없이 분기 가능

import { supabase } from "./supabase";

export type ShopItemRow = {
  id:          string;
  code:        string;
  name:        string;
  description: string | null;
  item_type:   "marker" | "sticker" | "wallpaper" | "refill_ink" | "other" | "camera";
  item_ref:    string;
  image_url:   string | null;
  price:       number;
  metadata:    Record<string, unknown>;
};

/* ═══════════════════════════════════════════════════════════
 * 조회
 * ─────────────────────────────────────────────────────────── */

/**
 * 활성 카탈로그 조회.
 * 정렬: item_type ASC, price ASC.
 * RLS shop_items_select_all 로 is_active=true 만 노출됨.
 */
export async function listShopItems(): Promise<ShopItemRow[]> {
  const { data, error } = await supabase
    .from("shop_items")
    .select("id, code, name, description, item_type, item_ref, image_url, price, metadata")
    .eq("is_active", true)
    .order("item_type", { ascending: true })
    .order("price",     { ascending: true });

  if (error || !data) {
    console.error("[listShopItems] failed:", error?.message);
    return [];
  }
  return (data as ShopItemRow[]).filter(
    (it) => (it.metadata as Record<string, unknown> | null)?.slot_reward !== true,
  );
}

export async function listMyStickerRefs(): Promise<string[]> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (!profile) return [];

  const { data, error } = await supabase
    .from("inventory_items")
    .select("item_ref")
    .eq("profile_id", profile.id)
    .eq("item_type",  "sticker");

  if (error || !data) return [];

  return (data as Array<{ item_ref: string | null }>)
    .map((r) => r.item_ref)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}


/* ═══════════════════════════════════════════════════════════
 * 구매
 * ─────────────────────────────────────────────────────────── */

export type PurchaseResult =
  | { ok: true;  nextMobil: number }
  | { ok: false; reason: string; message: string };

const PURCHASE_ERROR_MESSAGES: Record<string, string> = {
  auth_required:            "로그인이 필요합니다.",
  profile_not_found:        "프로필 정보를 확인할 수 없습니다.",
  item_not_found:           "상품을 찾을 수 없습니다.",
  item_inactive:            "판매하지 않는 상품입니다.",
  insufficient_mobil:       "잔액이 부족합니다.",
  duplicate_sticker:        "이미 소지한 스티커입니다.",
  duplicate_camera:         "이미 사진기를 가지고 있습니다.",
  unsupported_item_type:    "구매할 수 없는 상품 유형입니다.",
  // 세션 I 추가 : purchase_shop_item RPC 의 other 분기가 item_ref 를 요구.
  // shop_items.item_ref 는 NOT NULL 이지만 이중 방어 차원의 예외이므로
  // 유저에게는 상품 설정 오류로 안내한다.
  other_item_missing_ref:   "상품 설정이 올바르지 않습니다. 운영진에게 문의해 주십시오.",
};

function normalizePurchaseError(message: string | undefined): {
  reason:  string;
  message: string;
} {
  const raw = (message ?? "").trim();
  for (const code of Object.keys(PURCHASE_ERROR_MESSAGES)) {
    if (raw.includes(code)) {
      return { reason: code, message: PURCHASE_ERROR_MESSAGES[code] };
    }
  }
  return {
    reason:  "unknown",
    message: "구매 처리 중 오류가 발생하였습니다. 잠시 후 다시 시도해주십시오.",
  };
}

/**
 * 구매 실행. RPC purchase_shop_item 호출.
 *
 * 성공 시:
 *   · nextMobil 반환 (조정 후 잔액)
 *   · window "profile-changed" 이벤트 발행 → useCurrentUser 등이 재조회
 *
 * 서버 처리 (RPC 참고):
 *   · profiles FOR UPDATE 로 잔액 잠금 (동시 구매 이중 차감 방지)
 *   · marker: inventory_items 새 행 + durability 초기값
 *   · sticker: 중복 시 duplicate_sticker 예외
 *   · other  : 같은 item_ref 있으면 quantity 누적, 없으면 새 행 (세션 I 확장)
 *   · shop_purchases 이력 자동 기록
 */
export async function purchaseShopItem(
  shopItemId: string
): Promise<PurchaseResult> {
  const { data, error } = await supabase.rpc("purchase_shop_item", {
    p_shop_item_id: shopItemId,
  });

  if (error) {
    console.error("[purchaseShopItem] failed:", error.message);
    return { ok: false, ...normalizePurchaseError(error.message) };
  }

  // 프로필 변경 알림 브로드캐스트
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("profile-changed"));
  }

  return { ok: true, nextMobil: (data as number) ?? 0 };
}

/* ═══════════════════════════════════════════════════════════
 * 아이템 설명(description) 조회
 * ─────────────────────────────────────────────────────────── */

/**
 * item_ref → description 맵.
 *
 * 인벤토리 화면에서 아이템 설명 팝업을 띄우기 위한 용도.
 * listShopItems 와 달리 slot 보상(인형·교환권·잡템)도 포함해야 하므로
 * slot_reward 필터를 걸지 않는다.
 *
 * · RLS shop_items_select_all 로 is_active=true 만 노출됨
 *   → 비활성 처리된 아이템은 맵에 없고, 그 경우 호출측에서 "설명 없음"으로 처리.
 * · description 이 비어있으면(null·공백) 맵에 넣지 않는다
 *   → 호출측에서 has(ref) 만으로 "설명 있음" 판단 가능.
 * · 실패 시 빈 맵 (설명 못 불러와도 인벤토리 표시는 정상 진행).
 *
 * item_ref 는 유니크 제약이 없어 이론상 중복 가능하나, 실무상 종류별 고유.
 * 중복이면 먼저 조회된 값을 유지한다(뒤 값 무시).
 */
export async function getItemDescriptionMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const { data, error } = await supabase
    .from("shop_items")
    .select("item_ref, description")
    .eq("is_active", true);

  if (error || !data) {
    console.error("[getItemDescriptionMap] failed:", error?.message);
    return map;
  }

  for (const row of data as { item_ref: string | null; description: string | null }[]) {
    const ref = row.item_ref ?? "";
    if (!ref) continue;
    const desc = (row.description ?? "").trim();
    if (!desc) continue;
    if (!map.has(ref)) map.set(ref, desc);
  }
  return map;
}