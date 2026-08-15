// components/gm/shop/GmShopTab.tsx
//
// GM 매점 관리 탭의 컨테이너 (좌 목록 / 우 편집 · 추가 2단).
//
// 책임:
//   · gm-shop-helpers.listAllShopItems 로 목록 조회
//   · 검색 (이름 · 설명 · 코드)
//   · item_type 필터
//   · 활성/비활성 필터
//   · 좌/우 pane 조립 + 선택 상태 · 모드 관리
//
// 모드 (세션 I 확장):
//   · empty  : 선택된 것도, 추가 중인 것도 없음 → 안내문
//   · edit   : 좌측에서 선택된 아이템 편집 중
//   · create : 우측에서 신규 등록 폼 작성 중 (selectedId 는 null)
//
// 갱신 전략:
//   · patchItem() — 편집·활성 토글 시. 해당 행만 교체 (선택 유지)
//   · refreshAll() — 삭제 시. 목록 재조회 + 선택 해제
//   · onCreated() — 등록 성공 시. 목록에 prepend + 방금 만든 아이템으로 편집 모드 전환

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
import ShopItemList          from "./ShopItemList";
import ShopItemEditor        from "./ShopItemEditor";
import ShopItemCreatePanel   from "./ShopItemCreatePanel";
import SlotConfigPanel       from "./SlotConfigPanel";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

export type ShopTypeFilter = "all" | ShopItemType;
export type ShopActiveFilter = "all" | "active" | "inactive";
export type GmShopMode = "empty" | "edit" | "create";

export default function GmShopTab() {
  const [items,        setItems]        = useState<GmShopItem[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [mode,         setMode]         = useState<GmShopMode>("empty");
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

  /* ── 아이템 선택 (편집 모드 진입) ── */
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setMode("edit");
  }, []);

  /* ── + 새 아이템 (추가 모드 진입) ── */
  const handleStartCreate = useCallback(() => {
    setSelectedId(null);
    setMode("create");
  }, []);

  /* ── 추가 모드 취소 ── */
  const handleCancelCreate = useCallback(() => {
    setMode("empty");
  }, []);

  /* ── 추가 성공 → 목록에 반영 + 편집 모드로 전환 ── */
  const handleCreated = useCallback((created: GmShopItem) => {
    setItems((prev) => [created, ...prev]);
    setSelectedId(created.id);
    setMode("edit");
  }, []);

  /* ── 개별 행 부분 갱신 (선택 유지) ── */
  const patchItem = useCallback((next: GmShopItem) => {
    setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
  }, []);

  /* ── 삭제 후 목록 재조회 + 선택 해제 ── */
  const handleDeleted = useCallback(async () => {
    setSelectedId(null);
    setMode("empty");
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
    if (mode !== "edit") return;
    if (selectedId && !visible.find((it) => it.id === selectedId)) {
      setSelectedId(null);
      setMode("empty");
    }
  }, [visible, selectedId, mode]);

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
    <>
      <SlotConfigPanel />
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
        onSelect={handleSelect}
        counts={counts}
        onRefresh={() => void refreshAll()}
        onCreate={handleStartCreate}
        isCreating={mode === "create"}
      />

      {/* ═════ 우측 pane ═════ */}
      <div style={editorPaneStyle}>
        {mode === "create" ? (
          <ShopItemCreatePanel
            onCreated={handleCreated}
            onCancel={handleCancelCreate}
          />
        ) : mode === "edit" && selectedItem ? (
          <ShopItemEditor
            item={selectedItem}
            onPatch={patchItem}
            onDeleted={() => void handleDeleted()}
          />
        ) : (
          <div style={emptyNoticeStyle}>
            <div style={emptyIconStyle}>🛒</div>
            <div style={emptyTitleStyle}>아이템을 선택하시거나 새 아이템을 등록해 주십시오</div>
            <div style={emptyDescStyle}>
              좌측 목록에서 아이템을 선택하면 편집 · 활성 상태 변경 · 삭제가 가능합니다.
            </div>
            <button
              type="button"
              onClick={handleStartCreate}
              style={emptyCreateButtonStyle}
            >
              + 새 아이템 등록
            </button>
          </div>
        )}
      </div>
    </div>
    </>
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
  gap:            10,
};

const emptyIconStyle: CSSProperties = {
  fontSize:     36,
  opacity:      0.6,
};

const emptyTitleStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     15,
  color:        "#5a7488",
};

const emptyDescStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#8ca5b8",
  lineHeight: 1.6,
  maxWidth:   340,
};

const emptyCreateButtonStyle: CSSProperties = {
  marginTop:    8,
  height:       36,
  padding:      "0 20px",
  border:       "2px solid #0d6fa8",
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
  boxShadow:    "0 3px 0 #0d6fa8",
};