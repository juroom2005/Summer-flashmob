// components/gm/users/UserListItem.tsx
//
// 좌측 목록의 개별 행. 요약만 표시하고 클릭 시 우측 상세로 이동.
//
// 상태 표시 (좌측 보더 색):
//   · GM             파랑
//   · 가입           초록
//   · 미가입(shell)  노랑
//   · 비활성         회색 + 흐림
//
// 선택 상태(isActive)에서는 배경·보더가 진해지며 시각적 강조.

"use client";

import type { CSSProperties } from "react";
import type { GmUserRow } from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

type Props = {
  user:     GmUserRow;
  isActive: boolean;
  onClick:  () => void;
};

export default function UserListItem({ user, isActive, onClick }: Props) {
  const displayName =
    [user.family_name, user.given_name].filter(Boolean).join(" ") ||
    "(이름 미등록)";
  const isDeactivated = user.deactivated_at !== null;
  const accentColor = user.is_gm
    ? "#1a9edb"
    : isDeactivated
    ? "#b0b8be"
    : user.is_registered
    ? "#4db6a0"
    : "#e0a500";

  // border 색상은 4방향 longhand 로만 지정 (borderColor shorthand 사용 금지).
  // shorthand 를 쓰면 borderLeftColor 와 재렌더 순서에 따라 충돌 경고가 발생함.
  const surroundColor = isActive ? "#1a9edb" : "#dce8f0";

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
        opacity:           isDeactivated ? 0.65 : 1,
      }}
    >
      <div style={topRowStyle}>
        <span style={nameStyle}>{displayName}</span>
        <span style={badgeRowStyle}>
          {user.is_gm ? <span style={gmBadgeStyle}>GM</span> : null}
          {!user.is_registered ? (
            <span style={shellBadgeStyle}>미가입</span>
          ) : null}
          {isDeactivated ? (
            <span style={inactiveBadgeStyle}>비활성</span>
          ) : null}
        </span>
      </div>

      <div style={metaStyle}>
        {user.school_name || "학교 미등록"}
        {user.grade ? ` · ${user.grade}학년` : ""}
        {user.age !== null ? ` · ${user.age}세` : ""}
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
  // shorthand `border` 를 쓰면 동적 borderColor/borderLeftColor 와 충돌하므로 분해
  borderTopWidth:    1.5,
  borderRightWidth:  1.5,
  borderBottomWidth: 1.5,
  borderLeftWidth:   4,
  borderStyle:       "solid",
  // 색상은 인라인 style 에서 borderColor / borderLeftColor 로 매 렌더 지정
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

const badgeRowStyle: CSSProperties = {
  display:    "flex",
  gap:        3,
  flexShrink: 0,
};

const baseBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     9,
  padding:      "1.5px 6px",
  borderRadius: 999,
  whiteSpace:   "nowrap",
};

const gmBadgeStyle: CSSProperties = {
  ...baseBadgeStyle,
  background: "#e3f3fc",
  color:      "#0d6fa8",
};

const shellBadgeStyle: CSSProperties = {
  ...baseBadgeStyle,
  background: "#fdf3d8",
  color:      "#9a6b00",
};

const inactiveBadgeStyle: CSSProperties = {
  ...baseBadgeStyle,
  background: "#eceff1",
  color:      "#68757e",
};

const metaStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     11,
  color:        "#5a7488",
  overflow:     "hidden",
  textOverflow: "ellipsis",
  whiteSpace:   "nowrap",
};