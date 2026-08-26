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
  | "junk"
  | "camera";

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
  "camera",
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
  // 클라 선방어 (서버도 재검증)
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

// ────────────────────────────────────────────────────────────────────
// 인형 교환권 사용 : redeem_doll_coupon RPC 래퍼
// ────────────────────────────────────────────────────────────────────
//
// 서버가 쿠폰 1개 차감 + 인형 풀에서 균등 랜덤 1개 지급을 원자 처리한다.
// 재화성이므로 애매한 실패는 성공으로 처리하지 않는다.

export type RedeemedDoll = {
  itemRef: string;
  name: string;
  imageUrl: string | null;
  emoji: string | null;
  remainingCoupons: number;
};

export type RedeemResult =
  | { ok: true; doll: RedeemedDoll }
  | {
      ok: false;
      reason:
        | "auth_required"
        | "profile_not_found"
        | "no_coupon"
        | "doll_pool_empty"
        | "unknown";
    };

const REDEEM_REASONS = [
  "auth_required",
  "profile_not_found",
  "no_coupon",
  "doll_pool_empty",
] as const;

function normalizeRedeemError(
  message: string | null | undefined,
): Exclude<RedeemResult & { ok: false }, { ok: true }>["reason"] {
  const msg = (message ?? "").toLowerCase();
  for (const r of REDEEM_REASONS) {
    if (msg.includes(r)) return r;
  }
  return "unknown";
}

export async function redeemDollCoupon(): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc("redeem_doll_coupon");

  if (error) {
    const reason = normalizeRedeemError(error.message);
    console.warn("[inventory] redeem doll coupon failed:", reason, error.message);
    return { ok: false, reason };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        ok?: boolean;
        item_ref?: string;
        name?: string;
        image_url?: string | null;
        emoji?: string | null;
        remaining_coupons?: number;
      }
    | null
    | undefined;

  if (!row || row.ok !== true || !row.item_ref) {
    return { ok: false, reason: "unknown" };
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("profile-changed"));
  }

  return {
    ok: true,
    doll: {
      itemRef: row.item_ref,
      name: row.name ?? "인형",
      imageUrl: row.image_url ?? null,
      emoji: (row.emoji ?? "").trim() === "" ? null : (row.emoji ?? null),
      remainingCoupons: typeof row.remaining_coupons === "number" ? row.remaining_coupons : 0,
    },
  };
}
// ────────────────────────────────────────────────────────────────────
// 이벤트/유틸성 아이템 "사용"
// ────────────────────────────────────────────────────────────────────
//
// 인벤토리에서 '사용' 버튼을 눌렀을 때 호출한다. 두 종류:
//   · 행동 충전(action_refill) : use_action_refill RPC.
//       오늘 미니게임 한도 +1 (하루 1회). 아이템 1개 차감.
//   · 그 외 이벤트 아이템(effect 지정) : use_event_item RPC.
//       예) 히나인형(effect=random_line) → 랜덤 대사 반환. 차감 없음.
//
// 어떤 아이템이 어떤 RPC 인지는 shop_items.metadata.effect 로 정해지고,
// 프론트는 그 effect 값에 따라 호출 함수를 고른다(isUsableEventItem 참고).
// 재화성 차감이 있는 action_refill 은 애매한 실패를 성공으로 처리하지 않는다.

/** metadata.effect 값 → 어떤 사용 흐름인지. shop seed 와 일치시킬 것. */
export type EventEffect = "action_refill" | "random_line";

/** 인벤토리 행이 '사용 가능한' 이벤트 아이템인지 판정 (other + effect 존재). */
export function isUsableEventItem(
  itemType: InventoryItemType,
  metadata: Record<string, unknown> | null | undefined,
): EventEffect | null {
  if (itemType !== "other") return null;
  const eff = metadata?.["effect"];
  if (eff === "action_refill" || eff === "random_line") return eff;
  return null;
}

// ── 행동 충전 : use_action_refill ──────────────────────────────────

export type ActionRefillResult =
  | { ok: true; bonusPlays: number; dailyLimit: number; remainingItem: number }
  | {
      ok: false;
      reason:
        | "auth_required"
        | "profile_not_found"
        | "already_used_today"
        | "no_item"
        | "unknown";
    };

const REFILL_REASONS = [
  "auth_required",
  "profile_not_found",
  "already_used_today",
  "no_item",
] as const;

function normalizeRefillError(
  message: string | null | undefined,
): Exclude<ActionRefillResult & { ok: false }, { ok: true }>["reason"] {
  const msg = (message ?? "").toLowerCase();
  for (const r of REFILL_REASONS) {
    if (msg.includes(r)) return r;
  }
  return "unknown";
}

export async function useActionRefill(): Promise<ActionRefillResult> {
  const { data, error } = await supabase.rpc("use_action_refill");

  if (error) {
    const reason = normalizeRefillError(error.message);
    console.warn("[inventory] use_action_refill failed:", reason, error.message);
    return { ok: false, reason };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; bonus_plays?: number; daily_limit?: number; remaining_item?: number }
    | null
    | undefined;

  if (!row || row.ok !== true) {
    return { ok: false, reason: "unknown" };
  }

  // 인벤토리 수량·미니게임 남은횟수 재조회 유도
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("profile-changed"));
  }

  return {
    ok: true,
    bonusPlays:    typeof row.bonus_plays === "number" ? row.bonus_plays : 0,
    dailyLimit:    typeof row.daily_limit === "number" ? row.daily_limit : 0,
    remainingItem: typeof row.remaining_item === "number" ? row.remaining_item : 0,
  };
}

// ── 일반 이벤트 아이템 : use_event_item (히나인형 등) ───────────────

export type UseEventItemResult =
  | { ok: true; effect: string; message: string }
  | {
      ok: false;
      reason:
        | "auth_required"
        | "profile_not_found"
        | "invalid_item_ref"
        | "no_item"
        | "no_effect"
        | "unsupported_effect"
        | "unknown";
    };

const USE_EVENT_REASONS = [
  "auth_required",
  "profile_not_found",
  "invalid_item_ref",
  "no_item",
  "no_effect",
  "unsupported_effect",
] as const;

function normalizeUseEventError(
  message: string | null | undefined,
): Exclude<UseEventItemResult & { ok: false }, { ok: true }>["reason"] {
  const msg = (message ?? "").toLowerCase();
  for (const r of USE_EVENT_REASONS) {
    if (msg.includes(r)) return r;
  }
  return "unknown";
}

/**
 * 이벤트 아이템 사용 (차감 없음). 히나인형처럼 사용 시 효과(랜덤 대사)를 반환.
 * @param itemRef inventory_items.item_ref (예: 'hina_doll')
 */
export async function useEventItem(itemRef: string): Promise<UseEventItemResult> {
  if (!itemRef) {
    return { ok: false, reason: "invalid_item_ref" };
  }

  const { data, error } = await supabase.rpc("use_event_item", {
    p_item_ref: itemRef,
  });

  if (error) {
    const reason = normalizeUseEventError(error.message);
    console.warn("[inventory] use_event_item failed:", reason, error.message);
    return { ok: false, reason };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; effect?: string; message?: string }
    | null
    | undefined;

  if (!row || row.ok !== true) {
    return { ok: false, reason: "unknown" };
  }

  return {
    ok: true,
    effect: row.effect ?? "",
    message: typeof row.message === "string" ? row.message : "...",
  };
}