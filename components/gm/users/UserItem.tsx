// components/gm/users/UserItem.tsx
//
// 유저 목록의 개별 행. 접힘 상태에선 요약, 펼치면 4개 관리 패널.
//
// 구성 (펼침 시):
//   1) UserEditForm    — 기본 정보 6종
//   2) StatAdjustPanel — 스탯 3종 증감
//   3) MobilGrantPanel — 재화 지급·차감
//   4) UserDangerZone  — 비활성화 / 완전 삭제
//
// 상태 표시:
//   · 미가입(shell)  — 회색 톤, "미가입" 배지
//   · 비활성         — 흐림 처리, "비활성" 배지
//   · GM             — 파란 배지, 위험 기능 차단
//
// 갱신 전략:
//   · 기본 정보·스탯·재화는 부분 갱신(onPatch)으로 목록 재조회 없이 반영
//     → 펼친 상태가 유지되어 연속 작업이 끊기지 않음
//   · 비활성화·삭제는 목록 구성 자체가 바뀌므로 전체 재조회(onRefresh)

"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import type { GmProfilePatch, GmUserRow, StatResult } from "@/lib/gm-user-helpers";
import UserEditForm    from "./UserEditForm";
import StatAdjustPanel from "./StatAdjustPanel";
import MobilGrantPanel from "./MobilGrantPanel";
import UserDangerZone  from "./UserDangerZone";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

const GENDER_LABEL: Record<string, string> = {
  male:   "남",
  female: "여",
  other:  "기타",
};

type Props = {
  user: GmUserRow;
  /** 목록 내 해당 행만 부분 갱신 (펼침 유지). */
  onPatch: (profileId: string, patch: Partial<GmUserRow>) => void;
  /** 목록 전체 재조회 (비활성화·삭제 후). */
  onRefresh: () => void;
};

export default function UserItem({ user, onPatch, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false);

  const displayName =
    [user.family_name, user.given_name].filter(Boolean).join(" ") ||
    "(이름 미등록)";

  const isDeactivated = user.deactivated_at !== null;

  /* ── 하위 패널 콜백 ── */

  function handleProfileSaved(patch: GmProfilePatch) {
    onPatch(user.id, patch as Partial<GmUserRow>);
  }

  function handleStatsAdjusted(next: StatResult) {
    onPatch(user.id, {
      rhythm_stat:     next.rhythm_stat,
      physical_stat:   next.physical_stat,
      expression_stat: next.expression_stat,
    });
  }

  function handleMobilGranted(nextMobil: number) {
    onPatch(user.id, { mobil: nextMobil });
  }

  function toggleExpand(e: MouseEvent<HTMLDivElement>) {
    // 내부 인터랙티브 요소 클릭 시엔 토글하지 않음
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, label")) return;
    setExpanded((v) => !v);
  }

  return (
    <div
      style={{
        ...cardStyle,
        opacity:         isDeactivated ? 0.6 : 1,
        borderLeftColor: user.is_gm
          ? "#1a9edb"
          : isDeactivated
          ? "#b0b8be"
          : user.is_registered
          ? "#4db6a0"
          : "#e0a500",
      }}
    >
      {/* ── 요약 헤더 (클릭 시 펼침 토글) ── */}
      <div style={headerStyle} onClick={toggleExpand}>
        <div style={nameBlockStyle}>
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

        <div style={summaryStyle}>
          <span style={summaryItemStyle}>
            {user.school_name || "학교 미등록"}
            {user.grade ? ` ${user.grade}학년` : ""}
          </span>
          <span style={summaryDotStyle}>·</span>
          <span style={summaryItemStyle}>
            {user.age !== null ? `${user.age}세` : "나이 미등록"}
          </span>
          {user.gender ? (
            <>
              <span style={summaryDotStyle}>·</span>
              <span style={summaryItemStyle}>{GENDER_LABEL[user.gender]}</span>
            </>
          ) : null}
        </div>

        <div style={metricRowStyle}>
          <span style={statChipStyle}>🎵 {user.rhythm_stat}</span>
          <span style={statChipStyle}>💪 {user.physical_stat}</span>
          <span style={statChipStyle}>✨ {user.expression_stat}</span>
          <span style={mobilChipStyle}>💰 {user.mobil.toLocaleString()}</span>
        </div>

        <span style={chevronStyle}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* ── 펼침 영역 ── */}
      {expanded ? (
        <div style={bodyStyle}>
          {user.email ? (
            <div style={emailRowStyle}>계정 이메일 · {user.email}</div>
          ) : (
            <div style={emailRowStyle}>
              아직 가입하지 않은 초대 대상입니다.
            </div>
          )}

          <UserEditForm user={user} onSaved={handleProfileSaved} />

          <StatAdjustPanel
            profileId={user.id}
            rhythm={user.rhythm_stat}
            physical={user.physical_stat}
            expression={user.expression_stat}
            onAdjusted={handleStatsAdjusted}
          />

          <MobilGrantPanel
            profileId={user.id}
            mobil={user.mobil}
            onGranted={handleMobilGranted}
          />

          <UserDangerZone
            profileId={user.id}
            displayName={displayName}
            isGm={user.is_gm}
            deactivatedAt={user.deactivated_at}
            onChanged={onRefresh}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ── 스타일 ── */

const cardStyle: CSSProperties = {
  border:          "1.5px solid #dce8f0",
  borderLeft:      "5px solid #4db6a0",
  borderRadius:    12,
  background:      "#fff",
  boxShadow:       "0 2px 0 rgba(46,163,221,.08)",
  overflow:        "hidden",
};

const headerStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        12,
  padding:    "10px 14px",
  cursor:     "pointer",
  flexWrap:   "wrap",
};

const nameBlockStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        6,
  minWidth:   0,
};

const nameStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   14,
  color:      "#14406f",
  whiteSpace: "nowrap",
};

const badgeRowStyle: CSSProperties = {
  display: "flex",
  gap:     4,
};

const baseBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     9.5,
  padding:      "2px 7px",
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

const summaryStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        5,
  minWidth:   0,
};

const summaryItemStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     11.5,
  color:        "#5a7488",
  whiteSpace:   "nowrap",
  overflow:     "hidden",
  textOverflow: "ellipsis",
};

const summaryDotStyle: CSSProperties = {
  color:    "#b8c6d0",
  fontSize: 11,
};

const metricRowStyle: CSSProperties = {
  display:    "flex",
  gap:        4,
  marginLeft: "auto",
};

const statChipStyle: CSSProperties = {
  fontFamily:   GAEGU,
  fontSize:     12,
  color:        "#2c4a60",
  background:   "#f2f8fc",
  border:       "1px solid #dfeaf2",
  borderRadius: 999,
  padding:      "2px 8px",
  whiteSpace:   "nowrap",
};

const mobilChipStyle: CSSProperties = {
  ...statChipStyle,
  background:  "#fffaeb",
  borderColor: "#f0e4c0",
  color:       "#9a6b00",
};

const chevronStyle: CSSProperties = {
  fontSize: 9,
  color:    "#9ab0c0",
};

const bodyStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           10,
  padding:       "0 14px 14px",
  borderTop:     "1px dashed #e0eaf2",
  paddingTop:    12,
};

const emailRowStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#7a94a8",
};