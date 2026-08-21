// lib/gift-helpers.ts
//
// 선물(양도) 기능 helper.
//
// 백엔드는 v19 에서 신설·검증 완료 (SQL 은 건드리지 않는다):
//   · transfer_mobil(p_to_profile_id uuid, p_amount integer) → integer(잔액)
//   · transfer_item (p_to_profile_id uuid, p_item_type text,
//                    p_item_ref text, p_qty integer) → void
//   두 RPC 모두 내부 코어(_transfer_*_core)를 호출하며, 코어가
//   자기이체 차단 · 교착 회피(id 순 잠금) · 수신자 상태검사 ·
//   잔액/보유 검사 · 스택 병합(99) · marker/sticker 양도차단을 수행한다.
//
// 이 helper 는 shop-helpers 의 purchaseShopItem 패턴을 그대로 따른다:
//   · supabase.rpc 호출
//   · 서버 예외코드 → 한글 메시지 정규화
//   · 성공 시 window "profile-changed" 이벤트 발행(잔액/인벤토리 재조회 유도)
//
// 관련 마이그레이션(참고, 재실행 금지):
//   sql/applied 의 transfer / bot_transfer 계열 (v19 신설분)

import { supabase } from "./supabase";
import type { InventoryItemType } from "./inventory-helpers";

/* ═══════════════════════════════════════════════════════════
 * 수신자 목록
 * ─────────────────────────────────────────────────────────── */

/** 선물 대상으로 표시할 유저 1명. id 는 profiles.id (= RPC 의 p_to_profile_id). */
export type GiftRecipient = {
  /** profiles.id — transfer_* RPC 에 그대로 넘긴다. */
  id:         string;
  /** 표시명. family_name + given_name 조합(없으면 "이름없음"). */
  name:       string;
  /** 아바타 이미지 URL(있으면). 목록 썸네일용. */
  avatarUrl:  string | null;
  /** GM 여부(라벨 표시용). */
  isGm:       boolean;
};

/**
 * 선물 가능한 수신자 전체 목록.
 *
 * profiles 를 직접 조회한다(RLS profiles_select_all = USING true 로 전체 열람 가능).
 * member_profiles 가 아니라 profiles 를 쓰는 이유: 멤버 프로필 미작성 유저도
 * 선물을 받을 수 있어야 하기 때문.
 *
 * 필터:
 *   · deactivated_at IS NULL  — 비활성 유저 제외(코어도 recipient_deactivated 로 막지만
 *                               애초에 목록에서 빼서 혼란 방지)
 *   · user_id IS NOT NULL     — 미등록(초대만 발급, 가입 전) 프로필 제외
 *                               (코어의 recipient_not_registered 대응)
 *   · 본인 제외               — 자기이체(self_transfer) 사전 차단
 *
 * 실패 시 빈 배열(호출측에서 "목록을 불러오지 못했습니다" 처리).
 */
export async function listGiftRecipients(): Promise<GiftRecipient[]> {
  // 본인 profiles.id 를 먼저 구해 목록에서 제외한다.
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
      const name = `${fam}${giv}`.trim();
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

/**
 * 양도 불가 타입. 서버 코어(_transfer_item_core)가 marker/sticker 를
 * item_not_transferable 로 거부하므로 UI 에서도 동일하게 목록에서 제외한다(이중 방어).
 */
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
  // 공통(래퍼 + 코어)
  auth_required:            "로그인이 필요합니다.",
  sender_not_found:         "내 프로필 정보를 확인할 수 없습니다.",
  self_transfer:            "자신에게는 선물할 수 없습니다.",
  recipient_not_found:      "받는 사람을 찾을 수 없습니다.",
  recipient_deactivated:    "비활성화된 유저에게는 선물할 수 없습니다.",
  recipient_not_registered: "아직 가입하지 않은 유저에게는 선물할 수 없습니다.",
  // 모빌(_transfer_mobil_core)
  invalid_amount:           "선물할 모빌 수량이 올바르지 않습니다.",
  insufficient_mobil:       "잔액이 부족합니다.",
  // 아이템(_transfer_item_core)
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
 * 선물 실행
 * ─────────────────────────────────────────────────────────── */

export type GiftResult =
  | { ok: true;  nextMobil: number | null }
  | { ok: false; reason: string; message: string };

/**
 * 모빌 선물. RPC transfer_mobil 호출.
 * 성공 시 조정 후 내 잔액(nextMobil) 반환 + profile-changed 이벤트 발행.
 */
export async function giftMobil(
  toProfileId: string,
  amount:      number
): Promise<GiftResult> {
  const { data, error } = await supabase.rpc("transfer_mobil", {
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
 * 아이템 선물. RPC transfer_item 호출.
 * transfer_item 은 void 반환이라 nextMobil 은 항상 null.
 * 성공 시 profile-changed 이벤트 발행(인벤토리 재조회 유도).
 */
export async function giftItem(
  toProfileId: string,
  itemType:    InventoryItemType,
  itemRef:     string,
  qty:         number
): Promise<GiftResult> {
  const { error } = await supabase.rpc("transfer_item", {
    p_to_profile_id: toProfileId,
    p_item_type:     itemType,
    p_item_ref:      itemRef,
    p_qty:           qty,
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
