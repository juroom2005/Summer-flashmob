// components/gm/users/StatAdjustPanel.tsx
//
// 유저 스탯 3종 증감 패널 (v2 — 스탯 레벨제 개편 반영).
//
// 변경점 (v1 → v2):
//   · 값 체계 : 0~100 → 0~450 (exp) + 레벨 파생
//   · 표시 : 두 줄
//       Lv3
//       exp 220 / 280
//   · 델타 버튼 : -50 / -10 / -1 / +1 / +10 / +50 (exp 조정)
//   · 레벨 버튼 : -Lv / +Lv (해당 방향 인접 레벨의 최소 exp 로 세팅)
//   · 배치 : 두 줄 (레벨 / exp 델타)
//
// 방식 :
//   · 절대값 지정 없음. 항상 증감(delta) 방식. 서버에서 클램프 후 반환값 반영.
//   · 레벨 버튼도 내부적으로 델타 계산 후 기존 RPC 재사용.
//     예 : exp 220(Lv3) 에서 -Lv → Lv2 최소값 80 이 목표 → delta = 80 - 220 = -140
//   · 확인 다이얼로그는 두지 않음. 절대 exp 값이 UI 에 보여 GM 이 사전 인지.
//     대신 -Lv 는 exp 손실이 발생할 수 있으므로 GM 이 값을 확인 후 클릭.
//
// 낙관적 UI 미사용:
//   서버 반환값을 그대로 반영. 25명 규모라 왕복 지연 부담 낮음.
//
// 연타 대응:
//   요청 진행 중에는 해당 유저의 모든 버튼 비활성 (pending)

"use client";

import { useState, type CSSProperties } from "react";
import { adjustGmUserStats, type StatResult } from "@/lib/gm-user-helpers";
import {
  LEVEL_MAX,
  LEVEL_THRESHOLDS,
  EXP_MAX,
  levelToMinExp,
} from "@/lib/stat-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** exp 세밀 조정 델타 (하단 줄). */
const EXP_DELTAS = [-50, -10, -1, 1, 10, 50] as const;

type StatKey = "rhythm" | "physical" | "expression";

const STAT_META: { key: StatKey; label: string; emoji: string }[] = [
  { key: "rhythm",     label: "리듬",   emoji: "🎵" },
  { key: "physical",   label: "체력",   emoji: "💪" },
  { key: "expression", label: "표현력", emoji: "✨" },
];

// 각 스탯의 현재 exp/level 을 조회하기 위한 record 필드명 매핑.
// StatResult 는 rhythm_exp / rhythm_level 같은 flat 구조라 여기서 매핑.
const STAT_FIELD: Record<StatKey, { exp: keyof StatResult; level: keyof StatResult }> = {
  rhythm:     { exp: "rhythm_exp",     level: "rhythm_level"     },
  physical:   { exp: "physical_exp",   level: "physical_level"   },
  expression: { exp: "expression_exp", level: "expression_level" },
};

type Props = {
  profileId:       string;
  rhythmExp:       number;
  rhythmLevel:     number;
  physicalExp:     number;
  physicalLevel:   number;
  expressionExp:   number;
  expressionLevel: number;
  /** 조정 성공 시 부모 목록 상태 갱신용. */
  onAdjusted:      (next: StatResult) => void;
};

export default function StatAdjustPanel({
  profileId,
  rhythmExp,
  rhythmLevel,
  physicalExp,
  physicalLevel,
  expressionExp,
  expressionLevel,
  onAdjusted,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // 스탯별 현재 값 record
  const current: Record<StatKey, { exp: number; level: number }> = {
    rhythm:     { exp: rhythmExp,     level: rhythmLevel     },
    physical:   { exp: physicalExp,   level: physicalLevel   },
    expression: { exp: expressionExp, level: expressionLevel },
  };

  // 공통 델타 실행. 성공 시 부모 onAdjusted 호출.
  async function runDelta(key: StatKey, delta: number) {
    if (pending || delta === 0) return;
    setPending(true);
    setError(null);
    const res = await adjustGmUserStats(profileId, { [key]: delta });
    if (res.ok) {
      onAdjusted(res.data);
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  // 레벨 조정 : 목표 레벨의 최소 exp 로 세팅.
  //   -Lv : 현 레벨보다 1 낮은 레벨의 최소 exp
  //   +Lv : 현 레벨보다 1 높은 레벨의 최소 exp
  // 이미 최저/최고 레벨이면 무시.
  async function handleLevelStep(key: StatKey, dir: -1 | 1) {
    const { level, exp } = current[key];
    const targetLevel = level + dir;
    if (targetLevel < 0 || targetLevel > LEVEL_MAX) return;
    const targetExp = levelToMinExp(targetLevel);
    const delta = targetExp - exp;
    await runDelta(key, delta);
  }

  return (
    <div style={wrapStyle}>
      <div style={sectionTitleStyle}>🫧 스탯 조정</div>

      {STAT_META.map((meta) => {
        const { exp, level } = current[meta.key];
        const isMinLv    = level <= 0;
        const isMaxLv    = level >= LEVEL_MAX;
        const isMinExp   = exp <= 0;
        const isMaxExp   = exp >= EXP_MAX;

        // 진행률 표시용 : 현 레벨 구간의 시작·끝 exp
        // 최상위 레벨이면 상단은 EXP_MAX 로 표시.
        const levelMin = LEVEL_THRESHOLDS[level];
        const nextMin  = level >= LEVEL_MAX
          ? LEVEL_THRESHOLDS[LEVEL_MAX]
          : LEVEL_THRESHOLDS[level + 1];

        return (
          <div key={meta.key} style={rowStyle}>
            {/* 좌측 : 라벨 + 값 표시 (두 줄) */}
            <div style={infoStyle}>
              <div style={labelStyle}>
                {meta.emoji} {meta.label} <span style={levelBadgeStyle}>Lv{level}</span>
              </div>
              <div style={expLineStyle}>
                exp <span style={expValueStyle}>{exp}</span>
                <span style={expTotalStyle}> / {nextMin}</span>
                {!isMaxLv ? (
                  <span style={expToNextStyle}>
                    (다음까지 {nextMin - exp})
                  </span>
                ) : (
                  <span style={expToNextStyle}> (최상위)</span>
                )}
              </div>
            </div>

            {/* 우측 : 두 줄 버튼 그룹 */}
            <div style={buttonStackStyle}>
              {/* 1행 : 레벨 조정 */}
              <div style={buttonRowStyle}>
                <button
                  type="button"
                  onClick={() => handleLevelStep(meta.key, -1)}
                  disabled={pending || isMinLv}
                  style={{
                    ...levelButtonStyle,
                    opacity: pending || isMinLv ? 0.4 : 1,
                    cursor:  pending || isMinLv ? "not-allowed" : "pointer",
                  }}
                  title={
                    isMinLv
                      ? "이미 최저 레벨입니다"
                      : `Lv${level - 1} 최소 exp(${LEVEL_THRESHOLDS[level - 1]})로 강등됩니다`
                  }
                >
                  −Lv
                </button>
                <button
                  type="button"
                  onClick={() => handleLevelStep(meta.key, 1)}
                  disabled={pending || isMaxLv}
                  style={{
                    ...levelButtonStyle,
                    color:       "#0d6fa8",
                    borderColor: "#bfe4f7",
                    opacity: pending || isMaxLv ? 0.4 : 1,
                    cursor:  pending || isMaxLv ? "not-allowed" : "pointer",
                  }}
                  title={
                    isMaxLv
                      ? "이미 최고 레벨입니다"
                      : `Lv${level + 1} 최소 exp(${LEVEL_THRESHOLDS[level + 1]})로 승급됩니다`
                  }
                >
                  +Lv
                </button>
              </div>

              {/* 2행 : exp 세밀 조정 */}
              <div style={buttonRowStyle}>
                {EXP_DELTAS.map((d) => {
                  const wouldNoop =
                    (d < 0 && isMinExp) || (d > 0 && isMaxExp);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => runDelta(meta.key, d)}
                      disabled={pending || wouldNoop}
                      style={{
                        ...expButtonStyle,
                        opacity:     pending || wouldNoop ? 0.4 : 1,
                        cursor:      pending || wouldNoop ? "not-allowed" : "pointer",
                        color:       d < 0 ? "#c2410c" : "#0d6fa8",
                        borderColor: d < 0 ? "#f3c9b4" : "#bfe4f7",
                      }}
                    >
                      {d > 0 ? `+${d}` : d}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 무시 경고 : STAT_FIELD 는 미사용 경고 회피용 참조 */}
            <span style={{ display: "none" }}>{STAT_FIELD[meta.key].exp}</span>
          </div>
        );
      })}

      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={noteStyle}>
        exp 범위는 0에서 {EXP_MAX} 까지이며, 초과분은 자동으로 조정됩니다.
        레벨 조정은 인접 레벨의 최소 exp 값으로 세팅됩니다.
      </div>
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           10,
  padding:       12,
  background:    "#f7fcff",
  border:        "1.5px solid #d8eefb",
  borderRadius:  10,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     13,
  color:        "#0d6fa8",
  marginBottom: 2,
};

const rowStyle: CSSProperties = {
  display:       "flex",
  alignItems:    "center",
  gap:           12,
  padding:       "8px 4px",
  borderBottom:  "1px dashed #d8eefb",
};

const infoStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           2,
  minWidth:      160,
  flexShrink:    0,
};

const labelStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   13,
  color:      "#3a5a72",
  fontWeight: 600,
  display:    "flex",
  alignItems: "center",
  gap:        6,
};

const levelBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     12,
  color:        "#0d6fa8",
  background:   "#e8f5fd",
  padding:      "1px 8px",
  borderRadius: 999,
  border:       "1.5px solid #bfe4f7",
};

const expLineStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#5a7a92",
  display:    "flex",
  alignItems: "baseline",
  gap:        3,
};

const expValueStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#14406f",
};

const expTotalStyle: CSSProperties = {
  color: "#7a94a8",
};

const expToNextStyle: CSSProperties = {
  marginLeft: 4,
  fontSize:   10.5,
  color:      "#7a94a8",
};

const buttonStackStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           4,
  marginLeft:    "auto",
};

const buttonRowStyle: CSSProperties = {
  display:        "flex",
  gap:            4,
  justifyContent: "flex-end",
};

const levelButtonStyle: CSSProperties = {
  minWidth:     46,
  height:       26,
  padding:      "0 8px",
  border:       "1.5px solid #f3c9b4",
  borderRadius: 999,
  background:   "#fff",
  fontFamily:   JUA,
  fontSize:     11,
  color:        "#c2410c",
};

const expButtonStyle: CSSProperties = {
  minWidth:     38,
  height:       26,
  padding:      "0 6px",
  border:       "1.5px solid #bfe4f7",
  borderRadius: 999,
  background:   "#fff",
  fontFamily:   JUA,
  fontSize:     11,
};

const errorStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#c2410c",
  paddingTop: 2,
};

const noteStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#7a94a8",
  lineHeight: 1.5,
};