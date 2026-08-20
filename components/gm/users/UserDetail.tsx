// components/gm/users/UserDetail.tsx
//
// 선택된 유저의 상세 관리 화면 (우측 pane).
//
// 구성:
//   상단 헤더:
//     · 이름 + 배지 (GM / 미가입 / 비활성)
//     · 이메일 (없으면 안내 문구)
//     · 스탯·재화 요약 chip (조정 시 실시간 반영)
//   본문 (세로 배치):
//     1) UserEditForm       — 기본 정보 6종
//     2) StatAdjustPanel    — 스탯 3종 증감
//     3) MobilGrantPanel    — 재화 지급·차감
//     4) MinigameResetPanel — 오늘 미니게임 카운트 확인·리셋 (가입 유저만)
//     5) PasswordResetPanel — 비밀번호 재설정 (가입 유저·GM 제외)
//     6) UserDangerZone     — 비활성화 / 완전 삭제
//
// 갱신 전략:
//   기본 정보·스탯·재화는 onPatch로 부분 갱신 → 선택 상태·스크롤 유지
//   비활성화·삭제는 onRefresh로 목록 전체 재조회

"use client";

import type { CSSProperties } from "react";
import type {
  GmProfilePatch,
  GmUserRow,
  StatResult,
} from "@/lib/gm-user-helpers";
import UserEditForm       from "./UserEditForm";
import AvatarSetPanel     from "./AvatarSetPanel";
import SpriteSetPanel     from "./SpriteSetPanel";
import StatAdjustPanel    from "./StatAdjustPanel";
import MobilGrantPanel    from "./MobilGrantPanel";
import PasswordResetPanel from "./PasswordResetPanel";
import MinigameResetPanel from "./MinigameResetPanel";
import BotLinkPanel       from "./BotLinkPanel";
import UserDangerZone     from "./UserDangerZone";


const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

const GENDER_LABEL: Record<string, string> = {
  male:   "남",
  female: "여",
  other:  "기타",
};

type Props = {
  user:      GmUserRow;
  /** 부분 갱신 (선택 유지). */
  onPatch:   (profileId: string, patch: Partial<GmUserRow>) => void;
  /** 목록 전체 재조회 (비활성화·삭제 후). */
  onRefresh: () => void;
};

export default function UserDetail({ user, onPatch, onRefresh }: Props) {
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
      rhythm_exp:       next.rhythm_exp,
      rhythm_level:     next.rhythm_level,
      physical_exp:     next.physical_exp,
      physical_level:   next.physical_level,
      expression_exp:   next.expression_exp,
      expression_level: next.expression_level,
    });
  }

  function handleMobilGranted(nextMobil: number) {
    onPatch(user.id, { mobil: nextMobil });
  }

  return (
    <div style={wrapStyle}>
      {/* ── 헤더 ── */}
      <div style={headerStyle}>
        <div style={headerTopStyle}>
          <div style={nameBlockStyle}>
            <h2 style={nameStyle}>{displayName}</h2>
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
        </div>

        <div style={emailRowStyle}>
          {user.email
            ? `계정 이메일 · ${user.email}`
            : "아직 가입하지 않은 초대 대상입니다."}
        </div>

        <div style={summaryRowStyle}>
          <span style={summaryItemStyle}>
            {user.school_name || "학교 미등록"}
            {user.grade ? ` ${user.grade}학년` : ""}
          </span>
          {user.age !== null ? (
            <>
              <span style={dotStyle}>·</span>
              <span style={summaryItemStyle}>{user.age}세</span>
            </>
          ) : null}
          {user.gender ? (
            <>
              <span style={dotStyle}>·</span>
              <span style={summaryItemStyle}>{GENDER_LABEL[user.gender]}</span>
            </>
          ) : null}
        </div>

        <div style={metricRowStyle}>
          <span style={statChipStyle}>🎵 리듬 Lv{user.rhythm_level}</span>
          <span style={statChipStyle}>💪 체력 Lv{user.physical_level}</span>
          <span style={statChipStyle}>✨ 표현력 Lv{user.expression_level}</span>
          <span style={mobilChipStyle}>
            💰 {user.mobil.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── 관리 패널 ── */}
      <UserEditForm user={user} onSaved={handleProfileSaved} />

      {/* 학생증 두상: 유저 본인은 못 넣고 GM 이 여기서 설정.
          shell(미가입)도 profile 행은 있으므로 조건 없이 노출. */}
      <AvatarSetPanel profileId={user.id} displayName={displayName} />

      {/* 리듬게임 캐릭터 스프라이트: 두상과 동일하게 GM 이 여기서 설정.
          저장된 스프라이트는 리듬게임에서 본인 캐릭터로 사용된다. */}
      <SpriteSetPanel profileId={user.id} displayName={displayName} />

      <StatAdjustPanel
        profileId={user.id}
        rhythmExp={user.rhythm_exp}
        rhythmLevel={user.rhythm_level}
        physicalExp={user.physical_exp}
        physicalLevel={user.physical_level}
        expressionExp={user.expression_exp}
        expressionLevel={user.expression_level}
        onAdjusted={handleStatsAdjusted}
      />

      <MobilGrantPanel
        profileId={user.id}
        mobil={user.mobil}
        onGranted={handleMobilGranted}
      />

      <BotLinkPanel profileId={user.id} />

      {/* 미니게임 오늘 카운트 관리 : 가입 유저만 (shell 은 미니게임 불가). */}
      {user.is_registered ? (
        <MinigameResetPanel
          profileId={user.id}
          displayName={displayName}
        />
      ) : null}

      {/* 비번 재설정: 가입 유저 + GM 아닌 대상에만 노출.
          shell(미가입)은 auth 계정 자체가 없고, GM 은 정책상 이 화면에서 재설정 불가. */}
      {user.is_registered && !user.is_gm ? (
        <PasswordResetPanel
          profileId={user.id}
          displayName={displayName}
        />
      ) : null}

      <UserDangerZone
        profileId={user.id}
        displayName={displayName}
        isGm={user.is_gm}
        deactivatedAt={user.deactivated_at}
        onChanged={onRefresh}
      />
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           10,
};

const headerStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           6,
  padding:       "12px 14px 14px",
  background:    "#fff",
  border:        "1.5px solid #dce8f0",
  borderRadius:  12,
};

const headerTopStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
};

const nameBlockStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
  flexWrap:   "wrap",
};

const nameStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   18,
  color:      "#14406f",
  margin:     0,
};

const badgeRowStyle: CSSProperties = {
  display: "flex",
  gap:     4,
};

const baseBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     10,
  padding:      "2px 8px",
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

const emailRowStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#7a94a8",
};

const summaryRowStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        5,
  fontFamily: BODY,
  fontSize:   12,
  color:      "#5a7488",
};

const summaryItemStyle: CSSProperties = {
  whiteSpace: "nowrap",
};

const dotStyle: CSSProperties = {
  color:    "#b8c6d0",
  fontSize: 11,
};

const metricRowStyle: CSSProperties = {
  display: "flex",
  gap:     5,
  flexWrap: "wrap",
  marginTop: 4,
};

const statChipStyle: CSSProperties = {
  fontFamily:   GAEGU,
  fontSize:     13,
  color:        "#2c4a60",
  background:   "#f2f8fc",
  border:       "1px solid #dfeaf2",
  borderRadius: 999,
  padding:      "3px 10px",
  whiteSpace:   "nowrap",
};

const mobilChipStyle: CSSProperties = {
  ...statChipStyle,
  background:  "#fffaeb",
  borderColor: "#f0e4c0",
  color:       "#9a6b00",
};