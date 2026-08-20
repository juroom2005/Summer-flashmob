// components/noticeboard/panels/InventorySection.tsx
//
// 마이패널 내 인벤토리 섹션 (실 데이터 연동, v6).
//
// v5 → v6 변경:
//   · 인형 교환권(coupon · item_ref='doll_coupon') 클릭 → 사용/파기 선택 팝업.
//     사용 시 redeem_doll_coupon 으로 인형 풀에서 균등 랜덤 1개 지급 + 결과 팝업.
//   · 그 외 쿠폰은 기존대로 파기.
//
// v4 → v5 변경:
//   · 모든 타입 라벨을 metadata.name 우선으로 통일 (개별 아이템 이름 표시).
//     - marker : metadata.name > MARKER_LABEL[ref] > "사인펜"
//     - sticker: metadata.name > "스티커"
//     - slot/other : metadata.name > 종류 기본/ref 변환
//     지급 RPC 스냅샷 + 백필로 metadata.name 이 채워진다.
//
// v4 변경:
//   · 슬롯 보상 타입(doll·coupon·junk) 렌더 신설.
//     - doll  : 이미지(metadata.image_url) 우선 → emoji → 🧸. 클릭 시 큰 이미지 팝업.
//     - coupon: 이미지 → emoji → 🎟️.
//     - junk  : 이미지 → emoji → 🌿.
//   · 같은 (item_type, item_ref) 스택이 여러 행이면 하나로 합쳐 표시 (총 수량).
//   · 파기 : marker·sticker·doll 제외 전부 클릭 시 파기 팝업(개수 입력 + 확인 1회).
//     서버 discard_inventory_item RPC 로 원자 처리.
//   · 페이지네이션 : 3×2 = 6개 넘으면 다음 페이지 (스크롤 대신).
//
// 아이템별 표현:
//   · marker : 이모지(우선순위) + 남은 획 (durability/initial_durability). 클릭 무동작.
//   · sticker: 이모지(item_ref) + "무제한 사용". 클릭 무동작.
//   · other  : 이모지(metadata.emoji 또는 기본 🎁) + "×N". 클릭 → 파기.
//   · doll   : 이미지/이모지 + "×N". 클릭 → 큰 이미지 팝업.
//   · coupon : 이미지/이모지 + "×N". 클릭 → 파기.
//   · junk   : 이미지/이모지 + "×N". 클릭 → 파기.
//
// 코르크보드 스타일은 기존 톤 유지 (프론트 리뉴얼 예정, 최소 침습).

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import useModalKeys from "@/components/shared/useModalKeys";
import {
  listMyInventoryItems,
  discardInventoryItem,
  redeemDollCoupon,
  isDiscardable,
  type InventoryItemRow,
  type InventoryItemType,
  type RedeemedDoll,
} from "@/lib/inventory-helpers";
import styles from "./InventorySection.module.css";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";
const NAVY  = "#14406f";

const PAGE_SIZE = 6;   // 3열 × 2행

const TAPE = [
  "rgba(205,238,255,.88)",
  "rgba(201,242,230,.88)",
  "rgba(255,243,166,.92)",
  "rgba(255,215,201,.88)",
];

/** marker item_ref → 표시 이모지·이름. 색상 추가 시 이 두 상수만 확장. */
const MARKER_EMOJI: Record<string, string> = {
  black: "🖊️",
  red:   "🖍️",
};
const MARKER_LABEL: Record<string, string> = {
  black: "검정 사인펜",
  red:   "빨강 사인펜",
};

/** 슬롯 보상 종류별 기본 이모지·라벨 */
const SLOT_EMOJI: Record<"doll" | "coupon" | "junk", string> = {
  doll:   "🧸",
  coupon: "🎟️",
  junk:   "🌿",
};
const SLOT_LABEL: Record<"doll" | "coupon" | "junk", string> = {
  doll:   "인형",
  coupon: "쿠폰",
  junk:   "잡템",
};

/** 인형 교환권 item_ref. 이 쿠폰만 클릭 시 "사용(교환)"이 가능하다. */
const DOLL_COUPON_REF = "doll_coupon";
/** 인형 1개 교환에 필요한 교환권 장수 (서버 redeem_doll_coupon 과 일치시킬 것). */
const COUPON_REQUIRED = 10;

type Displayable = {
  key:       string;             // React key (합침 기준 = type:ref)
  itemType:  InventoryItemType;
  itemRef:   string;
  emoji:     string;             // 이미지 없을 때 표시할 이모지
  imageUrl:  string | null;      // 있으면 이미지로 표시
  label:     string;
  badge:     string;             // 우하단 배지 (×N · 78/100 · ∞)
  tooltip:   string;
  quantity:  number;             // 합계 수량 (파기 상한)
  clickMode: "none" | "discard" | "dollView" | "coupon";
};

/** metadata 에서 문자열 필드 안전 추출. */
function readStr(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!metadata) return null;
  const v = metadata[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** item_ref (영문 슬러그) → 사람이 읽기 쉬운 라벨. 예: "soda_ice" → "soda ice" */
function prettyRef(ref: string): string {
  const s = ref.replace(/_/g, " ").trim();
  return s.length > 0 ? s : "이벤트 아이템";
}

/**
 * inventory row 배열을 표시용으로 변환.
 *   · marker · sticker 는 행 단위 (durability 등 개별).
 *   · other · doll · coupon · junk 는 (type, ref) 로 수량 합산해 하나로.
 *   · 알 수 없는 타입은 조용히 스킵.
 * 정렬은 입력 순서(최신 획득순) 유지.
 */
function buildDisplayables(rows: InventoryItemRow[]): Displayable[] {
  const out: Displayable[] = [];
  // 합산 대상(type:ref) → out 내 인덱스
  const mergeIndex = new Map<string, number>();

  for (const row of rows) {
    const ref = row.item_ref ?? "";

    // ── marker (행 단위) ──
    if (row.item_type === "marker" && ref) {
      const emoji = readStr(row.metadata, "emoji") ?? MARKER_EMOJI[ref] ?? "🖊️";
      const label = readStr(row.metadata, "name") ?? MARKER_LABEL[ref] ?? "사인펜";
      const cur   = row.durability ?? 0;
      const maxRaw = row.metadata?.["initial_durability"];
      const max   = typeof maxRaw === "number" ? maxRaw : 100;
      out.push({
        key: row.id, itemType: "marker", itemRef: ref,
        emoji, imageUrl: readStr(row.metadata, "image_url"), label,
        badge: `${cur}/${max}`,
        tooltip: `일지에 그림을 그릴 수 있습니다. 남은 획 ${cur}/${max}`,
        quantity: row.quantity ?? 1,
        clickMode: "none",
      });
      continue;
    }

    // ── sticker (행 단위) ──
    if (row.item_type === "sticker" && ref) {
      out.push({
        key: row.id, itemType: "sticker", itemRef: ref,
        emoji: ref, imageUrl: readStr(row.metadata, "image_url"), label: readStr(row.metadata, "name") ?? "스티커",
        badge: "∞",
        tooltip: "일지에 자유롭게 붙일 수 있습니다. 무제한 사용",
        quantity: row.quantity ?? 1,
        clickMode: "none",
      });
      continue;
    }

    // ── camera (행 단위) : 사진기. 보유 시 일지 폴라로이드 사용 가능 ──
    if (row.item_type === "camera" && ref) {
      out.push({
        key: row.id, itemType: "camera", itemRef: ref,
        emoji: readStr(row.metadata, "emoji") ?? "📷",
        imageUrl: readStr(row.metadata, "image_url"),
        label: readStr(row.metadata, "name") ?? "사진기",
        badge: "∞",
        tooltip: "일지에 폴라로이드 사진을 붙일 수 있습니다. 무제한 사용",
        quantity: row.quantity ?? 1,
        clickMode: "none",
      });
      continue;
    }

    // ── other · doll · coupon · junk (type:ref 로 합산) ──
    const mergeable =
      row.item_type === "other" ||
      row.item_type === "doll" ||
      row.item_type === "coupon" ||
      row.item_type === "junk";

    if (mergeable && ref) {
      const mapKey = `${row.item_type}:${ref}`;
      const qty = row.quantity ?? 1;

      const existing = mergeIndex.get(mapKey);
      if (existing !== undefined) {
        // 이미 있는 카드에 수량만 합산 (이미지/이모지는 먼저 잡힌 것 유지)
        out[existing].quantity += qty;
        out[existing].badge = `×${out[existing].quantity}`;
        // tooltip 수량도 갱신
        out[existing].tooltip = tooltipFor(out[existing].itemType, out[existing].itemRef, out[existing].label, out[existing].quantity);
        continue;
      }

      const imageUrl = readStr(row.metadata, "image_url");
      const emojiMeta = readStr(row.metadata, "emoji");

      let emoji: string;
      let label: string;
      let clickMode: Displayable["clickMode"];

      if (row.item_type === "doll") {
        emoji = emojiMeta ?? SLOT_EMOJI.doll;
        label = readStr(row.metadata, "name") ?? SLOT_LABEL.doll;
        clickMode = "dollView";
      } else if (row.item_type === "coupon") {
        emoji = emojiMeta ?? SLOT_EMOJI.coupon;
        label = readStr(row.metadata, "name") ?? SLOT_LABEL.coupon;
        clickMode = ref === DOLL_COUPON_REF ? "coupon" : "discard";
      } else if (row.item_type === "junk") {
        emoji = emojiMeta ?? SLOT_EMOJI.junk;
        label = readStr(row.metadata, "name") ?? SLOT_LABEL.junk;
        clickMode = "discard";
      } else {
        // other
        emoji = emojiMeta ?? "🎁";
        label = readStr(row.metadata, "name") ?? prettyRef(ref);
        clickMode = "discard";
      }

      const idx = out.length;
      out.push({
        key: mapKey, itemType: row.item_type, itemRef: ref,
        emoji, imageUrl, label,
        badge: `×${qty}`,
        tooltip: tooltipFor(row.item_type, ref, label, qty),
        quantity: qty,
        clickMode,
      });
      mergeIndex.set(mapKey, idx);
      continue;
    }

    // wallpaper 등은 아직 범위 밖 → 스킵
  }

  return out;
}

function tooltipFor(itemType: InventoryItemType, itemRef: string, label: string, qty: number): string {
  if (itemType === "doll")   return `${label} · 소지 ${qty}개 · 클릭하면 크게 볼 수 있습니다`;
  if (itemType === "coupon") {
    return itemRef === DOLL_COUPON_REF
      ? `${label} · 소지 ${qty}개 · 클릭하면 인형으로 교환할 수 있습니다`
      : `${label} · 소지 ${qty}개 · 클릭하면 파기할 수 있습니다`;
  }
  if (itemType === "junk")   return `${label} · 소지 ${qty}개 · 클릭하면 파기할 수 있습니다`;
  return `이벤트 아이템 · 소지 ${qty}개 · 클릭하면 파기할 수 있습니다`;
}

export default function InventorySection() {
  const [items,   setItems]   = useState<Displayable[]>([]);
  const [loading, setLoading] = useState(true);
  const [hovIdx,  setHovIdx]  = useState(-1);
  const [page,    setPage]    = useState(0);

  // 팝업 상태
  const [dollView, setDollView] = useState<Displayable | null>(null);
  const [discardTarget, setDiscardTarget] = useState<Displayable | null>(null);
  const [couponTarget, setCouponTarget] = useState<Displayable | null>(null);
  const [redeemedDoll, setRedeemedDoll] = useState<RedeemedDoll | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listMyInventoryItems();
    setItems(buildDisplayables(rows));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => { void refresh(); };
    if (typeof window !== "undefined") {
      window.addEventListener("profile-changed", handler);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("profile-changed", handler);
      }
    };
  }, [refresh]);

  // 페이지 수 · 현재 페이지 보정 (아이템이 줄어 페이지가 빌 수 있음)
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageItems = useMemo(() => {
    const start = page * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }, [items, page]);

  const handleCardClick = useCallback((it: Displayable) => {
    if (it.clickMode === "dollView") {
      setDollView(it);
    } else if (it.clickMode === "discard") {
      setDiscardTarget(it);
    } else if (it.clickMode === "coupon") {
      setCouponTarget(it);
    }
    // "none" 은 무동작
  }, []);

  return (
    <div style={sectionWrapStyle}>
      <div style={sectionHeaderStyle}>
        <span style={secTitleStyle}>인벤토리</span>
        {items.length > 0 ? (
          <span style={secHintStyle}>{items.length}종</span>
        ) : null}
      </div>

      <div style={corkboardStyle}>
        {loading ? (
          <div style={noticeStyle}>불러오는 중입니다…</div>
        ) : items.length === 0 ? (
          <div style={noticeStyle}>
            아직 소지한 아이템이 없습니다.
            <br />
            매점에서 사인펜이나 스티커를 구매해보세요.
          </div>
        ) : (
          <>
            <div style={gridStyle}>
              {pageItems.map((it, i) => {
                const clickable = it.clickMode !== "none";
                return (
                  <div
                    key={it.key}
                    className={styles.memo}
                    onMouseEnter={() => setHovIdx(i)}
                    onMouseLeave={() => setHovIdx(-1)}
                    onClick={clickable ? () => handleCardClick(it) : undefined}
                    style={{
                      ...memoCardStyle,
                      cursor: clickable ? "pointer" : "help",
                      transform: `rotate(${(i % 2 ? 1 : -1) * (1 + (i % 3)) * 1.3}deg)`,
                    }}
                  >
                    <div
                      style={{ ...tapeStyle, background: TAPE[i % TAPE.length] }}
                    />
                    {it.imageUrl ? (
                      <img src={it.imageUrl} alt={it.label} style={itemImgStyle} />
                    ) : (
                      <div style={itemEmojiStyle}>{it.emoji}</div>
                    )}
                    <div style={itemLabelStyle}>{it.label}</div>
                    <div style={badgeStyle}>{it.badge}</div>
                    {hovIdx === i ? (
                      <div className={styles.tooltipPop} style={tooltipStyle}>
                        {it.tooltip}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {pageCount > 1 ? (
              <div style={pagerStyle}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{ ...pagerBtnStyle, opacity: page === 0 ? 0.35 : 1 }}
                  aria-label="이전 페이지"
                >
                  ‹
                </button>
                <span style={pagerTextStyle}>{page + 1} / {pageCount}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  style={{ ...pagerBtnStyle, opacity: page >= pageCount - 1 ? 0.35 : 1 }}
                  aria-label="다음 페이지"
                >
                  ›
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* 인형 큰 이미지 팝업 */}
      {dollView ? (
        <DollViewPopup item={dollView} onClose={() => setDollView(null)} />
      ) : null}

      {/* 파기 팝업 */}
      {discardTarget ? (
        <DiscardPopup
          item={discardTarget}
          onClose={() => setDiscardTarget(null)}
          onDone={() => { setDiscardTarget(null); void refresh(); }}
        />
      ) : null}

      {/* 인형 교환권 : 사용 / 파기 선택 팝업 */}
      {couponTarget ? (
        <CouponActionPopup
          item={couponTarget}
          onClose={() => setCouponTarget(null)}
          onDiscard={() => { const t = couponTarget; setCouponTarget(null); setDiscardTarget(t); }}
          onRedeemed={(doll) => { setCouponTarget(null); setRedeemedDoll(doll); void refresh(); }}
        />
      ) : null}

      {/* 인형 교환 결과 팝업 */}
      {redeemedDoll ? (
        <RedeemResultPopup doll={redeemedDoll} onClose={() => setRedeemedDoll(null)} />
      ) : null}
    </div>
  );
}

/* ═════════════════════════ 인형 큰 이미지 팝업 ═════════════════════════ */

function DollViewPopup({ item, onClose }: { item: Displayable; onClose: () => void }) {
  useModalKeys({ onConfirm: onClose, onCancel: onClose, confirmOnEnterInInput: true });
  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={dollModalStyle} onClick={(e) => e.stopPropagation()}>
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.label} style={dollImgLargeStyle} />
        ) : (
          <div style={dollEmojiLargeStyle}>{item.emoji}</div>
        )}
        <div style={dollNameStyle}>{item.label}</div>
        <div style={dollQtyStyle}>소지 {item.quantity}개</div>
        <button type="button" onClick={onClose} style={modalConfirmBtn}>닫기</button>
      </div>
    </div>,
    document.body,
  );
}

/* ═══════════════════════ 인형 교환권 : 사용/파기 선택 ═══════════════════════ */

function CouponActionPopup({
  item, onClose, onDiscard, onRedeemed,
}: {
  item: Displayable;
  onClose: () => void;
  onDiscard: () => void;
  onRedeemed: (doll: RedeemedDoll) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 10장 이상 있어야 교환 가능.
  const enough = item.quantity >= COUPON_REQUIRED;

  const redeem = useCallback(async () => {
    if (busy || !enough) return;
    setBusy(true);
    setErr(null);
    const res = await redeemDollCoupon();
    setBusy(false);
    if (!res.ok) {
      setErr(redeemErrorMessage(res.reason));
      return;
    }
    onRedeemed(res.doll);
  }, [busy, enough, onRedeemed]);

  useModalKeys({
    onConfirm: () => { void redeem(); },
    onCancel: onClose,
    enabled: !busy,
    confirmOnEnterInInput: true,
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={overlayStyle} onClick={busy ? undefined : onClose}>
      <div style={dollModalStyle} onClick={(e) => e.stopPropagation()}>
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.label} style={dollImgLargeStyle} />
        ) : (
          <div style={dollEmojiLargeStyle}>{item.emoji}</div>
        )}
        <div style={dollNameStyle}>{item.label}</div>
        <div style={dollQtyStyle}>
          {item.quantity} / {COUPON_REQUIRED}개
        </div>
        <div style={couponHintStyle}>
          {enough
            ? `교환권 ${COUPON_REQUIRED}장으로 인형 하나를 무작위로 받습니다.`
            : `인형 교환에는 교환권 ${COUPON_REQUIRED}장이 필요합니다. (${COUPON_REQUIRED - item.quantity}장 부족)`}
        </div>
        {err ? <div style={discardErrRow}>{err}</div> : null}
        <div style={modalBtnRowStyle}>
          <button
            type="button"
            onClick={() => void redeem()}
            disabled={busy || !enough}
            style={{ ...modalConfirmBtn, opacity: (busy || !enough) ? 0.5 : 1, cursor: (busy || !enough) ? "not-allowed" : "pointer" }}
          >
            {busy ? "교환 중…" : "사용하기"}
          </button>
          <button type="button" onClick={onDiscard} disabled={busy} style={couponDiscardBtn}>파기</button>
          <button type="button" onClick={onClose} disabled={busy} style={modalCancelBtn}>취소</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function redeemErrorMessage(reason: string): string {
  switch (reason) {
    case "no_coupon":       return "교환권이 없습니다. 새로고침 후 다시 시도해 주십시오.";
    case "doll_pool_empty": return "지금은 교환할 수 있는 인형이 없습니다.";
    case "auth_required":   return "로그인이 필요합니다.";
    default:                return "교환에 실패했습니다. 잠시 후 다시 시도해 주십시오.";
  }
}

/* ═══════════════════════ 인형 교환 결과 ═══════════════════════ */

function RedeemResultPopup({ doll, onClose }: { doll: RedeemedDoll; onClose: () => void }) {
  useModalKeys({ onConfirm: onClose, onCancel: onClose, confirmOnEnterInInput: true });
  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={dollModalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={redeemHeadStyle}>인형을 받았습니다!</div>
        <div style={redeemStageStyle}>
          {/* 별 세 개 뿅 */}
          <span className={`${styles.redeemStar} ${styles.redeemStar1}`}>⭐</span>
          <span className={`${styles.redeemStar} ${styles.redeemStar2}`}>⭐</span>
          <span className={`${styles.redeemStar} ${styles.redeemStar3}`}>⭐</span>
          {doll.imageUrl ? (
            <img src={doll.imageUrl} alt={doll.name} className={styles.redeemDollPop} style={dollImgLargeStyle} />
          ) : (
            <div className={styles.redeemDollPop} style={dollEmojiLargeStyle}>{doll.emoji ?? "🧸"}</div>
          )}
        </div>
        <div style={dollNameStyle}>{doll.name}</div>
        <div style={dollQtyStyle}>남은 교환권 {doll.remainingCoupons}개</div>
        <button type="button" onClick={onClose} style={modalConfirmBtn}>확인</button>
      </div>
    </div>,
    document.body,
  );
}

/* ═════════════════════════ 파기 팝업 ═════════════════════════ */

function DiscardPopup({
  item, onClose, onDone,
}: {
  item: Displayable;
  onClose: () => void;
  onDone: () => void;
}) {
  const [countText, setCountText] = useState(String(item.quantity));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const count = Number(countText);
  const countValid =
    countText.trim() !== "" &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= item.quantity;

  const run = useCallback(async () => {
    if (!countValid || busy) return;
    setBusy(true);
    setErr(null);
    const res = await discardInventoryItem(item.itemType, item.itemRef, count);
    setBusy(false);
    if (!res.ok) {
      setErr(discardErrorMessage(res.reason));
      setConfirming(false);
      return;
    }
    onDone();
  }, [countValid, busy, item, count, onDone]);

  // 단계별 키 매핑:
  //   입력 단계 : Enter → 다음(확인 단계, 유효할 때만) · Esc → 닫기
  //   확인 단계 : Enter → 파기 확정 · Esc → 뒤로
  useModalKeys({
    onConfirm: () => {
      if (busy) return;
      if (confirming) { void run(); }
      else if (countValid) { setConfirming(true); }
    },
    onCancel: () => {
      if (busy) return;
      if (confirming) setConfirming(false);
      else onClose();
    },
    enabled: !busy,
    confirmOnEnterInInput: true,   // 개수 입력창에서도 Enter 로 진행
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={overlayStyle} onClick={busy ? undefined : onClose}>
      <div style={discardModalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={discardIconRow}>
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.label} style={discardIconImg} />
          ) : (
            <div style={discardIconEmoji}>{item.emoji}</div>
          )}
          <div>
            <div style={dollNameStyle}>{item.label}</div>
            <div style={dollQtyStyle}>소지 {item.quantity}개</div>
          </div>
        </div>

        {!confirming ? (
          <>
            <div style={discardFieldRow}>
              <span style={discardFieldLabel}>파기 개수</span>
              <input
                type="text"
                inputMode="numeric"
                value={countText}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  setCountText(v);
                  if (err) setErr(null);
                }}
                style={discardInput}
              />
              <button
                type="button"
                onClick={() => setCountText(String(item.quantity))}
                style={discardMaxBtn}
              >
                전부
              </button>
            </div>
            <div style={discardMetaRow}>
              {countValid
                ? `${count}개 파기 (남음 ${item.quantity - count}개)`
                : `1 ~ ${item.quantity} 사이의 개수를 입력해 주십시오.`}
            </div>
            {err ? <div style={discardErrRow}>{err}</div> : null}
            <div style={modalBtnRowStyle}>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!countValid}
                style={{ ...discardBtn, opacity: countValid ? 1 : 0.4, cursor: countValid ? "pointer" : "not-allowed" }}
              >
                파기
              </button>
              <button type="button" onClick={onClose} style={modalCancelBtn}>취소</button>
            </div>
          </>
        ) : (
          <>
            <div style={discardConfirmText}>
              {item.label} {count}개를 파기합니다.
              <br />
              파기한 아이템은 되돌릴 수 없습니다. 진행하시겠습니까?
            </div>
            {err ? <div style={discardErrRow}>{err}</div> : null}
            <div style={modalBtnRowStyle}>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                style={{ ...discardBtn, opacity: busy ? 0.5 : 1 }}
              >
                {busy ? "파기 중…" : "파기 확정"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                style={modalCancelBtn}
              >
                뒤로
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function discardErrorMessage(reason: string): string {
  switch (reason) {
    case "discard_forbidden": return "이 아이템은 파기할 수 없습니다.";
    case "discard_too_many":  return "보유한 개수보다 많이 파기할 수 없습니다.";
    case "item_not_found":    return "해당 아이템을 찾을 수 없습니다. 새로고침 후 다시 시도해 주십시오.";
    case "auth_required":     return "로그인이 필요합니다.";
    case "invalid_count":     return "파기 개수가 올바르지 않습니다.";
    default:                  return "파기에 실패했습니다. 잠시 후 다시 시도해 주십시오.";
  }
}

/* ── 스타일 ── */

const sectionWrapStyle: CSSProperties = {
  marginTop:      20,
  borderTopWidth: 2.5,
  borderTopStyle: "dashed",
  borderTopColor: "#a8dcf5",
  paddingTop:     14,
};

const sectionHeaderStyle: CSSProperties = {
  display:    "flex",
  alignItems: "baseline",
  gap:        10,
};

const secTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   16,
  color:      "#0d6fa8",
};

const secHintStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   12,
  color:      "#7fb3d4",
};

const corkboardStyle: CSSProperties = {
  marginTop:         10,
  background:        "#f2e0bd",
  borderTopWidth:    2.5,
  borderRightWidth:  2.5,
  borderBottomWidth: 2.5,
  borderLeftWidth:   2.5,
  borderStyle:       "solid",
  borderTopColor:    "#d8bd8a",
  borderRightColor:  "#d8bd8a",
  borderBottomColor: "#d8bd8a",
  borderLeftColor:   "#d8bd8a",
  borderRadius:      14,
  padding:           "18px 12px 16px",
  backgroundImage:   "radial-gradient(circle,rgba(160,120,60,.16) 1.5px,transparent 2px)",
  backgroundSize:    "9px 9px",
  minHeight:         120,
};

const gridStyle: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(3,1fr)",
  gap:                 "16px 10px",
};

const memoCardStyle: CSSProperties = {
  position:      "relative",
  background:    "#fff",
  borderRadius:  3,
  boxShadow:     "0 4px 9px rgba(90,60,20,.28)",
  padding:       "14px 6px 9px",
  textAlign:     "center",
};

const tapeStyle: CSSProperties = {
  position:  "absolute",
  top:       -7,
  left:      "50%",
  width:     46,
  height:    15,
  marginLeft: -23,
  transform: "rotate(-3deg)",
  boxShadow: "0 1px 3px rgba(90,60,20,.25)",
};

const itemEmojiStyle: CSSProperties = {
  fontSize:   26,
  lineHeight: 1,
};

const itemImgStyle: CSSProperties = {
  width:        40,
  height:       40,
  objectFit:    "contain",
  display:      "block",
  margin:       "0 auto",
};

const itemLabelStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   14,
  color:      "#2a5878",
  marginTop:  4,
};

const badgeStyle: CSSProperties = {
  position:          "absolute",
  right:             -6,
  bottom:            -6,
  minWidth:          22,
  height:            22,
  padding:           "0 5px",
  borderRadius:      "50%",
  background:        "#ffef3e",
  borderTopWidth:    2,
  borderRightWidth:  2,
  borderBottomWidth: 2,
  borderLeftWidth:   2,
  borderStyle:       "solid",
  borderTopColor:    "#e2d15a",
  borderRightColor:  "#e2d15a",
  borderBottomColor: "#e2d15a",
  borderLeftColor:   "#e2d15a",
  fontFamily:        JUA,
  fontSize:          10,
  color:             "#7a6a12",
  display:           "flex",
  alignItems:        "center",
  justifyContent:    "center",
  whiteSpace:        "nowrap",
};

const tooltipStyle: CSSProperties = {
  position:     "absolute",
  left:         "50%",
  bottom:       -46,
  width:        160,
  marginLeft:   -80,
  background:   NAVY,
  color:        "#fff",
  fontFamily:   GAEGU,
  fontWeight:   700,
  fontSize:     13,
  lineHeight:   1.35,
  padding:      "6px 9px",
  borderRadius: 9,
  zIndex:       30,
  boxShadow:    "0 8px 18px rgba(8,50,90,.35)",
  pointerEvents: "none",
};

const noticeStyle: CSSProperties = {
  textAlign:  "center",
  fontFamily: BODY,
  fontSize:   12.5,
  color:      "#8a7050",
  lineHeight: 1.6,
  padding:    "20px 12px",
};

const pagerStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  gap:            14,
  marginTop:      16,
};

const pagerBtnStyle: CSSProperties = {
  width:        30,
  height:       30,
  borderRadius: "50%",
  border:       "2px solid #d8bd8a",
  background:   "#fff",
  color:        "#8a7050",
  fontFamily:   JUA,
  fontSize:     18,
  lineHeight:   1,
  cursor:       "pointer",
  display:      "flex",
  alignItems:   "center",
  justifyContent: "center",
};

const pagerTextStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#8a7050",
  minWidth:   40,
  textAlign:  "center",
};

/* ── 팝업 공통 ── */

const overlayStyle: CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(8,30,55,.5)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1000,
  padding:        20,
};

const modalBtnRowStyle: CSSProperties = {
  display:        "flex",
  gap:            8,
  justifyContent: "center",
  marginTop:      14,
};

const modalConfirmBtn: CSSProperties = {
  height:       38,
  padding:      "0 24px",
  border:       "2px solid #0d6fa8",
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     14,
  cursor:       "pointer",
  boxShadow:    "0 3px 0 #0d6fa8",
};

const modalCancelBtn: CSSProperties = {
  height:       38,
  padding:      "0 18px",
  border:       "1.5px solid #cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
};

/* ── 인형 보기 모달 ── */

const dollModalStyle: CSSProperties = {
  background:    "#fff",
  borderRadius:  18,
  padding:       "24px 28px",
  textAlign:     "center",
  maxWidth:      360,
  width:         "100%",
  boxShadow:     "0 20px 50px rgba(8,40,80,.4)",
};

const dollImgLargeStyle: CSSProperties = {
  width:      220,
  height:     220,
  objectFit:  "contain",
  display:    "block",
  margin:     "0 auto 12px",
};

const dollEmojiLargeStyle: CSSProperties = {
  fontSize:   120,
  lineHeight: 1,
  margin:     "0 auto 12px",
};

const dollNameStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   18,
  color:      "#1a335e",
};

const dollQtyStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   13,
  color:      "#5a7488",
  marginTop:  2,
  marginBottom: 8,
};

const couponHintStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12.5,
  color:      "#5a7488",
  marginBottom: 4,
};

const couponDiscardBtn: CSSProperties = {
  height:       38,
  padding:      "0 18px",
  border:       "1.5px solid #e0b6ae",
  borderRadius: 999,
  background:   "#fff",
  color:        "#c0503f",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
};

const redeemHeadStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     16,
  color:        "#0d6fa8",
  marginBottom: 10,
};

const redeemStageStyle: CSSProperties = {
  position: "relative",
  display:  "inline-block",
  margin:   "0 auto",
  // 별이 이미지 밖으로 튀어도 잘리지 않게
  overflow: "visible",
};

/* ── 파기 모달 ── */

const discardModalStyle: CSSProperties = {
  background:   "#fff",
  borderRadius: 18,
  padding:      "22px 24px",
  maxWidth:     360,
  width:        "100%",
  boxShadow:    "0 20px 50px rgba(8,40,80,.4)",
};

const discardIconRow: CSSProperties = {
  display:     "flex",
  alignItems:  "center",
  gap:         12,
  marginBottom: 16,
};

const discardIconImg: CSSProperties = {
  width:      56,
  height:     56,
  objectFit:  "contain",
  flexShrink: 0,
};

const discardIconEmoji: CSSProperties = {
  fontSize:   44,
  lineHeight: 1,
  flexShrink: 0,
};

const discardFieldRow: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
};

const discardFieldLabel: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#0d6fa8",
  whiteSpace: "nowrap",
};

const discardInput: CSSProperties = {
  flex:         1,
  height:       36,
  border:       "1.5px solid #cfe4f2",
  borderRadius: 8,
  padding:      "0 12px",
  fontFamily:   BODY,
  fontSize:     14,
  color:        "#2c4a60",
  outline:      "none",
  minWidth:     0,
};

const discardMaxBtn: CSSProperties = {
  height:       36,
  padding:      "0 12px",
  border:       "1.5px solid #cfe4f2",
  borderRadius: 8,
  background:   "#eef7fc",
  color:        "#0d6fa8",
  fontFamily:   JUA,
  fontSize:     12,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const discardMetaRow: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#5a7488",
  marginTop:  6,
};

const discardErrRow: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#c0392b",
  marginTop:    8,
  background:   "#fdecea",
  border:       "1.5px solid #f2b8b0",
  borderRadius: 8,
  padding:      "6px 10px",
};

const discardConfirmText: CSSProperties = {
  fontFamily: BODY,
  fontSize:   14,
  color:      "#2c4a60",
  lineHeight: 1.6,
  textAlign:  "center",
};

const discardBtn: CSSProperties = {
  height:       38,
  padding:      "0 24px",
  border:       "2px solid #b23b2e",
  borderRadius: 999,
  background:   "#e05543",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     14,
  boxShadow:    "0 3px 0 #b23b2e",
};