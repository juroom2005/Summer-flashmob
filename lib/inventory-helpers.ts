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

export type InventoryItemRow = {
  id:          string;
  item_type:   "marker" | "sticker" | "wallpaper" | "other";
  item_ref:    string | null;
  quantity:    number;
  durability:  number | null;
  metadata:    Record<string, unknown>;
  acquired_at: string;
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