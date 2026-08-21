// components/noticeboard/panels/ShopPanel.tsx
//
// 매점 패널 (실 데이터 연동, v4 — UI 리뉴얼).
//
// v3 → v4 (2026-08 리뉴얼):
//   · 레이아웃: 세로 섹션 나열 → 카테고리 탭 전환(사인펜/스티커/사진기/이벤트).
//     선택한 카테고리 그리드만 표시. 있는 카테고리만 탭으로 노출.
//   · 비주얼: flashmob 디자인 토큰 기반 재해석(남색 텍스트·파랑 버튼·노랑
//     포인트, 카드 0 4px 0 오프셋 그림자, hover 리프트). 회전 카드 제거.
//   · 구매 로직/데이터/상태 처리는 v3 그대로 보존(겉모습만 교체).
//
// 유지된 규칙(v3):
//   · 잔액 부족: 카드 흐림(opacity .55) + 우상단 "잔액 부족" 태그. 클릭은
//     가능하되 toast 안내. 버튼 문구는 항상 "{price} 🪙 구매".
//   · 스티커 보유중: 민트 버튼 "보유중 ✓", 카드 흐림 안 함.
//   · marker 이모지 우선순위: metadata.emoji > MARKER_EMOJI[item_ref] > 🖊️.
//   · other(이벤트) 중복 구매 허용, 잔액 부족 시에만 비활성.
//   · GM 카탈로그 변경 시 shop-items-changed 이벤트로 즉시 반영.

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
import GiftModal from "./gift/GiftModal";
import GiftInboxModal from "./gift/GiftInboxModal";
import { countUnreadGifts } from "@/lib/gift-helpers";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";
const HEADING = "'Stretch Pro', 'Jua', sans-serif";

/* flashmob 토큰(하드코딩 별칭 — 인라인 스타일이라 var 대신 값 사용) */
const C = {
  primary:      "#3f88f9",
  textStrong:   "#1a335e",
  textMid:      "#14406f",
  textDim:      "#7fb3d4",
  bgCard:       "#ffffff",
  border:       "#cfe2fb",
  primaryShadow:"rgba(63,136,249,0.20)",
  warning:      "#facc15",
  warningTint:  "#fef08a",
  warningText:  "#8a7410",
  success:      "#c9f2e6",
  successText:  "#1e7d6a",
  danger:       "#ff6f7f",
  disabledBg:   "#d3dde8",
  disabledText: "#7d8ba0",
};

/** marker 색상 → 이모지 (시각 표현). item_ref 값과 대응. */
const MARKER_EMOJI: Record<string, string> = {
  black: "🖊️",
  red:   "🖍️",
};

/** metadata 에서 emoji 를 안전 추출. */
function readEmoji(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const v = metadata.emoji;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** image_url 을 안전 추출(공백/빈문자 → null). */
function readImageUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const t = url.trim();
  return t.length > 0 ? t : null;
}

/**
 * 아이템 썸네일: image_url 이 있으면 이미지, 없으면 fallback(이모지·글자).
 * 이미지 로드 실패 시에도 fallback 으로 되돌린다(깨진 이미지 방지).
 */
function ItemThumb({
  imageUrl,
  fallback,
  alt,
}: {
  imageUrl: string | null;
  fallback: string;
  alt:      string;
}) {
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) {
    return (
      <div style={emojiStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={alt}
          onError={() => setFailed(true)}
          style={{ width: 44, height: 44, objectFit: "contain", display: "block" }}
        />
      </div>
    );
  }
  return <div style={emojiStyle}>{fallback}</div>;
}

/* 카테고리 정의(표시 순서·라벨). */
type CatKey = "marker" | "sticker" | "camera" | "other";
const CATEGORIES: { key: CatKey; label: string }[] = [
  { key: "marker",  label: "사인펜" },
  { key: "sticker", label: "스티커" },
  { key: "camera",  label: "사진기" },
  { key: "other",   label: "이벤트" },
];

export default function ShopPanel() {
  const { mobil } = useCurrentUser();

  const [items,         setItems]         = useState<ShopItemRow[]>([]);
  const [ownedStickers, setOwnedStickers] = useState<Set<string>>(new Set());
  const [loading,       setLoading]       = useState(true);
  const [pendingId,     setPendingId]     = useState<string | null>(null);
  const [toast,         setToast]         = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [activeCat,     setActiveCat]     = useState<CatKey>("marker");
  const [giftOpen,      setGiftOpen]      = useState(false);
  const [inboxOpen,     setInboxOpen]     = useState(false);
  const [unreadGifts,   setUnreadGifts]   = useState(0);

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

  // GM 이 카탈로그를 바꿔도 즉시 반영되도록 리슨.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => { void refresh(); };
    window.addEventListener("shop-items-changed", handler);
    return () => window.removeEventListener("shop-items-changed", handler);
  }, [refresh]);

  // 안 읽은 선물 개수(배지). 초기 로드 + 선물 발생/수신 시(profile-changed) 재조회.
  useEffect(() => {
    let alive = true;
    const load = () => {
      void countUnreadGifts().then((n) => {
        if (alive) setUnreadGifts(n);
      });
    };
    load();
    if (typeof window !== "undefined") {
      window.addEventListener("profile-changed", load);
      return () => {
        alive = false;
        window.removeEventListener("profile-changed", load);
      };
    }
    return () => { alive = false; };
  }, []);

  function showToast(msg: string, kind: "ok" | "err") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleBuy(item: ShopItemRow) {
    if (pendingId) return;

    if (item.item_type === "sticker" && ownedStickers.has(item.item_ref)) {
      showToast("이미 소지한 스티커입니다.", "err");
      return;
    }
    if (mobil < item.price) {
      showToast("잔액이 부족합니다.", "err");
      return;
    }

    setPendingId(item.id);
    const res = await purchaseShopItem(item.id);
    if (res.ok) {
      showToast(`${item.name} 구매 완료`, "ok");
      if (item.item_type === "sticker") {
        setOwnedStickers((prev) => {
          const next = new Set(prev);
          next.add(item.item_ref);
          return next;
        });
      }
    } else {
      showToast(res.message, "err");
    }
    setPendingId(null);
  }

  /* ── 종류별 그룹 ── */
  const grouped = useMemo(() => {
    const marker  = items.filter((i) => i.item_type === "marker");
    const sticker = items.filter((i) => i.item_type === "sticker");
    const camera  = items.filter((i) => i.item_type === "camera");
    const other   = items.filter((i) => i.item_type === "other");
    return { marker, sticker, camera, other };
  }, [items]);

  // 실제로 아이템이 있는 카테고리만 탭으로.
  const availableCats = useMemo(
    () => CATEGORIES.filter((c) => grouped[c.key].length > 0),
    [grouped]
  );

  // activeCat 이 비어있으면 첫 번째 사용 가능 탭으로 보정.
  useEffect(() => {
    if (availableCats.length === 0) return;
    if (!availableCats.some((c) => c.key === activeCat)) {
      setActiveCat(availableCats[0].key);
    }
  }, [availableCats, activeCat]);

  const activeItems = grouped[activeCat] ?? [];

  return (
    <div>
      {/* ── 헤더 ── */}
      <div style={headerRowStyle}>
        <span style={titleStyle}>STORE</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={balancePillStyle}>
            <span style={balanceLabelStyle}>보유</span>
            <strong style={balanceNumStyle}>{mobil.toLocaleString()}</strong>
            <span style={balanceCoinStyle}>🪙</span>
          </span>
          <button
            type="button"
            onClick={() => setInboxOpen(true)}
            style={{
              position: "relative",
              border: "1px solid #cfe2fb",
              borderRadius: 12,
              padding: "8px 14px",
              background: "#ffffff",
              color: "#14406f",
              fontFamily: "'Jua', sans-serif",
              fontSize: 14,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            선물함
            {unreadGifts > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  boxSizing: "border-box",
                  borderRadius: 9,
                  background: "#ff6f7f",
                  color: "#fff",
                  fontFamily: "'Jua', sans-serif",
                  fontSize: 11,
                  lineHeight: "18px",
                  textAlign: "center",
                }}
              >
                {unreadGifts > 99 ? "99+" : unreadGifts}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setGiftOpen(true)}
            style={{
              border: "none",
              borderRadius: 12,
              padding: "8px 14px",
              background: "#3f88f9",
              color: "#fff",
              fontFamily: "'Jua', sans-serif",
              fontSize: 14,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            선물하기 🎁
          </button>
        </span>
      </div>

      {giftOpen && (
        <GiftModal
          myMobil={mobil}
          onClose={() => setGiftOpen(false)}
          onDone={(msg) => {
            setGiftOpen(false);
            showToast(msg, "ok");
          }}
        />
      )}

      {inboxOpen && (
        <GiftInboxModal
          onClose={() => setInboxOpen(false)}
          onRead={() => setUnreadGifts(0)}
        />
      )}

      {loading ? (
        <div style={noticeStyle}>불러오는 중입니다…</div>
      ) : items.length === 0 ? (
        <div style={noticeStyle}>등록된 상품이 없습니다.</div>
      ) : (
        <>
          {/* ── 카테고리 탭 ── */}
          <div style={tabBarStyle}>
            {availableCats.map((c) => {
              const active = activeCat === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setActiveCat(c.key)}
                  style={{
                    ...tabStyle,
                    ...(active ? tabActiveStyle : null),
                  }}
                >
                  {c.label}
                  <span
                    style={{
                      ...tabCountStyle,
                      ...(active ? tabCountActiveStyle : null),
                    }}
                  >
                    {grouped[c.key].length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── 선택된 카테고리 그리드 ── */}
          <div style={gridStyle}>
            {activeItems.map((item) => {
              const affordable = mobil >= item.price;
              const pending = pendingId === item.id;
              if (item.item_type === "sticker") {
                return (
                  <StickerCard
                    key={item.id}
                    item={item}
                    pending={pending}
                    affordable={affordable}
                    owned={ownedStickers.has(item.item_ref)}
                    onBuy={() => handleBuy(item)}
                  />
                );
              }
              if (item.item_type === "marker") {
                return (
                  <MarkerCard
                    key={item.id}
                    item={item}
                    pending={pending}
                    affordable={affordable}
                    onBuy={() => handleBuy(item)}
                  />
                );
              }
              // camera / other 공용 카드
              return (
                <OtherCard
                  key={item.id}
                  item={item}
                  pending={pending}
                  affordable={affordable}
                  onBuy={() => handleBuy(item)}
                />
              );
            })}
          </div>
        </>
      )}

      {toast ? (
        <div
          style={{
            ...toastStyle,
            background: toast.kind === "ok" ? C.textMid : "#a33b3b",
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

/** 구매 버튼 문구. 잔액 부족은 카드 흐림·태그로 표현하므로 문구엔 안 담음. */
function buyButtonLabel(args: {
  price:   number;
  pending: boolean;
  owned?:  boolean;
}): string {
  if (args.owned)   return "보유중 ✓";
  if (args.pending) return "구매 중…";
  return `${args.price.toLocaleString()} 🪙 구매`;
}

/** 공용 구매 버튼 스타일 계산. */
function buyBtnColors(disabled: boolean, owned?: boolean): CSSProperties {
  if (owned) {
    return { background: C.success, color: C.successText, cursor: "default" };
  }
  if (disabled) {
    return { background: C.disabledBg, color: C.disabledText, cursor: "not-allowed" };
  }
  return { background: C.primary, color: "#fff", cursor: "pointer" };
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
  const emoji = readEmoji(item.metadata) ?? MARKER_EMOJI[item.item_ref] ?? "🖊️";
  const dim      = !affordable;
  const disabled = pending;

  return (
    <div style={{ ...cardStyle, opacity: dim ? 0.55 : 1 }}>
      {!affordable ? <InsufficientTag /> : null}
      <ItemThumb imageUrl={readImageUrl(item.image_url)} fallback={emoji} alt={item.name} />
      <div style={nameStyle}>{item.name}</div>
      {item.description ? <div style={descStyle}>{item.description}</div> : null}
      <button
        type="button"
        onClick={onBuy}
        disabled={disabled}
        style={{ ...buyButtonStyle, ...buyBtnColors(disabled) }}
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
  const showInsufficient = !owned && !affordable;
  const dim              = showInsufficient;
  const disabled         = pending || owned;

  return (
    <div style={{ ...cardStyle, opacity: dim ? 0.55 : 1 }}>
      {showInsufficient ? <InsufficientTag /> : null}
      {owned ? <OwnedTag /> : null}
      <ItemThumb imageUrl={readImageUrl(item.image_url)} fallback={item.item_ref} alt={item.name} />
      <div style={nameStyle}>{item.name}</div>
      {item.description ? <div style={descStyle}>{item.description}</div> : null}
      <button
        type="button"
        onClick={onBuy}
        disabled={disabled}
        style={{ ...buyButtonStyle, ...buyBtnColors(disabled, owned) }}
      >
        {buyButtonLabel({ price: item.price, pending, owned })}
      </button>
    </div>
  );
}

/** 이벤트/사진기 공용 카드. 중복 구매 허용, 잔액 부족 시에만 비활성. */
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
  const emoji = readEmoji(item.metadata) ?? (item.item_type === "camera" ? "📷" : "🎁");
  const dim      = !affordable;
  const disabled = pending;

  return (
    <div style={{ ...cardStyle, opacity: dim ? 0.55 : 1 }}>
      {!affordable ? <InsufficientTag /> : null}
      <ItemThumb imageUrl={readImageUrl(item.image_url)} fallback={emoji} alt={item.name} />
      <div style={nameStyle}>{item.name}</div>
      {item.description ? <div style={descStyle}>{item.description}</div> : null}
      <button
        type="button"
        onClick={onBuy}
        disabled={disabled}
        style={{ ...buyButtonStyle, ...buyBtnColors(disabled) }}
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

/* ═════════════════════════════════════════════
 * 스타일 (flashmob 토큰 기반)
 * ═════════════════════════════════════════════ */

const headerRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            12,
  marginBottom:   18,
  flexWrap:       "wrap",
};

const titleStyle: CSSProperties = {
  fontFamily:    HEADING,
  fontSize:      44,
  fontWeight:    400,
  lineHeight:    1,
  letterSpacing: 0.5,
  textTransform: "capitalize",
  color:         "#000",
};

/* 모빌 잔액 — 노랑 pill 배지(매점 정체성) */
const balancePillStyle: CSSProperties = {
  display:      "inline-flex",
  alignItems:   "center",
  gap:          6,
  padding:      "6px 14px",
  borderRadius: 999,
  background:   C.warningTint,
  border:       `1.5px solid ${C.warning}`,
};
const balanceLabelStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   13,
  color:      C.warningText,
};
const balanceNumStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   18,
  color:      C.warningText,
};
const balanceCoinStyle: CSSProperties = {
  fontSize: 14,
};

/* 카테고리 탭 바 */
const tabBarStyle: CSSProperties = {
  display:      "flex",
  gap:          8,
  flexWrap:     "wrap",
  marginBottom: 18,
};
const tabStyle: CSSProperties = {
  display:      "inline-flex",
  alignItems:   "center",
  gap:          6,
  padding:      "8px 16px",
  borderRadius: 999,
  borderWidth:  1.5,
  borderStyle:  "solid",
  borderColor:  C.border,
  background:   "#fff",
  color:        C.textDim,
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
  transition:   "background .14s, border-color .14s, color .14s",
};
const tabActiveStyle: CSSProperties = {
  background:   C.warning,
  borderColor:  C.warning,
  color:        C.textStrong,
  boxShadow:    "0 3px 0 rgba(250,204,21,0.4)",
};
const tabCountStyle: CSSProperties = {
  minWidth:     18,
  height:       18,
  padding:      "0 5px",
  borderRadius: 999,
  background:   "#eef4fb",
  color:        C.textDim,
  fontSize:     11,
  display:      "inline-flex",
  alignItems:   "center",
  justifyContent:"center",
};
const tabCountActiveStyle: CSSProperties = {
  background: "rgba(255,255,255,0.6)",
  color:      C.warningText,
};

const gridStyle: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fill, 150px)",
  gap:                 18,
  justifyContent:      "start",
};

const cardStyle: CSSProperties = {
  position:      "relative",
  width:         150,
  background:    C.bgCard,
  borderWidth:   1.5,
  borderStyle:   "solid",
  borderColor:   C.border,
  borderRadius:  18,
  padding:       "18px 12px 14px",
  textAlign:     "center",
  display:       "flex",
  flexDirection: "column",
  gap:           7,
  boxShadow:     `0 4px 0 ${C.primaryShadow}`,  // flashmob 시그니처 오프셋 그림자
  transition:    "transform .16s, box-shadow .16s, opacity .18s",
};

const insufficientTagStyle: CSSProperties = {
  position:     "absolute",
  top:          8,
  right:        8,
  padding:      "2px 8px",
  borderRadius: 999,
  background:   C.danger,
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     10,
  lineHeight:   1.4,
  whiteSpace:   "nowrap",
  zIndex:       2,
};

const ownedTagStyle: CSSProperties = {
  position:     "absolute",
  top:          8,
  right:        8,
  padding:      "2px 8px",
  borderRadius: 999,
  background:   "#4db6a0",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     10,
  lineHeight:   1.4,
  whiteSpace:   "nowrap",
  zIndex:       2,
};

const emojiStyle: CSSProperties = {
  fontSize:       36,
  lineHeight:     1,
  marginTop:      2,
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
};

const nameStyle: CSSProperties = {
  fontFamily: JUA,
  color:      C.textStrong,
  fontSize:   14,
};

const descStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      C.textDim,
  lineHeight: 1.4,
  minHeight:  28,
};

const buyButtonStyle: CSSProperties = {
  width:        "100%",
  height:       36,
  borderWidth:  0,
  borderRadius: 999,
  fontFamily:   JUA,
  fontSize:     13,
  marginTop:    "auto",  // 카드 하단 붙박이: 설명 길이와 무관하게 버튼 위치 고정
};

const noticeStyle: CSSProperties = {
  padding:    "40px 16px",
  textAlign:  "center",
  fontFamily: BODY,
  fontSize:   13,
  color:      C.textDim,
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