// components/noticeboard/panels/ShopPanel.tsx
//
// 매점 패널 (실 데이터 연동, v3).
//
// v2 → v3 변경 (세션 I):
//   · 명칭 통일 : "상점" → "매점"
//   · 잔액 부족 시각 표현 :
//     - 카드 흐림 (opacity 0.55)
//     - 우상단 붉은 "잔액 부족" 태그
//     - 버튼 문구는 항상 "{price} 🪙 구매" 로 통일
//     - 클릭 시 기존 toast "잔액이 부족합니다." 유지 (실수 시 안내)
//   · marker 이모지 우선순위 : metadata.emoji > MARKER_EMOJI[item_ref] > 🖊️
//   · other 타입 카드 신설 (이벤트성 아이템)
//     · 인벤토리에 quantity 로 누적되므로 중복 구매 허용
//     · 잔액 부족 시에만 비활성화, 그 외엔 매번 구매 가능
//
// 스티커 "보유중" 표시는 기존 유지 :
//   · 초록 배경 버튼 · "보유중 ✓" 문구
//   · 보유중은 긍정 완료 상태이므로 카드 흐림 처리하지 않음
//   · 보유중 + 잔액 부족 동시 발생 시 보유중 우선 (이미 소지)
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

/** marker 색상 → 이모지 (시각 표현). item_ref 값과 대응.
 *  metadata.emoji 가 있으면 그쪽을 우선. */
const MARKER_EMOJI: Record<string, string> = {
  black: "🖊️",
  red:   "🖍️",
};

/** 카드 회전 각도 (시안 톤 유지). code 매칭 없으면 0deg. */
const CARD_ROT: Record<string, string> = {
  marker_black: "-1.5deg",
  marker_red:   "1deg",
  sticker_star: "-1deg",
  sticker_wave: "1.5deg",
};

/** metadata 에서 emoji 를 안전 추출. */
function readEmoji(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const v = metadata.emoji;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

  // GM 이 카탈로그를 바꿔도 즉시 반영되도록 리슨 (gm-shop-helpers 가 발행).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => { void refresh(); };
    window.addEventListener("shop-items-changed", handler);
    return () => window.removeEventListener("shop-items-changed", handler);
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
    const cameras  = items.filter((i) => i.item_type === "camera");
    const others   = items.filter((i) => i.item_type === "other");
    return { markers, stickers, cameras, others };
  }, [items]);

  return (
    <div>
      {/* ── 헤더 ── */}
      <div style={headerRowStyle}>
        <span style={titleStyle}>🛒 매점</span>
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

          {/* ── 사진기 섹션 (camera) ── */}
          {grouped.cameras.length > 0 ? (
            <>
              <div style={sectionTitleStyle}>📷 사진기</div>
              <div style={gridStyle}>
                {grouped.cameras.map((item) => (
                  <OtherCard
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

          {/* ── 이벤트 섹션 (other) ── */}
          {grouped.others.length > 0 ? (
            <>
              <div style={sectionTitleStyle}>🎁 이벤트</div>
              <div style={gridStyle}>
                {grouped.others.map((item) => (
                  <OtherCard
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

/** 구매 버튼 문구.
 *  잔액 부족은 카드 흐림 · 우상단 태그로 별도 표현하므로,
 *  버튼 문구에는 담지 않고 항상 가격을 그대로 표시. */
function buyButtonLabel(args: {
  price:   number;
  pending: boolean;
  owned?:  boolean;
}): string {
  if (args.owned)   return "보유중 ✓";
  if (args.pending) return "구매 중…";
  return `${args.price.toLocaleString()} 🪙 구매`;
}

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
  // 이모지 우선순위 : metadata.emoji > MARKER_EMOJI[item_ref] > 🖊️
  const emoji = readEmoji(item.metadata) ?? MARKER_EMOJI[item.item_ref] ?? "🖊️";
  const rot   = CARD_ROT[item.code] ?? "0deg";

  // 잔액 부족 시 카드 흐림. 클릭은 여전히 가능 (toast 로 안내).
  const dim      = !affordable;
  const disabled = pending; // 구매 중일 때만 클릭 봉쇄

  return (
    <div
      style={{
        ...cardStyle,
        transform: `rotate(${rot})`,
        opacity:   dim ? 0.55 : 1,
      }}
    >
      {!affordable ? <InsufficientTag /> : null}
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
        {buyButtonLabel({ price: item.price, pending })}
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
  const rot = CARD_ROT[item.code] ?? "0deg";

  // 우선순위 : 보유중 > 잔액 부족
  //   · 보유중이면 잔액 부족 태그·흐림 표시하지 않음 (이미 소지, 무관)
  //   · 보유중은 완료된 긍정 상태라 카드 흐림 처리 안 함
  const showInsufficient = !owned && !affordable;
  const dim              = showInsufficient;
  const disabled         = pending || owned;

  return (
    <div
      style={{
        ...cardStyle,
        transform: `rotate(${rot})`,
        opacity:   dim ? 0.55 : 1,
      }}
    >
      {showInsufficient ? <InsufficientTag /> : null}
      {owned ? <OwnedTag /> : null}
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
          color:  owned ? "#1e7d6a" : disabled ? "#68757e" : "#fff",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {buyButtonLabel({ price: item.price, pending, owned })}
      </button>
    </div>
  );
}

/** 이벤트성 아이템 카드.
 *  · 기능 없음. 인벤토리에 quantity 로 누적.
 *  · 중복 구매 허용 (스티커와 달리 owned 판정 없음).
 *  · 잔액 부족 시 카드 흐림 + 태그. */
function OtherCard({
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
  const emoji = readEmoji(item.metadata) ?? "🎁";
  const rot   = CARD_ROT[item.code] ?? "0deg";

  const dim      = !affordable;
  const disabled = pending;

  return (
    <div
      style={{
        ...cardStyle,
        transform: `rotate(${rot})`,
        opacity:   dim ? 0.55 : 1,
      }}
    >
      {!affordable ? <InsufficientTag /> : null}
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
          background: disabled ? "#c9d5df" : "#e08a5a",
          color:      disabled ? "#68757e" : "#fff",
          cursor:     disabled ? "not-allowed" : "pointer",
        }}
      >
        {buyButtonLabel({ price: item.price, pending })}
      </button>
    </div>
  );
}

/* ── 우상단 태그 ── */

function InsufficientTag() {
  return <span style={insufficientTagStyle}>잔액 부족</span>;
}

function OwnedTag() {
  return <span style={ownedTagStyle}>보유중</span>;
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
  position:          "relative",
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
  transition:        "transform .18s, opacity .18s",
};

const insufficientTagStyle: CSSProperties = {
  position:     "absolute",
  top:          6,
  right:        6,
  padding:      "2px 8px",
  borderRadius: 999,
  background:   "#e2695f",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     10,
  lineHeight:   1.4,
  whiteSpace:   "nowrap",
  boxShadow:    "0 1px 3px rgba(163,59,59,.35)",
  zIndex:       2,
};

const ownedTagStyle: CSSProperties = {
  position:     "absolute",
  top:          6,
  right:        6,
  padding:      "2px 8px",
  borderRadius: 999,
  background:   "#4db6a0",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     10,
  lineHeight:   1.4,
  whiteSpace:   "nowrap",
  boxShadow:    "0 1px 3px rgba(46,125,107,.3)",
  zIndex:       2,
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