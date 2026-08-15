// lib/inventory-helpers.ts
//
// 유저 인벤토리 조회 · 향후 사인펜 소모 등 조작을 담당.
//
// 이번 라운드 범위:
//   · listMyInventoryItems() 조회만
//   · 사인펜 사용 시 durability 감소, 0되면 자동 삭제 등은 다음 라운드
//     (일지 드로잉 기능 붙일 때 함께 진행)
//
// 안정성:
//   · 실패 시 빈 배열 반환 (표시 실패 < 잘못 표시가 안전)
//   · profile 조회 실패해도 빈 배열

import { supabase } from "./supabase";

export type InventoryItemType =
  | "marker"
  | "sticker"
  | "wallpaper"
  | "other"
  | "doll"
  | "coupon"
  | "junk";

export type InventoryItemRow = {
  id:          string;
  item_type:   InventoryItemType;
  item_ref:    string | null;
  quantity:    number;
  durability:  number | null;
  metadata:    Record<string, unknown>;
  acquired_at: string;
};

/** 파기 불가 타입 (기능성·수집성 아이템 보호). 서버 RPC 도 동일하게 거부. */
export const DISCARD_FORBIDDEN_TYPES: readonly InventoryItemType[] = [
  "marker",
  "sticker",
  "doll",
] as const;

export function isDiscardable(itemType: InventoryItemType): boolean {
  return !(DISCARD_FORBIDDEN_TYPES as readonly string[]).includes(itemType);
}

export type DiscardResult =
  | { ok: true; discarded: number; remaining: number }
  | {
      ok: false;
      reason:
        | "auth_required"
        | "discard_forbidden"
        | "invalid_count"
        | "invalid_item_ref"
        | "item_not_found"
        | "discard_too_many"
        | "profile_not_found"
        | "unknown";
    };

/**
 * 세션 유저 인벤토리 전체 조회.
 * 정렬: acquired_at DESC (최신 획득순).
 */
export async function listMyInventoryItems(): Promise<InventoryItemRow[]> {
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
    .select("id, item_type, item_ref, quantity, durability, metadata, acquired_at")
    .eq("profile_id", profile.id)
    .order("acquired_at", { ascending: false });

  if (error || !data) {
    console.error("[listMyInventoryItems] failed:", error?.message);
    return [];
  }
  return data as InventoryItemRow[];
}

// ────────────────────────────────────────────────────────────────────
// 파기 : discard_inventory_item RPC 래퍼
// ────────────────────────────────────────────────────────────────────
//
// 서버가 스택을 FOR UPDATE 로 잠그고 합계에서 count 만큼 차감한다.
// 파기 불가 타입(marker·sticker·doll)은 서버가 discard_forbidden 으로 거부.
// 재화성 삭제이므로, 애매한 실패는 절대 성공으로 처리하지 않는다.

const DISCARD_REASONS = [
  "auth_required",
  "discard_forbidden",
  "invalid_count",
  "invalid_item_ref",
  "item_not_found",
  "discard_too_many",
  "profile_not_found",
] as const;

function normalizeDiscardError(
  message: string | null | undefined,
): Exclude<DiscardResult & { ok: false }, { ok: true }>["reason"] {
  const msg = (message ?? "").toLowerCase();
  for (const r of DISCARD_REASONS) {
    if (msg.includes(r)) return r;
  }
  return "unknown";
}

export async function discardInventoryItem(
  itemType: InventoryItemType,
  itemRef: string,
  count: number,
): Promise<DiscardResult> {
  
  if (!isDiscardable(itemType)) {
    return { ok: false, reason: "discard_forbidden" };
  }
  if (!itemRef) {
    return { ok: false, reason: "invalid_item_ref" };
  }
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, reason: "invalid_count" };
  }

  const { data, error } = await supabase.rpc("discard_inventory_item", {
    p_item_type: itemType,
    p_item_ref:  itemRef,
    p_count:     count,
  });

  if (error) {
    const reason = normalizeDiscardError(error.message);
    console.warn("[inventory] discard failed:", reason, error.message);
    return { ok: false, reason };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; discarded?: number; remaining?: number }
    | null
    | undefined;

  if (!row || row.ok !== true || typeof row.discarded !== "number" || typeof row.remaining !== "number") {
    return { ok: false, reason: "unknown" };
  }

  // 인벤토리·프로필 동기화 신호 (다른 화면 재조회)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("profile-changed"));
  }

  return { ok: true, discarded: row.discarded, remaining: row.remaining };
}