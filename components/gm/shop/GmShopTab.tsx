// components/gm/shop/GmShopTab.tsx
//
// GM 상점 관리 탭의 컨테이너 (좌 목록 / 우 편집 2단).
//
// 책임:
//   · gm-shop-helpers.listAllShopItems 로 목록 조회
//   · 검색 (이름 · 설명 · 코드)
//   · item_type 필터
//   · 활성/비활성 필터
//   · 좌/우 pane 조립 + 선택 상태 관리
//
// 갱신 전략:
//   · patchItem() — 편집·활성 토글 시. 해당 행만 교체 (선택 유지)
//   · refreshAll() — 삭제 시. 목록 재조회 + 선택 해제
//
// 선택 상태 안전장치:
//   필터/검색으로 선택 아이템이 목록에서 사라지거나, 삭제되면 자동 해제.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  listAllShopItems,
  SHOP_ITEM_TYPE_LABEL,
  type GmShopItem,
  type ShopItemType,
} from "@/lib/gm-shop-helpers";
import ShopItemList   from "./ShopItemList";
import ShopItemEditor from "./ShopItemEditor";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

export type ShopTypeFilter = "all" | ShopItemType;
export type ShopActiveFilter = "all" | "active" | "inactive";

export default function GmShopTab() {
  const [items,        setItems]        = useState<GmShopItem[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [query,        setQuery]        = useState("");
  const [typeFilter,   setTypeFilter]   = useState<ShopTypeFilter>("all");
  const [activeFilter, setActiveFilter] = useState<ShopActiveFilter>("all");

  /* ── 목록 조회 ── */
  const refreshAll = useCallback(async () => {
    setLoading(true);
    const rows = await listAllShopItems();
    setItems(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await listAllShopItems();
      if (cancelled) return;
      setItems(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── 개별 행 부분 갱신 (선택 유지) ── */
  const patchItem = useCallback((next: GmShopItem) => {
    setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
  }, []);

  /* ── 삭제 후 목록 재조회 + 선택 해제 ── */
  const handleDeleted = useCallback(async () => {
    setSelectedId(null);
    await refreshAll();
  }, [refreshAll]);

  /* ── 필터 + 검색 적용 ── */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    return items.filter((it) => {
      if (typeFilter !== "all" && it.itemType !== typeFilter) return false;
      if (activeFilter === "active"   && !it.isActive) return false;
      if (activeFilter === "inactive" &&  it.isActive) return false;

      if (q === "") return true;
      const haystack = [it.name, it.description ?? "", it.code, SHOP_ITEM_TYPE_LABEL[it.itemType]]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query, typeFilter, activeFilter]);

  /* ── 선택 아이템이 목록에서 사라지면 자동 해제 ── */
  useEffect(() => {
    if (selectedId && !visible.find((it) => it.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible, selectedId]);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId],
  );

  /* ── 카운트 요약 ── */
  const counts = useMemo(() => {
    const total    = items.length;
    const active   = items.filter((it) => it.isActive).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [items]);

  return (
    <div style={splitStyle}>
      {/* ═════ 좌측 목록 pane ═════ */}
      <ShopItemList
        items={visible}
        loading={loading}
        query={query}
        onQueryChange={setQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        activeFilter={activeFilter}
        onActiveFilterChange={setActiveFilter}
        selectedId={selectedId}
        onSelect={setSelectedId}
        counts={counts}
        onRefresh={() => void refreshAll()}
      />

      {/* ═════ 우측 편집 pane ═════ */}
      <div style={editorPaneStyle}>
        {selectedItem ? (
          <ShopItemEditor
            item={selectedItem}
            onPatch={patchItem}
            onDeleted={() => void handleDeleted()}
          />
        ) : (
          <div style={emptyNoticeStyle}>
            <div style={emptyIconStyle}>🛒</div>
            <div style={emptyTitleStyle}>아이템을 선택해주십시오</div>
            <div style={emptyDescStyle}>
              좌측 목록에서 아이템을 선택하시면 편집 · 활성 상태 변경 · 삭제가 가능합니다.
            </div>
            <div style={emptyHintStyle}>
              신규 아이템 추가 기능은 준비 중입니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 스타일 ── */

/** 좌우 pane 공통 높이. 페이지 상단(헤더+탭바) 감안. */
const PANE_HEIGHT     = "calc(100vh - 240px)";
const PANE_MIN_HEIGHT = 480;

const splitStyle: CSSProperties = {
  display:    "flex",
  gap:        12,
  alignItems: "stretch",
};

const editorPaneStyle: CSSProperties = {
  flex:      1,
  minWidth:  0,
  height:    PANE_HEIGHT,
  minHeight: PANE_MIN_HEIGHT,
  overflow:  "auto",
  padding:   "2px 4px 20px",
};

const emptyNoticeStyle: CSSProperties = {
  display:        "flex",
  flexDirection:  "column",
  alignItems:     "center",
  justifyContent: "center",
  height:         "100%",
  padding:        "40px 20px",
  textAlign:      "center",
  background:     "#fff",
  border:         "1.5px dashed #dce8f0",
  borderRadius:   12,
};

const emptyIconStyle: CSSProperties = {
  fontSize:     36,
  marginBottom: 12,
  opacity:      0.6,
};

const emptyTitleStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     15,
  color:        "#5a7488",
  marginBottom: 6,
};

const emptyDescStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#8ca5b8",
  lineHeight: 1.6,
  maxWidth:   340,
};

const emptyHintStyle: CSSProperties = {
  marginTop:  14,
  padding:    "4px 12px",
  border:     "1.5px dashed #cfd8de",
  borderRadius: 999,
  fontFamily: BODY,
  fontSize:   11,
  color:      "#7a94a8",
};