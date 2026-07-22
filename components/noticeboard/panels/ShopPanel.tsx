// components/noticeboard/panels/ShopPanel.tsx
//
// 상점 패널 (실 데이터 연동, v2).
//
// v1 (NoticeBoard 안 인라인 시안) → v2 변경:
//   · SHOP 하드코딩 배열 제거 → shop_items RPC 조회
//   · owned Record 시안 → inventory_items 실 조회 (스티커 중복 판정)
//   · 시각적 구매만 → RPC purchase_shop_item 실행
//   · 잔액 미리 확인 (UX) · 잔액 부족 시 서버 왕복 없이 컷
//   · 성공 시 profile-changed 이벤트 → 헤더 mobil 즉시 갱신
//   · 아이템 종류별 그룹 헤더 (사인펜 / 스티커)
//
// 시안의 회전 카드 느낌은 유지 (프론트 리뉴얼 예정이라 최소 침습).

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  listMyStickerRefs,
  listShopItems,
  purchaseShopItem,
  type ShopItemRow,
} from "@/lib/shop-helpers";
import { useCurrentUser } from "../../shared/useCurrentUser";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

/** marker 색상 → 이모지 (시각 표현). item_ref 값과 대응. */
const MARKER_EMOJI: Record<string, string> = {
  black: "🖊️",
  red:   "🖍️",
};

/** 카드 회전 각도 (시안 톤 유지). */
const CARD_ROT: Record<string, string> = {
  marker_black: "-1.5deg",
  marker_red:   "1deg",
  sticker_star: "-1deg",
  sticker_wave: "1.5deg",
};

export default function ShopPanel() {
  const { mobil } = useCurrentUser();

  const [items,         setItems]         = useState<ShopItemRow[]>([]);
  const [ownedStickers, setOwnedStickers] = useState<Set<string>>(new Set());
  const [loading,       setLoading]       = useState(true);
  const [pendingId,     setPendingId]     = useState<string | null>(null);
  const [toast,         setToast]         = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [itemsRes, stickersRes] = await Promise.all([
      listShopItems(),
      listMyStickerRefs(),
    ]);
    setItems(itemsRes);
    setOwnedStickers(new Set(stickersRes));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function showToast(msg: string, kind: "ok" | "err") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleBuy(item: ShopItemRow) {
    if (pendingId) return;

    // 스티커 중복 UX 컷 (서버가 최종 방어)
    if (item.item_type === "sticker" && ownedStickers.has(item.item_ref)) {
      showToast("이미 소지한 스티커입니다.", "err");
      return;
    }

    // 잔액 UX 컷
    if (mobil < item.price) {
      showToast("잔액이 부족합니다.", "err");
      return;
    }

    setPendingId(item.id);
    const res = await purchaseShopItem(item.id);
    if (res.ok) {
      showToast(`${item.name} 구매 완료`, "ok");
      // 스티커면 소지 목록에 반영 (즉시 UI 갱신, 서버는 이미 반영됨)
      if (item.item_type === "sticker") {
        setOwnedStickers((prev) => {
          const next = new Set(prev);
          next.add(item.item_ref);
          return next;
        });
      }
      // 잔액은 profile-changed 이벤트로 useCurrentUser 가 자동 갱신
    } else {
      showToast(res.message, "err");
    }
    setPendingId(null);
  }

  /* ── 종류별 그룹 ── */
  const grouped = useMemo(() => {
    const markers  = items.filter((i) => i.item_type === "marker");
    const stickers = items.filter((i) => i.item_type === "sticker");
    return { markers, stickers };
  }, [items]);

  return (
    <div>
      {/* ── 헤더 ── */}
      <div style={headerRowStyle}>
        <span style={titleStyle}>🛒 상점</span>
        <span style={balanceStyle}>
          보유 <strong style={balanceNumStyle}>{mobil.toLocaleString()}</strong> 🪙
        </span>
      </div>

      {loading ? (
        <div style={noticeStyle}>불러오는 중입니다…</div>
      ) : items.length === 0 ? (
        <div style={noticeStyle}>등록된 상품이 없습니다.</div>
      ) : (
        <>
          {/* ── 사인펜 섹션 ── */}
          {grouped.markers.length > 0 ? (
            <>
              <div style={sectionTitleStyle}>✏️ 사인펜</div>
              <div style={gridStyle}>
                {grouped.markers.map((item) => (
                  <MarkerCard
                    key={item.id}
                    item={item}
                    pending={pendingId === item.id}
                    affordable={mobil >= item.price}
                    onBuy={() => handleBuy(item)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {/* ── 스티커 섹션 ── */}
          {grouped.stickers.length > 0 ? (
            <>
              <div style={sectionTitleStyle}>🌟 스티커</div>
              <div style={gridStyle}>
                {grouped.stickers.map((item) => (
                  <StickerCard
                    key={item.id}
                    item={item}
                    pending={pendingId === item.id}
                    affordable={mobil >= item.price}
                    owned={ownedStickers.has(item.item_ref)}
                    onBuy={() => handleBuy(item)}
                  />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      {toast ? (
        <div
          style={{
            ...toastStyle,
            background: toast.kind === "ok" ? "#14406f" : "#a33b3b",
          }}
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

/* ═════════════════════════════════════════════
 * 카드 컴포넌트
 * ═════════════════════════════════════════════ */

function MarkerCard({
  item,
  pending,
  affordable,
  onBuy,
}: {
  item:       ShopItemRow;
  pending:    boolean;
  affordable: boolean;
  onBuy:      () => void;
}) {
  const emoji = MARKER_EMOJI[item.item_ref] ?? "🖊️";
  const rot   = CARD_ROT[item.code] ?? "0deg";
  const disabled = pending || !affordable;

  return (
    <div style={{ ...cardStyle, transform: `rotate(${rot})` }}>
      <div style={emojiStyle}>{emoji}</div>
      <div style={nameStyle}>{item.name}</div>
      {item.description ? (
        <div style={descStyle}>{item.description}</div>
      ) : null}
      <button
        type="button"
        onClick={onBuy}
        disabled={disabled}
        style={{
          ...buyButtonStyle,
          background: disabled ? "#c9d5df" : "#1a9edb",
          color:      disabled ? "#68757e" : "#fff",
          cursor:     disabled ? "not-allowed" : "pointer",
        }}
      >
        {pending
          ? "구매 중"
          : !affordable
          ? "잔액 부족"
          : `${item.price.toLocaleString()} 🪙 구매`}
      </button>
    </div>
  );
}

function StickerCard({
  item,
  pending,
  affordable,
  owned,
  onBuy,
}: {
  item:       ShopItemRow;
  pending:    boolean;
  affordable: boolean;
  owned:      boolean;
  onBuy:      () => void;
}) {
  const rot      = CARD_ROT[item.code] ?? "0deg";
  const disabled = pending || owned || !affordable;

  return (
    <div style={{ ...cardStyle, transform: `rotate(${rot})` }}>
      <div style={emojiStyle}>{item.item_ref}</div>
      <div style={nameStyle}>{item.name}</div>
      {item.description ? (
        <div style={descStyle}>{item.description}</div>
      ) : null}
      <button
        type="button"
        onClick={onBuy}
        disabled={disabled}
        style={{
          ...buyButtonStyle,
          background: owned
            ? "#c9f2e6"
            : disabled
            ? "#c9d5df"
            : "#1a9edb",
          color: owned ? "#1e7d6a" : disabled ? "#68757e" : "#fff",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {owned
          ? "보유중 ✓"
          : pending
          ? "구매 중"
          : !affordable
          ? "잔액 부족"
          : `${item.price.toLocaleString()} 🪙 구매`}
      </button>
    </div>
  );
}

/* ── 스타일 ── */

const headerRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "baseline",
  justifyContent: "space-between",
  gap:            12,
  marginBottom:   14,
  flexWrap:       "wrap",
};

const titleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   24,
  color:      "#0d6fa8",
};

const balanceStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   16,
  color:      "#5a7488",
};

const balanceNumStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   18,
  color:      "#9a6b00",
  margin:     "0 4px",
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   16,
  color:      "#2a55b8",
  marginTop:  18,
  marginBottom: 10,
};

const gridStyle: CSSProperties = {
  display:  "flex",
  gap:      16,
  flexWrap: "wrap",
};

const cardStyle: CSSProperties = {
  width:             150,
  background:        "#fff",
  borderTopWidth:    2,
  borderRightWidth:  2,
  borderBottomWidth: 2,
  borderLeftWidth:   2,
  borderStyle:       "solid",
  borderTopColor:    "#cdeeff",
  borderRightColor:  "#cdeeff",
  borderBottomColor: "#cdeeff",
  borderLeftColor:   "#cdeeff",
  borderRadius:      16,
  padding:           "16px 12px",
  textAlign:         "center",
  display:           "flex",
  flexDirection:     "column",
  gap:               6,
  transition:        "transform .18s",
};

const emojiStyle: CSSProperties = {
  fontSize: 34,
  lineHeight: 1,
};

const nameStyle: CSSProperties = {
  fontFamily: JUA,
  color:      "#1656b8",
  fontSize:   14,
};

const descStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#5a7488",
  lineHeight: 1.4,
  minHeight:  28,
};

const buyButtonStyle: CSSProperties = {
  width:        "100%",
  height:       34,
  borderWidth:  0,
  borderRadius: 999,
  fontFamily:   JUA,
  fontSize:     13,
  marginTop:    4,
};

const noticeStyle: CSSProperties = {
  padding:    "36px 16px",
  textAlign:  "center",
  fontFamily: BODY,
  fontSize:   13,
  color:      "#7a94a8",
};

const toastStyle: CSSProperties = {
  position:     "fixed",
  left:         "50%",
  bottom:       120,
  transform:    "translateX(-50%)",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     14,
  padding:      "10px 22px",
  borderRadius: 999,
  boxShadow:    "0 10px 26px rgba(8,50,90,.4)",
  zIndex:       80,
};