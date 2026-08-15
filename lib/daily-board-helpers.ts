// lib/daily-board-helpers.ts
//
// 연습일지 (공용 데일리 보드) 데이터 접근 헬퍼.
//
// 스키마 : sql/pending/2026-08-15_daily_board.sql
//   · daily_board_items (board_date, owner_id, kind, content jsonb)
//   · RLS : 전체 SELECT / 본인 소유 CUD / GM 전체 CUD
//   · GM RPC : gm_delete_board_item, gm_update_board_item_content
//
// 권한 모델 :
//   · 일반 유저 : 본인 아이템만 등록/수정/삭제. 남의 것은 열람만.
//     → supabase 클라 직접 INSERT/UPDATE/DELETE (RLS 가 본인 행만 허용).
//   · GM        : 전 유저 아이템 CUD.
//     → 남의 것 수정/삭제는 GM RPC(SECURITY DEFINER) 경유로 의도를 명확히.
//     → GM 도 "본인" 아이템은 유저와 동일 경로(직접)로 처리 가능.
//
// 저장 구조 :
//   · 아이템 1개 = 행 1개. content(jsonb) 에 종류별 데이터 + 공통 배치값.
//   · 공통 배치 : x, y, rot, scale (보드 좌표계 BOARD_W×BOARD_H 기준).
//   · text    : { text, x, y, rot, scale }
//   · drawing : { pts:[{x,y}...], color, size }         (단일 stroke = 아이템 1개)
//   · sticker : { emoji, x, y, rot, scale }
//   · photo   : { src(dataURL), caption, x, y, rot, scale }
//
// 날짜 :
//   · board_date 는 'YYYY-MM-DD' (KST). 조회 시 클라가 KST 날짜 문자열을 만든다.
//   · INSERT 시 board_date 를 명시(현재 보고 있는 날짜)해 과거/오늘 구분 저장.
//
// 안정성 :
//   · 조회 실패는 빈 배열(보드가 안 뜨는 편이 잘못 뜨는 것보다 안전).
//   · CUD 실패는 { ok:false, reason } 정규화.

import { supabase } from "./supabase";
import { listMyInventoryItems } from "./inventory-helpers";

/* ═══════════════════════════════════════════════════════════
 * 아이템 게이팅 (보드 툴 사용 권한)
 * ─────────────────────────────────────────────────────────── */

/** 보드에서 사용할 수 있는 스티커 1종 (인벤토리 보유분). */
export type UsableSticker = {
  itemRef: string;
  emoji:   string;   // metadata.emoji, 없으면 fallback
  name:    string;   // metadata.name, 없으면 '스티커'
};

/** 보드에서 사용할 수 있는 사인펜 1종 (인벤토리 보유분). */
export type UsablePen = {
  inventoryId: string;   // inventory_items.id (durability 소모 시 이 행 지정)
  itemRef:     string;   // 색상 코드 (black/red 등)
  color:       string;   // 실제 그리기 hex 색
  emoji:       string;   // 팔레트 표시용
  name:        string;   // 표시명
  durability:  number | null;  // 남은 잉크 (null=무한/미설정)
};

/** 사인펜 색상 코드 → 그리기 hex. 색 추가 시 여기만 확장. */
const MARKER_COLOR: Record<string, string> = {
  black: "#222222",
  red:   "#e5484d",
  blue:  "#1e63e9",
};
const MARKER_EMOJI_MAP: Record<string, string> = {
  black: "🖊️",
  red:   "🖍️",
  blue:  "🖊️",
};
const MARKER_NAME_MAP: Record<string, string> = {
  black: "검정 사인펜",
  red:   "빨강 사인펜",
  blue:  "파랑 사인펜",
};

/** 보드 툴 게이팅 상태. 프론트가 이 값으로 툴 활성/비활성을 결정. */
export type BoardCapabilities = {
  canDraw:    boolean;          // marker(사인펜) 보유 (잉크 남은 것 1개 이상)
  canSticker: boolean;          // sticker 1개 이상 보유
  canPhoto:   boolean;          // camera(사진기) 보유
  stickers:   UsableSticker[];  // 사용 가능한 스티커 목록
  pens:       UsablePen[];      // 사용 가능한 사인펜 목록
};

/**
 * 세션 유저의 보드 툴 사용 권한 조회.
 * 로그인 안 됐으면 전부 false + 빈 스티커.
 *
 * 타이핑(text)은 게이팅 없음 → 여기서 다루지 않는다(항상 가능).
 * 서버(RLS)는 아이템 보유를 검사하지 않으므로 게이팅은 UX 차원이다.
 * (아이템 없이 강제로 등록해도 데이터 자체는 문제없어 서버 부담이 없다.)
 */
export async function getBoardCapabilities(): Promise<BoardCapabilities> {
  const items = await listMyInventoryItems();

  let canPhoto = false;
  const stickers: UsableSticker[] = [];
  const pens: UsablePen[] = [];

  for (const it of items) {
    if (it.item_type === "marker") {
      // 사인펜은 durability 가 남아있어야 실제 사용 가능(0 이하 제외).
      if (it.durability != null && it.durability <= 0) continue;
      const meta = it.metadata as Record<string, unknown>;
      const ref = it.item_ref?.trim() ?? "";
      const color = MARKER_COLOR[ref] ?? "#1e63e9";
      const emoji =
        typeof meta.emoji === "string" && meta.emoji ? meta.emoji : (MARKER_EMOJI_MAP[ref] ?? "🖊️");
      const name =
        typeof meta.name === "string" && meta.name ? meta.name : (MARKER_NAME_MAP[ref] ?? "사인펜");
      pens.push({
        inventoryId: it.id,
        itemRef: ref,
        color,
        emoji,
        name,
        durability: it.durability,
      });
    } else if (it.item_type === "camera") {
      canPhoto = true;
    } else if (it.item_type === "sticker") {
      // 프로젝트 표준: 스티커 표시 이모지 = item_ref (인벤토리 화면과 동일).
      // item_ref 에 이모지 문자를 그대로 넣는 설계라, metadata.emoji 가 아니라
      // item_ref 를 표시값으로 쓴다. (드물게 ref 가 비면 중립 기호로 폴백)
      // 예전처럼 별(⭐)로 폴백하면 emoji 미설정 스티커가 전부 별로 둔갑한다.
      const meta = it.metadata as Record<string, unknown>;
      const ref = it.item_ref?.trim() ?? "";
      const emoji = ref !== "" ? ref : "🏷️";
      const name = typeof meta.name === "string" && meta.name ? meta.name : "스티커";
      stickers.push({
        itemRef: ref,
        emoji,
        name,
      });
    }
  }

  return {
    canDraw: pens.length > 0,
    canSticker: stickers.length > 0,
    canPhoto,
    stickers,
    pens,
  };
}

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

export type BoardItemKind = "text" | "drawing" | "sticker" | "photo";

/** content 공통 배치값 (모든 kind 공유). */
export type BoardPlacement = {
  x:     number;
  y:     number;
  rot:   number;
  scale: number;
};

export type BoardItemRow = {
  id:         string;
  board_date: string;                    // 'YYYY-MM-DD'
  owner_id:   string;                    // 작성자 profile.id
  kind:       BoardItemKind;
  content:    Record<string, unknown>;   // kind 별 구조 (위 주석 참조)
  created_at: string;
  updated_at: string;
  /** 작성자 표시명. profiles join 으로 채움(항상 최신). 미조회 시 null. */
  owner_name: string | null;
};

export type BoardResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; reason: string; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  auth_required:        "로그인이 필요합니다.",
  gm_only:              "GM 권한이 필요합니다.",
  not_owner:            "본인이 등록한 것만 수정하거나 삭제할 수 있습니다.",
  board_item_not_found: "대상 항목을 찾을 수 없습니다.",
  invalid_item_id:      "항목 식별자가 올바르지 않습니다.",
  invalid_content:      "저장할 내용이 올바르지 않습니다.",
  invalid_kind:         "지원하지 않는 항목 종류입니다.",
  invalid_date:         "날짜 형식이 올바르지 않습니다.",
  profile_not_found:    "프로필을 찾을 수 없습니다.",
  unknown:              "처리 중 오류가 발생하였습니다. 잠시 후 다시 시도해주십시오.",
};

function normalize(message: string | undefined): {
  reason: string;
  message: string;
} {
  const raw = (message ?? "").trim();
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (raw.includes(code)) {
      return { reason: code, message: ERROR_MESSAGES[code] };
    }
  }
  return { reason: "unknown", message: ERROR_MESSAGES.unknown };
}

const KIND_SET: readonly BoardItemKind[] = ["text", "drawing", "sticker", "photo"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ═══════════════════════════════════════════════════════════
 * 날짜 유틸 (KST)
 * ─────────────────────────────────────────────────────────── */

/**
 * KST 기준 오늘 날짜 문자열 'YYYY-MM-DD'.
 * 서버 default 와 동일 기준(Asia/Seoul)을 클라에서 재현.
 */
export function kstToday(): string {
  return kstDateString(0);
}

/**
 * KST 기준 오늘로부터 offset 일 이동한 날짜 문자열.
 * @param offset  일 단위. 음수=과거, 0=오늘.
 */
export function kstDateString(offset: number): string {
  // 현재 UTC 시각에 KST(+9h) 를 더해 "KST 벽시계"를 만든 뒤 날짜만 취한다.
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  kst.setUTCDate(kst.getUTCDate() + offset);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ═══════════════════════════════════════════════════════════
 * 조회
 * ─────────────────────────────────────────────────────────── */

/**
 * 특정 날짜의 공용 보드 아이템 전체 조회.
 * 정렬: created_at ASC (올린 순 → 나중 것이 위로 쌓이도록 렌더는 프론트가 결정).
 * 실패 시 빈 배열.
 */
export async function listBoardItems(boardDate: string): Promise<BoardItemRow[]> {
  if (!DATE_RE.test(boardDate)) return [];

  const { data, error } = await supabase
    .from("daily_board_items")
    .select(
      "id, board_date, owner_id, kind, content, created_at, updated_at, " +
      "owner:profiles!owner_id ( family_name, given_name )"
    )
    .eq("board_date", boardDate)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[listBoardItems] failed:", error.message);
    return [];
  }

  // join 결과(owner 중첩 객체)를 owner_name 으로 평탄화.
  const rows = (data as unknown as Array<
    Omit<BoardItemRow, "owner_name"> & {
      owner: { family_name: string | null; given_name: string | null } | null;
    }
  > | null) ?? [];

  return rows.map((r) => {
    const owner = r.owner;
    const name = owner
      ? [owner.family_name, owner.given_name].filter(Boolean).join(" ")
      : "";
    return {
      id: r.id,
      board_date: r.board_date,
      owner_id: r.owner_id,
      kind: r.kind,
      content: r.content,
      created_at: r.created_at,
      updated_at: r.updated_at,
      owner_name: name.length > 0 ? name : "이름 미등록",
    };
  });
}

/* ═══════════════════════════════════════════════════════════
 * 본인 CUD (RLS 직접)
 * ─────────────────────────────────────────────────────────── */

/**
 * 본인 아이템 등록.
 * @param ownerId  본인 profile.id (호출부가 getCurrentProfile 로 확보해 전달).
 *
 * RLS insert_own 이 owner_id=본인 인지 검증하므로, 남의 id 로는 서버가 거부.
 * 반환: 생성된 행(렌더 즉시 반영용).
 */
export async function addBoardItem(input: {
  boardDate: string;
  ownerId:   string;
  kind:      BoardItemKind;
  content:   Record<string, unknown>;
  /** 본인 표시명(호출부가 이미 알고 있으므로 반환행에 채움). 미전달 시 null. */
  ownerName?: string;
}): Promise<BoardResult<BoardItemRow>> {
  const { boardDate, ownerId, kind, content, ownerName } = input;

  if (!DATE_RE.test(boardDate)) {
    return { ok: false, reason: "invalid_date", message: ERROR_MESSAGES.invalid_date };
  }
  if (!KIND_SET.includes(kind)) {
    return { ok: false, reason: "invalid_kind", message: ERROR_MESSAGES.invalid_kind };
  }

  const { data, error } = await supabase
    .from("daily_board_items")
    .insert({
      board_date: boardDate,
      owner_id:   ownerId,
      kind,
      content,
    })
    .select("id, board_date, owner_id, kind, content, created_at, updated_at")
    .single();

  if (error) {
    const n = normalize(error.message);
    console.error("[addBoardItem] failed:", error.message);
    return { ok: false, ...n };
  }
  const row = data as Omit<BoardItemRow, "owner_name">;
  return { ok: true, data: { ...row, owner_name: ownerName ?? null } };
}

/**
 * 본인 아이템 content 수정 (위치·크기·내용).
 * RLS update_own 이 본인 행만 허용. 남의 행은 0건 매칭 → not_owner 취급.
 */
export async function updateBoardItemContent(
  itemId:  string,
  content: Record<string, unknown>
): Promise<BoardResult> {
  const { data, error } = await supabase
    .from("daily_board_items")
    .update({ content })
    .eq("id", itemId)
    .select("id");

  if (error) {
    const n = normalize(error.message);
    console.error("[updateBoardItemContent] failed:", error.message);
    return { ok: false, ...n };
  }
  // RLS 로 본인 것이 아니면 매칭 0건(에러 아님). 소유권 위반으로 처리.
  if (!data || data.length === 0) {
    return { ok: false, reason: "not_owner", message: ERROR_MESSAGES.not_owner };
  }
  return { ok: true, data: undefined };
}

/**
 * 본인 아이템 삭제.
 * RLS delete_own 이 본인 행만 허용.
 */
export async function deleteBoardItem(itemId: string): Promise<BoardResult> {
  const { data, error } = await supabase
    .from("daily_board_items")
    .delete()
    .eq("id", itemId)
    .select("id");

  if (error) {
    const n = normalize(error.message);
    console.error("[deleteBoardItem] failed:", error.message);
    return { ok: false, ...n };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: "not_owner", message: ERROR_MESSAGES.not_owner };
  }
  return { ok: true, data: undefined };
}

/* ═══════════════════════════════════════════════════════════
 * GM CUD (남의 아이템 · RPC)
 * ─────────────────────────────────────────────────────────── */

/**
 * GM: 임의 아이템 삭제 (소유자 무관).
 * SECURITY DEFINER RPC. GM 이 아니면 서버가 gm_only 로 거부.
 */
export async function gmDeleteBoardItem(itemId: string): Promise<BoardResult> {
  const { error } = await supabase.rpc("gm_delete_board_item", {
    p_item_id: itemId,
  });

  if (error) {
    const n = normalize(error.message);
    console.error("[gmDeleteBoardItem] failed:", error.message);
    return { ok: false, ...n };
  }
  return { ok: true, data: undefined };
}

/**
 * GM: 임의 아이템 content 수정 (소유자 무관).
 */
export async function gmUpdateBoardItemContent(
  itemId:  string,
  content: Record<string, unknown>
): Promise<BoardResult> {
  const { error } = await supabase.rpc("gm_update_board_item_content", {
    p_item_id: itemId,
    p_content: content,
  });

  if (error) {
    const n = normalize(error.message);
    console.error("[gmUpdateBoardItemContent] failed:", error.message);
    return { ok: false, ...n };
  }
  return { ok: true, data: undefined };
}