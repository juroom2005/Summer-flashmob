// components/gm/shop/ShopItemList.tsx
//
// 좌측 목록 pane. 새 아이템 버튼 · 검색 · 타입 필터 · 활성 필터 · 리스트 · 카운트 요약.
//
// 세션 I 확장:
//   · 상단에 "+ 새 아이템" 버튼 신설 (onCreate 콜백)
//   · 추가 모드 중일 때 (isCreating=true) 는 버튼이 강조 상태로 유지
//
// 필터 정책:
//   · typeFilter   : "all" 또는 shop_items.item_type 값 하나
//   · activeFilter : "all" · "active" · "inactive"
//   · 검색어       : name · description · code · 타입 라벨 매칭 (소문자화)
//
// 스크롤:
//   · 헤더(추가 버튼·검색·필터·카운트) 고정
//   · 리스트 영역만 세로 스크롤

"use client";

import type { CSSProperties, ChangeEvent } from "react";
import {
  SHOP_ITEM_TYPE_LABEL,
  type GmShopItem,
} from "@/lib/gm-shop-helpers";
import type { ShopTypeFilter, ShopActiveFilter } from "./GmShopTab";
import ShopItemListItem from "./ShopItemListItem";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

const TYPE_FILTERS: { key: ShopTypeFilter; label: string }[] = [
  { key: "all",        label: "전체"           },
  { key: "marker",     label: SHOP_ITEM_TYPE_LABEL.marker     },
  { key: "sticker",    label: SHOP_ITEM_TYPE_LABEL.sticker    },
  { key: "wallpaper",  label: SHOP_ITEM_TYPE_LABEL.wallpaper  },
  { key: "refill_ink", label: SHOP_ITEM_TYPE_LABEL.refill_ink },
  { key: "other",      label: SHOP_ITEM_TYPE_LABEL.other      },
];

const ACTIVE_FILTERS: { key: ShopActiveFilter; label: string }[] = [
  { key: "all",      label: "전체" },
  { key: "active",   label: "판매중" },
  { key: "inactive", label: "내림" },
];

type Props = {
  items:                 GmShopItem[];
  loading:               boolean;
  query:                 string;
  onQueryChange:         (v: string) => void;
  typeFilter:            ShopTypeFilter;
  onTypeFilterChange:    (v: ShopTypeFilter) => void;
  activeFilter:          ShopActiveFilter;
  onActiveFilterChange:  (v: ShopActiveFilter) => void;
  selectedId:            string | null;
  onSelect:              (id: string) => void;
  counts:                { total: number; active: number; inactive: number };
  onRefresh:             () => void;
  /** 새 아이템 등록 시작 콜백 */
  onCreate:              () => void;
  /** 우측이 추가 모드인지 (버튼 강조용) */
  isCreating:            boolean;
};

export default function ShopItemList({
  items, loading, query, onQueryChange,
  typeFilter, onTypeFilterChange,
  activeFilter, onActiveFilterChange,
  selectedId, onSelect, counts, onRefresh,
  onCreate, isCreating,
}: Props) {
  return (
    <div style={listPaneStyle}>
      {/* + 새 아이템 버튼 */}
      <button
        type="button"
        onClick={onCreate}
        style={{
          ...createButtonStyle,
          background:  isCreating ? "#0d6fa8" : "#1a9edb",
          boxShadow:   isCreating ? "0 1px 0 #0a5788 inset" : "0 3px 0 #0d6fa8",
          transform:   isCreating ? "translateY(2px)" : "none",
        }}
      >
        + 새 아이템
      </button>

      {/* 검색 */}
      <input
        value={query}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onQueryChange(e.target.value)}
        placeholder="이름 · 설명 · 코드"
        style={searchInputStyle}
      />

      {/* 타입 필터 (2행 chip) */}
      <div style={filterGridStyle}>
        {TYPE_FILTERS.map((f) => {
          const active = typeFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onTypeFilterChange(f.key)}
              style={{
                ...filterChipStyle,
                background:  active ? "#1a9edb" : "#fff",
                color:       active ? "#fff"    : "#0d6fa8",
                borderColor: active ? "#0d6fa8" : "#bfe4f7",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* 활성 필터 */}
      <div style={activeFilterRowStyle}>
        {ACTIVE_FILTERS.map((f) => {
          const active = activeFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onActiveFilterChange(f.key)}
              style={{
                ...activeFilterButtonStyle,
                background:  active ? "#4db6a0" : "#fff",
                color:       active ? "#fff"    : "#2e7d6b",
                borderColor: active ? "#2e7d6b" : "#c6e6dc",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* 카운트 요약 + 새로고침 */}
      <div style={summaryBarStyle}>
        <span>총 {counts.total}</span>
        <span style={dotStyle}>·</span>
        <span>판매중 {counts.active}</span>
        {counts.inactive > 0 ? (
          <>
            <span style={dotStyle}>·</span>
            <span>내림 {counts.inactive}</span>
          </>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="새로고침"
          style={{
            ...refreshButtonStyle,
            opacity: loading ? 0.4 : 1,
            cursor:  loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "…" : "↻"}
        </button>
      </div>

      {/* 리스트 */}
      <div style={listScrollStyle}>
        {loading ? (
          <div style={listNoticeStyle}>불러오는 중입니다…</div>
        ) : items.length === 0 ? (
          <div style={listNoticeStyle}>
            {query.trim() !== "" || typeFilter !== "all" || activeFilter !== "all"
              ? "조건에 맞는 아이템이 없습니다."
              : "표시할 아이템이 없습니다."}
          </div>
        ) : (
          items.map((it) => (
            <ShopItemListItem
              key={it.id}
              item={it}
              isActive={it.id === selectedId}
              onClick={() => onSelect(it.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ── 스타일 ── */

const PANE_HEIGHT     = "calc(100vh - 240px)";
const PANE_MIN_HEIGHT = 480;

const listPaneStyle: CSSProperties = {
  width:         260,
  flexShrink:    0,
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  height:        PANE_HEIGHT,
  minHeight:     PANE_MIN_HEIGHT,
};

const createButtonStyle: CSSProperties = {
  height:       36,
  padding:      "0 16px",
  border:       "2px solid #0d6fa8",
  borderRadius: 999,
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
  flexShrink:   0,
  transition:   "background .12s, transform .06s, box-shadow .12s",
};

const searchInputStyle: CSSProperties = {
  height:       32,
  border:       "1.5px solid #cfe4f2",
  borderRadius: 999,
  padding:      "0 14px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#2c4a60",
  outline:      "none",
  background:   "#fff",
  flexShrink:   0,
};

const filterGridStyle: CSSProperties = {
  display:              "grid",
  gridTemplateColumns:  "repeat(3, 1fr)",
  gap:                  4,
  flexShrink:           0,
};

const filterChipStyle: CSSProperties = {
  height:       26,
  padding:      "0 6px",
  border:       "1.5px solid #bfe4f7",
  borderRadius: 999,
  fontFamily:   JUA,
  fontSize:     10.5,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
  overflow:     "hidden",
  textOverflow: "ellipsis",
};

const activeFilterRowStyle: CSSProperties = {
  display:    "flex",
  gap:        4,
  flexShrink: 0,
};

const activeFilterButtonStyle: CSSProperties = {
  flex:         1,
  height:       26,
  padding:      "0 8px",
  border:       "1.5px solid #c6e6dc",
  borderRadius: 999,
  fontFamily:   JUA,
  fontSize:     11,
  cursor:       "pointer",
};

const summaryBarStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        4,
  fontFamily: BODY,
  fontSize:   11,
  color:      "#5a7488",
  flexShrink: 0,
  padding:    "0 4px",
};

const dotStyle: CSSProperties = { color: "#b8c6d0" };

const refreshButtonStyle: CSSProperties = {
  marginLeft:   "auto",
  width:        26,
  height:       26,
  border:       "1.5px solid #cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     12,
  padding:      0,
};

const listScrollStyle: CSSProperties = {
  flex:          1,
  minHeight:     0,
  overflowY:     "auto",
  display:       "flex",
  flexDirection: "column",
  gap:           6,
  padding:       "4px 2px",
};

const listNoticeStyle: CSSProperties = {
  padding:    "32px 12px",
  textAlign:  "center",
  fontFamily: BODY,
  fontSize:   12,
  color:      "#7a94a8",
};