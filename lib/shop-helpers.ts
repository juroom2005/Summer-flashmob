// lib/shop-helpers.ts
//
// 상점 카탈로그 조회 · 구매 · 인벤토리 상태 조회 헬퍼.
//
// 스키마: sql/2026-07-20_shop_init.sql
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
  item_type:   "marker" | "sticker" | "wallpaper" | "refill_ink" | "other";
  item_ref:    string;
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
    .select("id, code, name, description, item_type, item_ref, price, metadata")
    .eq("is_active", true)
    .order("item_type", { ascending: true })
    .order("price",     { ascending: true });

  if (error || !data) {
    console.error("[listShopItems] failed:", error?.message);
    return [];
  }
  return data as ShopItemRow[];
}

/**
 * 세션 유저가 이미 소지한 스티커 item_ref 목록.
 * 스티커 중복 구매 방지용 UI 표시에 사용.
 * 실패 시 빈 배열 (안전 기본값).
 */
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
  auth_required:         "로그인이 필요합니다.",
  profile_not_found:     "프로필 정보를 확인할 수 없습니다.",
  item_not_found:        "상품을 찾을 수 없습니다.",
  item_inactive:         "판매하지 않는 상품입니다.",
  insufficient_mobil:    "잔액이 부족합니다.",
  duplicate_sticker:     "이미 소지한 스티커입니다.",
  unsupported_item_type: "구매할 수 없는 상품 유형입니다.",
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