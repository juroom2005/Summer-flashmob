// lib/gm-shop-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// GM 상점 관리 헬퍼
// ═══════════════════════════════════════════════════════════════════
//
// 대상 테이블: public.shop_items
// 스키마    : sql/applied/2026-07-20_shop_init.sql
//             (또는 그와 등가인 초기 세팅)
// RLS       : sql/applied/2026-07-27_shop_gm_policies.sql
//             · SELECT · INSERT · UPDATE · DELETE 각 정책이
//               profiles.is_gm = true 인 계정만 허용
//
// 방침 (v9 · 세션 G notices 패턴 준용):
//   · RLS 로만 GM 판정. 프론트에서 is_gm 검사 실패해도 서버가 거부한다.
//   · CRUD 는 supabase.from("shop_items") 로 직접 처리 (RPC 없음).
//   · 유저측 조회/구매는 lib/shop-helpers.ts 가 담당. 본 파일과 분리.
//   · 예외는 catch 후 정규화된 결과 객체로 반환. try/catch 없이 분기 가능.
//   · 변경 성공 시 window.dispatchEvent("shop-items-changed") 발행.
//     유저측 상점 화면 등이 리슨해서 재조회 가능.
//
// 편집 가능 필드 (세션 I ③ 결정):
//   · name         (1 ~ 100 자)
//   · description  (0 ~ 500 자, null 허용)
//   · price        (정수, 0 이상 1_000_000 이하)
//   · image_url    (0 ~ 500 자, null 허용)
//   · is_active    (boolean 토글 = 내리기 · 올리기)
//
// 편집 잠금 필드 (본 세션 범위 밖):
//   · code · item_type · item_ref · metadata
//     → 아이템 추가 UI 를 만들 때 함께 다룬다.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// ────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────

/** shop_items.item_type CHECK 제약과 일치 */
export type ShopItemType =
  | "marker"
  | "sticker"
  | "wallpaper"
  | "refill_ink"
  | "other";

/**
 * GM 화면에서 다루는 아이템 전체 형상.
 * 유저측 ShopItemRow (shop-helpers) 와 달리 관리용 필드까지 포함.
 */
export type GmShopItem = {
  id:          string;
  code:        string;
  name:        string;
  description: string | null;
  itemType:    ShopItemType;
  itemRef:     string;
  imageUrl:    string | null;
  price:       number;
  isActive:    boolean;
  metadata:    Record<string, unknown>;
  createdAt:   string;
  updatedAt:   string;
};

type GmShopItemRow = {
  id:          string;
  code:        string;
  name:        string;
  description: string | null;
  item_type:   string;
  item_ref:    string;
  image_url:   string | null;
  price:       number;
  is_active:   boolean;
  metadata:    Record<string, unknown> | null;
  created_at:  string;
  updated_at:  string;
};

/** 편집 페이로드. 부분 업데이트를 위해 모든 필드 optional. */
export type ShopItemPatch = {
  name?:        string;
  description?: string | null;
  price?:       number;
  imageUrl?:    string | null;
};

// ────────────────────────────────────────────────────────────────────
// 응답 타입
// ────────────────────────────────────────────────────────────────────

export type ShopItemMutationResult =
  | { ok: true;  item: GmShopItem }
  | { ok: false; reason: "validation" | "unauthorized" | "not_found" | "unknown"; message: string };

export type ShopItemDeleteResult =
  | { ok: true }
  | { ok: false; reason: "unauthorized" | "not_found" | "unknown"; message: string };

// ────────────────────────────────────────────────────────────────────
// 제약 상수 (UI 재사용 목적으로 export)
// ────────────────────────────────────────────────────────────────────

export const SHOP_NAME_MAX_LEN     = 100;
export const SHOP_DESC_MAX_LEN     = 500;
export const SHOP_IMAGE_URL_MAX    = 500;
export const SHOP_PRICE_MIN        = 0;
export const SHOP_PRICE_MAX        = 10_000_000;

/** GM UI 에서 item_type 필터 · 라벨로 재사용 */
export const SHOP_ITEM_TYPE_LABEL: Record<ShopItemType, string> = {
  marker:     "사인펜",
  sticker:    "스티커",
  wallpaper:  "배경지",
  refill_ink: "잉크 리필",
  other:      "기타",
};

// ────────────────────────────────────────────────────────────────────
// 내부 유틸
// ────────────────────────────────────────────────────────────────────

function toGmShopItem(row: GmShopItemRow | null | undefined): GmShopItem | null {
  if (!row) return null;

  // item_type 은 DB CHECK 로 방어되지만, 앱에서도 화이트리스트 검증.
  const validTypes: readonly ShopItemType[] = [
    "marker", "sticker", "wallpaper", "refill_ink", "other",
  ] as const;
  const itemType = (validTypes as readonly string[]).includes(row.item_type)
    ? (row.item_type as ShopItemType)
    : "other";

  return {
    id:          row.id,
    code:        row.code,
    name:        row.name,
    description: row.description,
    itemType,
    itemRef:     row.item_ref,
    imageUrl:    row.image_url,
    price:       row.price,
    isActive:    row.is_active,
    metadata:    row.metadata ?? {},
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

function isRlsError(err: { code?: string; message?: string }): boolean {
  const code = err?.code ?? "";
  const msg  = (err?.message ?? "").toLowerCase();
  return code === "42501" || msg.includes("row-level security") || msg.includes("policy");
}

function isNotFoundError(err: { code?: string }): boolean {
  // PGRST116 : "The result contains 0 rows" (PostgREST single/maybeSingle)
  return err?.code === "PGRST116";
}

function broadcastChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("shop-items-changed"));
  }
}

function validatePatch(patch: ShopItemPatch): string | null {
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 1)                     return "이름을 입력해 주십시오.";
    if (name.length > SHOP_NAME_MAX_LEN)     return `이름은 ${SHOP_NAME_MAX_LEN}자 이하로 입력해 주십시오.`;
  }

  if (patch.description !== undefined && patch.description !== null) {
    const desc = patch.description;
    if (desc.length > SHOP_DESC_MAX_LEN)     return `설명은 ${SHOP_DESC_MAX_LEN}자 이하로 입력해 주십시오.`;
  }

  if (patch.imageUrl !== undefined && patch.imageUrl !== null) {
    const url = patch.imageUrl.trim();
    if (url.length > SHOP_IMAGE_URL_MAX)     return `이미지 URL은 ${SHOP_IMAGE_URL_MAX}자 이하로 입력해 주십시오.`;
  }

  if (patch.price !== undefined) {
    if (!Number.isFinite(patch.price) || !Number.isInteger(patch.price)) {
      return "가격은 정수여야 합니다.";
    }
    if (patch.price < SHOP_PRICE_MIN)        return "가격은 0 이상이어야 합니다.";
    if (patch.price > SHOP_PRICE_MAX)        return `가격은 ${SHOP_PRICE_MAX.toLocaleString()} 이하로 입력해 주십시오.`;
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────
// 조회 (GM 전용 · 활성/비활성 전체)
// ────────────────────────────────────────────────────────────────────

/**
 * shop_items 전체 목록.
 * 정렬: is_active DESC (활성 먼저) → item_type ASC → price ASC → created_at ASC.
 * 오류 시 빈 배열 + 콘솔 경고.
 *
 * RLS 가 GM 이 아니면 SELECT 자체를 활성 아이템만 노출하므로,
 * GM 이 아닐 때는 유저측과 동일한 결과가 오게 되어 있다 (안전 기본값).
 */
export async function listAllShopItems(): Promise<GmShopItem[]> {
  const { data, error } = await supabase
    .from("shop_items")
    .select(
      "id, code, name, description, item_type, item_ref, image_url, price, is_active, metadata, created_at, updated_at",
    )
    .order("is_active", { ascending: false })
    .order("item_type", { ascending: true })
    .order("price",     { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[gm-shop] list failed:", error);
    return [];
  }
  if (!Array.isArray(data)) return [];

  const result: GmShopItem[] = [];
  for (const r of data as GmShopItemRow[]) {
    const it = toGmShopItem(r);
    if (it) result.push(it);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────
// 수정 (부분 업데이트)
// ────────────────────────────────────────────────────────────────────

/**
 * 아이템 부분 업데이트. patch 에 있는 필드만 갱신된다.
 * 편집 잠금 필드 (code · item_type · item_ref · metadata) 는 처리하지 않음.
 *
 * updated_at 은 DB 트리거 (shop_items_set_updated_at) 가 자동 갱신.
 */
export async function updateShopItem(
  id: string,
  patch: ShopItemPatch,
): Promise<ShopItemMutationResult> {
  if (!id) {
    return { ok: false, reason: "validation", message: "잘못된 아이템입니다." };
  }
  const err = validatePatch(patch);
  if (err) return { ok: false, reason: "validation", message: err };

  // 실제 DB 로 보낼 페이로드 (컬럼명 매핑 + 공백 트리밍)
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined)        payload.name        = patch.name.trim();
  if (patch.description !== undefined) payload.description = patch.description === null ? null : patch.description.trim();
  if (patch.imageUrl !== undefined)    payload.image_url   = patch.imageUrl === null ? null : patch.imageUrl.trim() || null;
  if (patch.price !== undefined)       payload.price       = patch.price;

  if (Object.keys(payload).length === 0) {
    return { ok: false, reason: "validation", message: "변경 사항이 없습니다." };
  }

  const { data, error } = await supabase
    .from("shop_items")
    .update(payload)
    .eq("id", id)
    .select(
      "id, code, name, description, item_type, item_ref, image_url, price, is_active, metadata, created_at, updated_at",
    )
    .single();

  if (error) {
    console.warn("[gm-shop] update failed:", error);
    if (isRlsError(error))     return { ok: false, reason: "unauthorized", message: "권한이 없습니다." };
    if (isNotFoundError(error)) return { ok: false, reason: "not_found",    message: "아이템을 찾을 수 없습니다." };
    return { ok: false, reason: "unknown", message: "수정에 실패했습니다. 잠시 후 다시 시도해 주십시오." };
  }

  const item = toGmShopItem(data as GmShopItemRow);
  if (!item) {
    return { ok: false, reason: "unknown", message: "수정은 완료되었으나 응답이 유효하지 않습니다." };
  }

  broadcastChange();
  return { ok: true, item };
}

// ────────────────────────────────────────────────────────────────────
// 활성 상태 토글 (내리기 · 올리기)
// ────────────────────────────────────────────────────────────────────

/**
 * is_active 명시적으로 지정.
 * · false → 상점에서 내림 (구매 이력 · 유저 인벤토리 그대로 유지)
 * · true  → 상점에 다시 노출
 */
export async function setShopItemActive(
  id: string,
  active: boolean,
): Promise<ShopItemMutationResult> {
  if (!id) {
    return { ok: false, reason: "validation", message: "잘못된 아이템입니다." };
  }

  const { data, error } = await supabase
    .from("shop_items")
    .update({ is_active: active })
    .eq("id", id)
    .select(
      "id, code, name, description, item_type, item_ref, image_url, price, is_active, metadata, created_at, updated_at",
    )
    .single();

  if (error) {
    console.warn("[gm-shop] setActive failed:", error);
    if (isRlsError(error))     return { ok: false, reason: "unauthorized", message: "권한이 없습니다." };
    if (isNotFoundError(error)) return { ok: false, reason: "not_found",    message: "아이템을 찾을 수 없습니다." };
    return { ok: false, reason: "unknown", message: "상태 변경에 실패했습니다." };
  }

  const item = toGmShopItem(data as GmShopItemRow);
  if (!item) {
    return { ok: false, reason: "unknown", message: "상태 변경은 완료되었으나 응답이 유효하지 않습니다." };
  }

  broadcastChange();
  return { ok: true, item };
}

// ────────────────────────────────────────────────────────────────────
// 삭제
// ────────────────────────────────────────────────────────────────────

/**
 * 아이템 완전 삭제.
 *
 * shop_purchases.shop_item_id 는 ON DELETE SET NULL 이므로 :
 *   · 구매 이력은 그대로 유지되며 shop_item_id 만 null 처리
 *   · item_code · item_name · item_type · price_paid 는 이력 컬럼으로 남아있어
 *     사후 조회 가능
 *
 * 그러나 되돌릴 수 없으므로 UI 에서 별도 확인 절차 필수.
 * 되돌릴 여지가 필요하면 setShopItemActive(id, false) 로 "내리기" 를 권장.
 */
export async function deleteShopItem(id: string): Promise<ShopItemDeleteResult> {
  if (!id) {
    return { ok: false, reason: "unknown", message: "잘못된 아이템입니다." };
  }

  const { error } = await supabase
    .from("shop_items")
    .delete()
    .eq("id", id);

  if (error) {
    console.warn("[gm-shop] delete failed:", error);
    if (isRlsError(error))     return { ok: false, reason: "unauthorized", message: "권한이 없습니다." };
    return { ok: false, reason: "unknown", message: "삭제에 실패했습니다." };
  }

  broadcastChange();
  return { ok: true };
}