// components/noticeboard/panels/InventorySection.tsx
//
// 마이패널 내 인벤토리 섹션 (실 데이터 연동, v3).
//
// v2 → v3 변경 (세션 I):
//   · marker 이모지 우선순위 확장 : metadata.emoji > MARKER_EMOJI[item_ref] > 🖊️
//   · other 타입 렌더 신설 (이벤트성 아이템, quantity 누적 표시)
//   · 안내문·주석 "상점" → "매점"
//
// 아이템별 표현:
//   · marker : 이모지(우선순위) + 남은 획 (durability/initial_durability)
//   · sticker: 이모지(item_ref) + "무제한 사용"
//   · other  : 이모지(metadata.emoji 또는 기본 🎁) + "×N" (quantity)
//
// 라벨 정책:
//   · marker  : MARKER_LABEL 하드코딩 매핑 (없으면 "사인펜")
//   · sticker : "스티커" 고정
//   · other   : item_ref 를 표시용으로 변환 (언더스코어 → 공백).
//     - 인벤토리에는 shop_items.name 이 저장되지 않으므로 v10 에서
//       구매 시점 이름 스냅샷 (metadata.name) 도입 후 여기 로직 개선 예정.
//
// 코르크보드 스타일은 기존 톤 유지 (프론트 리뉴얼 예정, 최소 침습).
// 향후 hover 툴팁에 실제 사용법이 붙을 예정 (사인펜 클릭 → 일지 진입 등).

"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import {
  listMyInventoryItems,
  type InventoryItemRow,
} from "@/lib/inventory-helpers";
import styles from "./InventorySection.module.css";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";
const NAVY  = "#14406f";

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

type Displayable = {
  key:     string;   // React key
  emoji:   string;
  label:   string;
  badge:   string;   // 우하단 노란 원 안 문구 (예: "×1", "78/100", "∞")
  tooltip: string;
};

/** metadata 에서 emoji 를 안전 추출. */
function readEmoji(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const v = metadata.emoji;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** item_ref (영문 슬러그) 를 사람이 읽기 쉬운 라벨로 변환.
 *  예: "soda_ice_cream" → "soda ice cream" */
function prettyRef(ref: string): string {
  const s = ref.replace(/_/g, " ").trim();
  return s.length > 0 ? s : "이벤트 아이템";
}

/**
 * inventory row 를 UI 표시용 형태로 변환.
 * 알 수 없는 item_type / item_ref 는 조용히 스킵.
 */
function toDisplayable(row: InventoryItemRow): Displayable | null {
  if (row.item_type === "marker" && row.item_ref) {
    // 이모지 우선순위 : metadata.emoji > MARKER_EMOJI[item_ref] > 🖊️
    const emoji = readEmoji(row.metadata) ?? MARKER_EMOJI[row.item_ref] ?? "🖊️";
    const label = MARKER_LABEL[row.item_ref] ?? "사인펜";
    const cur   = row.durability ?? 0;
    const maxRaw = row.metadata?.["initial_durability"];
    const max   = typeof maxRaw === "number" ? maxRaw : 100;
    return {
      key:     row.id,
      emoji,
      label,
      badge:   `${cur}/${max}`,
      tooltip: `일지에 그림을 그릴 수 있습니다. 남은 획 ${cur}/${max}`,
    };
  }

  if (row.item_type === "sticker" && row.item_ref) {
    return {
      key:     row.id,
      emoji:   row.item_ref,
      label:   "스티커",
      badge:   "∞",
      tooltip: "일지에 자유롭게 붙일 수 있습니다. 무제한 사용",
    };
  }

  if (row.item_type === "other" && row.item_ref) {
    const emoji = readEmoji(row.metadata) ?? "🎁";
    const label = prettyRef(row.item_ref);
    const qty   = row.quantity ?? 1;
    return {
      key:     row.id,
      emoji,
      label,
      badge:   `×${qty}`,
      tooltip: `이벤트 아이템 · 소지 ${qty}개`,
    };
  }

  // wallpaper 는 아직 범위 밖.
  return null;
}

export default function InventorySection() {
  const [items,   setItems]   = useState<Displayable[]>([]);
  const [loading, setLoading] = useState(true);
  const [hovIdx,  setHovIdx]  = useState(-1);

  const refresh = useCallback(async () => {
    const rows = await listMyInventoryItems();
    const displayables = rows
      .map(toDisplayable)
      .filter((v): v is Displayable => v !== null);
    setItems(displayables);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    // 매점 구매 등 profile 변경 이벤트 → 인벤토리도 재조회
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

  return (
    <div style={sectionWrapStyle}>
      <div style={sectionHeaderStyle}>
        <span style={secTitleStyle}>인벤토리</span>
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
          <div style={gridStyle}>
            {items.map((it, i) => (
              <div
                key={it.key}
                className={styles.memo}
                onMouseEnter={() => setHovIdx(i)}
                onMouseLeave={() => setHovIdx(-1)}
                style={{
                  ...memoCardStyle,
                  transform: `rotate(${(i % 2 ? 1 : -1) * (1 + (i % 3)) * 1.3}deg)`,
                }}
              >
                {/* 테이프 */}
                <div
                  style={{
                    ...tapeStyle,
                    background: TAPE[i % TAPE.length],
                  }}
                />
                <div style={itemEmojiStyle}>{it.emoji}</div>
                <div style={itemLabelStyle}>{it.label}</div>
                <div style={badgeStyle}>{it.badge}</div>
                {hovIdx === i ? (
                  <div className={styles.tooltipPop} style={tooltipStyle}>
                    {it.tooltip}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
  cursor:        "help",
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