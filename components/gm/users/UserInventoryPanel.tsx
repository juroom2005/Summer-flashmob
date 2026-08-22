// components/gm/users/UserInventoryPanel.tsx
//
// 대상 유저의 인벤토리 상태 확인 패널 (GM 전용, 읽기 전용).
//
// 표시:
//   · 타입별 그룹핑 후, 그룹 내 아이템 목록.
//   · 각 행: 이름(metadata.name 우선) · 수량 · 사인펜은 내구도.
//   · 조회 실패 시 안내 (빈 배열 → "인벤토리가 비어 있습니다").
//
// 조회는 부모(UserItemsSection)가 담당하고, 이 컴포넌트는 표시만 한다.
// (지급 패널과 인벤토리 데이터를 공유해야 하므로 조회 책임을 부모로 올림)

"use client";

import { useMemo, type CSSProperties } from "react";
import type { GmInventoryRow } from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** item_type → 화면 라벨. */
const TYPE_LABEL: Record<string, string> = {
  marker:    "사인펜",
  sticker:   "스티커",
  camera:    "사진기",
  other:     "이벤트",
  doll:      "인형",
  coupon:    "교환권",
  junk:      "잡템",
  wallpaper: "배경지",
};

/** 표시 순서 (없는 타입은 뒤로). */
const TYPE_ORDER = [
  "marker", "sticker", "camera", "doll", "coupon", "junk", "other", "wallpaper",
];

type Props = {
  rows:      GmInventoryRow[];
  loading:   boolean;
  onRefresh: () => void;
};

function displayName(row: GmInventoryRow): string {
  const n = row.metadata?.["name"];
  if (typeof n === "string" && n.trim()) return n.trim();
  return row.item_ref ?? "(이름 없음)";
}

export default function UserInventoryPanel({ rows, loading, onRefresh }: Props) {
  // 타입별 그룹핑
  const groups = useMemo(() => {
    const map = new Map<string, GmInventoryRow[]>();
    for (const r of rows) {
      const arr = map.get(r.item_type) ?? [];
      arr.push(r);
      map.set(r.item_type, arr);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a[0]);
      const ib = TYPE_ORDER.indexOf(b[0]);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    return entries;
  }, [rows]);

  const totalCount = useMemo(
    () => rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0),
    [rows],
  );

  return (
    <div style={wrapStyle}>
      <div style={headerRowStyle}>
        <span style={sectionTitleStyle}>🎒 인벤토리</span>
        <div style={headerRightStyle}>
          <span style={countStyle}>
            {loading ? "" : `${rows.length}종 · 총 ${totalCount.toLocaleString()}개`}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            style={{
              ...refreshButtonStyle,
              opacity: loading ? 0.4 : 1,
              cursor:  loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "..." : "새로고침"}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={emptyStyle}>불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div style={emptyStyle}>인벤토리가 비어 있습니다.</div>
      ) : (
        <div style={groupStackStyle}>
          {groups.map(([type, list]) => (
            <div key={type} style={groupStyle}>
              <div style={groupHeadStyle}>
                {TYPE_LABEL[type] ?? type}
                <span style={groupCountStyle}>{list.length}</span>
              </div>
              <div style={itemStackStyle}>
                {list.map((r) => (
                  <div key={r.id} style={itemRowStyle}>
                    <span style={itemNameStyle}>{displayName(r)}</span>
                    <span style={itemMetaStyle}>
                      {type === "marker" && r.durability !== null
                        ? `내구도 ${r.durability}`
                        : `×${r.quantity}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  padding:       12,
  background:    "#f5f9fc",
  border:        "1.5px solid #d3e4ef",
  borderRadius:  10,
};

const headerRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            8,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#0d6fa8",
};

const headerRightStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
};

const countStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#5a8aa8",
};

const refreshButtonStyle: CSSProperties = {
  height:       24,
  padding:      "0 10px",
  border:       "1.5px solid #bfe4f7",
  borderRadius: 999,
  background:   "#fff",
  color:        "#0d6fa8",
  fontFamily:   JUA,
  fontSize:     11,
};

const emptyStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#7a94a8",
  padding:    "6px 0",
};

const groupStackStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           8,
};

const groupStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           4,
};

const groupHeadStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        6,
  fontFamily: JUA,
  fontSize:   11.5,
  color:      "#2c4a60",
};

const groupCountStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     10,
  color:        "#7a94a8",
  background:   "#e7f1f8",
  borderRadius: 999,
  padding:      "1px 7px",
};

const itemStackStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           3,
};

const itemRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            8,
  padding:        "5px 10px",
  background:     "#fff",
  border:         "1px solid #e4eef5",
  borderRadius:   7,
};

const itemNameStyle: CSSProperties = {
  fontFamily:    BODY,
  fontSize:      12,
  color:         "#2c4a60",
  overflow:      "hidden",
  textOverflow:  "ellipsis",
  whiteSpace:    "nowrap",
};

const itemMetaStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   11,
  color:      "#0d6fa8",
  flexShrink: 0,
};
