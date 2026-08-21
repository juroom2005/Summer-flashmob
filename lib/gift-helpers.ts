// lib/gift-helpers.ts
//
// 선물(양도) + 선물함 helper.
//
// 백엔드:
//   · 이동 코어 (v19, 무변경) : _transfer_mobil_core / _transfer_item_core.
//   · 선물함 래퍼 (2026-08-21_gift_inbox.sql) :
//       send_gift_mobil(p_to_profile_id, p_amount) → integer(잔액)
//       send_gift_item (p_to_profile_id, p_item_type, p_item_ref, p_qty, p_item_name) → void
//       list_my_gifts(p_limit)      → 받은 선물 목록
//       count_unread_gifts()        → 안읽은 개수
//       mark_gifts_read()           → 전체 읽음 처리
//     래퍼는 내부에서 기존 코어를 그대로 호출하고, 성공 시 gift_transfers 에
//     기록을 남긴다(이동+기록 한 트랜잭션 → "이동 성공 = 기록 존재" 보장).
//
// 이 helper 는 shop-helpers 의 purchaseShopItem 패턴을 따른다:
//   · supabase.rpc 호출 · 서버 예외코드 → 한글 정규화
//   · 성공 시 window "profile-changed" 이벤트 발행

import { supabase } from "./supabase";
import type { InventoryItemType } from "./inventory-helpers";

/* ═══════════════════════════════════════════════════════════
 * 수신자 목록
 * ─────────────────────────────────────────────────────────── */

/** 선물 대상 유저 1명. id 는 profiles.id (= RPC 의 p_to_profile_id). */
export type GiftRecipient = {
  id:        string;
  name:      string;
  avatarUrl: string | null;
  isGm:      boolean;
};

/**
 * 선물 가능한 수신자 전체 목록.
 * profiles 직접 조회(RLS profiles_select_all). 비활성·미등록·본인 제외.
 */
export async function listGiftRecipients(): Promise<GiftRecipient[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;

  let myProfileId: string | null = null;
  if (uid) {
    const { data: me } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();
    myProfileId = (me as { id: string } | null)?.id ?? null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, family_name, given_name, avatar_url, is_gm")
    .is("deactivated_at", null)
    .not("user_id", "is", null)
    .order("family_name", { ascending: true })
    .order("given_name", { ascending: true });

  if (error) {
    console.error("[listGiftRecipients] failed:", error.message);
    return [];
  }

  const rows = (data as Array<{
    id:          string;
    family_name: string | null;
    given_name:  string | null;
    avatar_url:  string | null;
    is_gm:       boolean | null;
  }> | null) ?? [];

  return rows
    .filter((r) => r.id !== myProfileId)
    .map((r) => {
      const fam  = (r.family_name ?? "").trim();
      const giv  = (r.given_name ?? "").trim();
      const name = [fam, giv].filter(Boolean).join(" ");
      return {
        id:        r.id,
        name:      name.length > 0 ? name : "이름없음",
        avatarUrl: r.avatar_url,
        isGm:      r.is_gm === true,
      };
    });
}

/* ═══════════════════════════════════════════════════════════
 * 선물 불가 아이템 타입
 * ─────────────────────────────────────────────────────────── */

/** marker/sticker 는 서버 코어도 거부. UI 에서도 목록 제외(이중 방어). */
export const GIFT_FORBIDDEN_TYPES: readonly InventoryItemType[] = [
  "marker",
  "sticker",
] as const;

export function isGiftable(itemType: InventoryItemType): boolean {
  return !(GIFT_FORBIDDEN_TYPES as readonly string[]).includes(itemType);
}

/* ═══════════════════════════════════════════════════════════
 * 에러 정규화 (코어 예외코드 → 한글)
 * ─────────────────────────────────────────────────────────── */

const GIFT_ERROR_MESSAGES: Record<string, string> = {
  auth_required:            "로그인이 필요합니다.",
  sender_not_found:         "내 프로필 정보를 확인할 수 없습니다.",
  self_transfer:            "자신에게는 선물할 수 없습니다.",
  recipient_not_found:      "받는 사람을 찾을 수 없습니다.",
  recipient_deactivated:    "비활성화된 유저에게는 선물할 수 없습니다.",
  recipient_not_registered: "아직 가입하지 않은 유저에게는 선물할 수 없습니다.",
  invalid_amount:           "선물할 모빌 수량이 올바르지 않습니다.",
  insufficient_mobil:       "잔액이 부족합니다.",
  invalid_quantity:         "선물할 개수가 올바르지 않습니다.",
  item_not_transferable:    "선물할 수 없는 아이템입니다.",
  insufficient_quantity:    "보유 개수가 부족합니다.",
};

function normalizeGiftError(message: string | undefined): {
  reason:  string;
  message: string;
} {
  const raw = (message ?? "").trim();
  for (const code of Object.keys(GIFT_ERROR_MESSAGES)) {
    if (raw.includes(code)) {
      return { reason: code, message: GIFT_ERROR_MESSAGES[code] };
    }
  }
  return {
    reason:  "unknown",
    message: "선물 처리 중 오류가 발생하였습니다. 잠시 후 다시 시도해주십시오.",
  };
}

/* ═══════════════════════════════════════════════════════════
 * 선물 실행 (send_gift_* 래퍼 = 이동 + 기록)
 * ─────────────────────────────────────────────────────────── */

export type GiftResult =
  | { ok: true;  nextMobil: number | null }
  | { ok: false; reason: string; message: string };

/** 모빌 선물. send_gift_mobil 호출(이동+기록). 성공 시 조정 후 잔액 반환. */
export async function giftMobil(
  toProfileId: string,
  amount:      number
): Promise<GiftResult> {
  const { data, error } = await supabase.rpc("send_gift_mobil", {
    p_to_profile_id: toProfileId,
    p_amount:        amount,
  });

  if (error) {
    console.error("[giftMobil] failed:", error.message);
    return { ok: false, ...normalizeGiftError(error.message) };
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("profile-changed"));
  }
  return { ok: true, nextMobil: (data as number | null) ?? null };
}

/**
 * 아이템 선물. send_gift_item 호출(이동+기록). void 반환이라 nextMobil=null.
 * itemName: 선물함에 표시할 이름 스냅샷(선택). 없으면 종류 라벨로 폴백됨.
 */
export async function giftItem(
  toProfileId: string,
  itemType:    InventoryItemType,
  itemRef:     string,
  qty:         number,
  itemName?:   string
): Promise<GiftResult> {
  const { error } = await supabase.rpc("send_gift_item", {
    p_to_profile_id: toProfileId,
    p_item_type:     itemType,
    p_item_ref:      itemRef,
    p_qty:           qty,
    p_item_name:     itemName ?? null,
  });

  if (error) {
    console.error("[giftItem] failed:", error.message);
    return { ok: false, ...normalizeGiftError(error.message) };
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("profile-changed"));
  }
  return { ok: true, nextMobil: null };
}

/* ═══════════════════════════════════════════════════════════
 * 선물함 (받은 선물 조회 / 읽음)
 * ─────────────────────────────────────────────────────────── */

/** 받은 선물 1건. list_my_gifts RPC 반환 행에 대응(camelCase 로 정규화). */
export type ReceivedGift = {
  id:          string;
  fromProfile: string;
  fromName:    string | null;   // 보낸 사람 표시명(없으면 null)
  kind:        "mobil" | "item";
  amount:      number;
  itemType:    InventoryItemType | null;
  itemRef:     string | null;
  itemName:    string | null;
  readAt:      string | null;
  createdAt:   string;
};

/** 받은 선물 목록(최신순). 실패 시 빈 배열. */
export async function listMyGifts(limit = 50): Promise<ReceivedGift[]> {
  const { data, error } = await supabase.rpc("list_my_gifts", {
    p_limit: limit,
  });

  if (error) {
    console.error("[listMyGifts] failed:", error.message);
    return [];
  }

  const rows = (data as Array<{
    id:           string;
    from_profile: string;
    from_name:    string | null;
    kind:         string;
    amount:       number;
    item_type:    string | null;
    item_ref:     string | null;
    item_name:    string | null;
    read_at:      string | null;
    created_at:   string;
  }> | null) ?? [];

  return rows.map((r) => ({
    id:          r.id,
    fromProfile: r.from_profile,
    fromName:    r.from_name,
    kind:        r.kind === "item" ? "item" : "mobil",
    amount:      r.amount,
    itemType:    (r.item_type as InventoryItemType | null) ?? null,
    itemRef:     r.item_ref,
    itemName:    r.item_name,
    readAt:      r.read_at,
    createdAt:   r.created_at,
  }));
}

/** 안 읽은 선물 개수(배지). 실패 시 0. */
export async function countUnreadGifts(): Promise<number> {
  const { data, error } = await supabase.rpc("count_unread_gifts");
  if (error) {
    console.error("[countUnreadGifts] failed:", error.message);
    return 0;
  }
  return (data as number | null) ?? 0;
}

/** 선물함 열람 시 전체 읽음 처리. 처리된 개수 반환(실패 시 0). */
export async function markGiftsRead(): Promise<number> {
  const { data, error } = await supabase.rpc("mark_gifts_read");
  if (error) {
    console.error("[markGiftsRead] failed:", error.message);
    return 0;
  }
  return (data as number | null) ?? 0;
}