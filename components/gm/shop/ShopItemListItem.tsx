// components/gm/shop/ShopItemListItem.tsx
//
// 좌측 목록의 개별 아이템 카드.
// 요약만 표시하고 클릭 시 우측 편집 폼으로 이동.
//
// 상태 표시:
//   · 좌측 보더 색: item_type 별 구분
//     · marker(사인펜)   보라
//     · sticker(스티커)  주황
//     · wallpaper(배경)  청록
//     · refill_ink(잉크) 파랑
//     · other(기타)      회색
//   · 비활성(내림) 상태: 카드 흐림 + 배지
//   · 선택 상태: 배경·둘레 보더 강조

"use client";

import type { CSSProperties } from "react";
import {
  SHOP_ITEM_TYPE_LABEL,
  type GmShopItem,
  type ShopItemType,
} from "@/lib/gm-shop-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

const TYPE_ACCENT_COLOR: Record<ShopItemType, string> = {
  marker:     "#9b6bc7",
  sticker:    "#e08a5a",
  wallpaper:  "#5aa8a1",
  refill_ink: "#1a9edb",
  other:      "#8a97a1",
};

type Props = {
  item:     GmShopItem;
  isActive: boolean;
  onClick:  () => void;
};

export default function ShopItemListItem({ item, isActive, onClick }: Props) {
  const accentColor   = TYPE_ACCENT_COLOR[item.itemType];
  const surroundColor = isActive ? "#1a9edb" : "#dce8f0";
  const inactive      = !item.isActive;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...itemStyle,
        background:        isActive ? "#e3f3fc" : "#fff",
        borderTopColor:    surroundColor,
        borderRightColor:  surroundColor,
        borderBottomColor: surroundColor,
        borderLeftColor:   accentColor,
        opacity:           inactive ? 0.6 : 1,
      }}
    >
      <div style={topRowStyle}>
        <span style={nameStyle}>{item.name || "(이름 없음)"}</span>
        {inactive ? <span style={inactiveBadgeStyle}>내림</span> : null}
      </div>

      <div style={metaRowStyle}>
        <span style={typeChipStyle}>
          {SHOP_ITEM_TYPE_LABEL[item.itemType]}
        </span>
        <span style={priceStyle}>
          {item.price.toLocaleString()} mobil
        </span>
      </div>

      <div style={codeStyle} title={item.code}>
        {item.code}
      </div>
    </button>
  );
}

/* ── 스타일 ── */

const itemStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           4,
  padding:       "10px 12px",
  borderTopWidth:    1.5,
  borderRightWidth:  1.5,
  borderBottomWidth: 1.5,
  borderLeftWidth:   4,
  borderStyle:       "solid",
  borderRadius:  10,
  background:    "#fff",
  cursor:        "pointer",
  textAlign:     "left",
  width:         "100%",
  transition:    "background .1s, border-color .1s",
};

const topRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            6,
  minWidth:       0,
};

const nameStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     13.5,
  color:        "#14406f",
  overflow:     "hidden",
  textOverflow: "ellipsis",
  whiteSpace:   "nowrap",
  minWidth:     0,
};

const inactiveBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     9,
  padding:      "1.5px 6px",
  borderRadius: 999,
  background:   "#eceff1",
  color:        "#68757e",
  whiteSpace:   "nowrap",
  flexShrink:   0,
};

const metaRowStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        6,
  minWidth:   0,
};

const typeChipStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     10,
  padding:      "1.5px 8px",
  borderRadius: 999,
  background:   "#f0f6fa",
  color:        "#4a6d84",
  whiteSpace:   "nowrap",
  flexShrink:   0,
};

const priceStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#0d6fa8",
  fontWeight: 700,
  marginLeft: "auto",
  whiteSpace: "nowrap",
};

const codeStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     10,
  color:        "#8ca5b8",
  overflow:     "hidden",
  textOverflow: "ellipsis",
  whiteSpace:   "nowrap",
};