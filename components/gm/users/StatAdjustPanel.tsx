// components/gm/users/StatAdjustPanel.tsx
//
// 유저 스탯 3종 증감 패널.
//
// 방식:
//   · 절대값 지정이 아니라 증감(delta) 버튼 방식
//     → 동시 편집 시 덮어쓰기 사고 회피
//   · 버튼: -10 / -1 / +1 / +10
//   · 결과값은 서버(RPC)에서 0~100 클램프 후 반환 → 그 값으로 표시 갱신
//
// 낙관적 UI 미사용:
//   클램프 경계(0·100 근처)에서 클라이언트 예측이 서버와 어긋날 수 있어,
//   서버 반환값을 그대로 반영. 25명 규모라 왕복 지연 부담 낮음.
//
// 연타 대응:
//   요청 진행 중에는 해당 유저의 모든 버튼 비활성 (pending)

"use client";

import { useState, type CSSProperties } from "react";
import { adjustGmUserStats, type StatResult } from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** 증감 버튼 단위. */
const DELTAS = [-10, -1, 1, 10] as const;

type StatKey = "rhythm" | "physical" | "expression";

const STAT_META: { key: StatKey; label: string; emoji: string }[] = [
  { key: "rhythm",     label: "리듬",   emoji: "🎵" },
  { key: "physical",   label: "체력",   emoji: "💪" },
  { key: "expression", label: "표현력", emoji: "✨" },
];

type Props = {
  profileId:   string;
  rhythm:      number;
  physical:    number;
  expression:  number;
  /** 조정 성공 시 부모 목록 상태 갱신용. */
  onAdjusted:  (next: StatResult) => void;
};

export default function StatAdjustPanel({
  profileId,
  rhythm,
  physical,
  expression,
  onAdjusted,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const current: Record<StatKey, number> = {
    rhythm,
    physical,
    expression,
  };

  async function handleAdjust(key: StatKey, delta: number) {
    if (pending) return;
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

  return (
    <div style={wrapStyle}>
      <div style={sectionTitleStyle}>🫧 스탯 조정</div>

      {STAT_META.map((meta) => {
        const value = current[meta.key];
        return (
          <div key={meta.key} style={rowStyle}>
            <span style={labelStyle}>
              {meta.emoji} {meta.label}
            </span>

            <span style={valueStyle}>{value}</span>

            <span style={buttonGroupStyle}>
              {DELTAS.map((d) => {
                // 경계에서 의미 없는 버튼은 비활성 (0에서 -1, 100에서 +1 등)
                const wouldNoop =
                  (d < 0 && value === 0) || (d > 0 && value === 100);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleAdjust(meta.key, d)}
                    disabled={pending || wouldNoop}
                    style={{
                      ...deltaButtonStyle,
                      opacity: pending || wouldNoop ? 0.4 : 1,
                      cursor:  pending || wouldNoop ? "not-allowed" : "pointer",
                      color:   d < 0 ? "#c2410c" : "#0d6fa8",
                      borderColor: d < 0 ? "#f3c9b4" : "#bfe4f7",
                    }}
                  >
                    {d > 0 ? `+${d}` : d}
                  </button>
                );
              })}
            </span>
          </div>
        );
      })}

      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={noteStyle}>
        범위는 0에서 100까지이며, 초과분은 자동으로 조정됩니다.
      </div>
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:      "flex",
  flexDirection: "column",
  gap:          8,
  padding:      12,
  background:   "#f7fcff",
  border:       "1.5px solid #d8eefb",
  borderRadius: 10,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#0d6fa8",
  marginBottom: 2,
};

const rowStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
};

const labelStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#3a5a72",
  width:      72,
  flexShrink: 0,
};

const valueStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   14,
  color:      "#14406f",
  width:      34,
  textAlign:  "right",
  flexShrink: 0,
};

const buttonGroupStyle: CSSProperties = {
  display:  "flex",
  gap:      4,
  marginLeft: "auto",
};

const deltaButtonStyle: CSSProperties = {
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
};