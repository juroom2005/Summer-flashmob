// components/gm/users/MinigameResetPanel.tsx
//
// GM 이 특정 유저의 오늘(KST) 미니게임 소진 이력을 확인하고 리셋한다.
//
// 렌더 조건 :
//   · 가입 유저(is_registered = true) 만 노출 대상. GM 이라도 이력 확인은 가능.
//   · UserDetail 에서 조건부 마운트 (shell 유저 제외).
//
// 흐름 :
//   1) 마운트 시 자동으로 오늘 이력 조회
//   2) 소진 횟수 + 지급된 mobil/exp 요약 표시
//   3) [리셋] 버튼 → window.confirm 확인 → RPC 호출 → 재조회
//
// 안정성 :
//   · 리셋은 confirm 이후에만 실행
//   · 리셋은 오늘 이력만 삭제. 이미 지급된 mobil/exp 는 되돌리지 않음.
//     (이 점을 안내문에 명시)
//   · 에러 시 문구 노출

"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  getGmUserMinigameToday,
  resetGmUserMinigameToday,
  type GmMinigameTodayResult,
} from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";
const MONO = "'Menlo', 'Consolas', monospace";

type Props = {
  profileId:   string;
  displayName: string;
};

export default function MinigameResetPanel({ profileId, displayName }: Props) {
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [today,   setToday]   = useState<GmMinigameTodayResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getGmUserMinigameToday(profileId);
    setLoading(false);
    if (res.ok) {
      setToday(res.data);
    } else {
      setToday(null);
      setError(res.message);
    }
  }, [profileId]);

  useEffect(() => {
    refresh();
    // profile 이 바뀌면 안내문 초기화
    setNotice(null);
  }, [refresh]);

  async function handleReset() {
    if (pending) return;
    if (!today || today.playsToday === 0) return;

    const ok = window.confirm(
      `${displayName} 님의 오늘 미니게임 소진 횟수 ${today.playsToday}회를 리셋하시겠습니까?\n\n` +
      "이미 지급된 모빌·스탯 EXP 는 되돌려지지 않습니다. 카운트만 0으로 초기화됩니다. " +
      "보상 회수가 필요하다면 스탯/모빌 조정 패널에서 별도로 처리해 주십시오."
    );
    if (!ok) return;

    setPending(true);
    setError(null);
    setNotice(null);

    const res = await resetGmUserMinigameToday(profileId);

    setPending(false);
    if (res.ok) {
      setNotice(`오늘 이력 ${res.data.deletedCount}건 삭제. 카운트가 리셋되었습니다.`);
      await refresh();
    } else {
      setError(res.message);
    }
  }

  return (
    <div style={wrapStyle}>
      <div style={sectionTitleStyle}>🎮 오늘 미니게임</div>
      <div style={descStyle}>
        일일 미니게임 소진 횟수를 확인하고 필요 시 오늘 이력을 리셋합니다.
        리셋해도 이미 지급된 모빌·스탯 EXP 는 되돌아가지 않습니다.
      </div>

      {loading ? (
        <div style={mutedLineStyle}>불러오는 중…</div>
      ) : today ? (
        <>
          <div style={countRowStyle}>
            <span style={countLabelStyle}>오늘 소진</span>
            <span style={countValueStyle}>
              {today.playsToday} / {today.dailyLimit}회
            </span>
            <span style={remainStyle}>
              (남은 {today.playsRemaining}회)
            </span>
          </div>

          {today.history.length > 0 ? (
            <div style={historyStyle}>
              {today.history.map((h) => {
                const time = h.played_at
                  ? new Date(h.played_at).toLocaleTimeString("ko-KR", {
                      timeZone: "Asia/Seoul",
                      hour:     "2-digit",
                      minute:   "2-digit",
                    })
                  : "";
                return (
                  <div key={h.id} style={historyRowStyle}>
                    <span style={historyTimeStyle}>{time}</span>
                    <span style={historyNameStyle}>{h.minigame_name}</span>
                    <span style={historyScoreStyle}>{h.score}점</span>
                    <span style={historyRewardStyle}>
                      +{h.mobil_gained.toLocaleString()}모빌
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={mutedLineStyle}>오늘 완주한 미니게임이 없습니다.</div>
          )}

          <button
            type="button"
            onClick={handleReset}
            disabled={pending || today.playsToday === 0}
            style={{
              ...buttonStyle,
              opacity: (pending || today.playsToday === 0) ? 0.4 : 1,
              cursor:  (pending || today.playsToday === 0) ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "리셋 중" : "오늘 이력 리셋"}
          </button>
        </>
      ) : null}

      {notice ? <div style={noticeStyle}>{notice}</div> : null}
      {error  ? <div style={errorStyle}>{error}</div>   : null}
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  padding:       12,
  background:    "#f6faff",
  borderTopWidth:    1.5,
  borderRightWidth:  1.5,
  borderBottomWidth: 1.5,
  borderLeftWidth:   1.5,
  borderStyle:       "solid",
  borderTopColor:    "#d0e2f2",
  borderRightColor:  "#d0e2f2",
  borderBottomColor: "#d0e2f2",
  borderLeftColor:   "#d0e2f2",
  borderRadius:      10,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#0d6fa8",
};

const descStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#5a7488",
  lineHeight: 1.6,
};

const countRowStyle: CSSProperties = {
  display:    "flex",
  alignItems: "baseline",
  gap:        8,
  marginTop:  2,
};
const countLabelStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   12,
  color:      "#5a7488",
};
const countValueStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   16,
  color:      "#0d6fa8",
};
const remainStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#8ba5b8",
};

const historyStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           4,
  padding:       "6px 8px",
  background:    "#fff",
  borderRadius:  6,
  border:        "1px solid #e0eaf2",
  marginTop:     2,
};
const historyRowStyle: CSSProperties = {
  display:       "grid",
  gridTemplateColumns: "48px 1fr auto auto",
  gap:           8,
  alignItems:    "baseline",
  fontFamily:    BODY,
  fontSize:      11.5,
  color:         "#3f556a",
};
const historyTimeStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize:   11,
  color:      "#8ba5b8",
};
const historyNameStyle: CSSProperties = {
  color: "#3f556a",
};
const historyScoreStyle: CSSProperties = {
  fontFamily: JUA,
  color:      "#0d6fa8",
};
const historyRewardStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   11.5,
  color:      "#1f9d55",
};

const mutedLineStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#8ba5b8",
  padding:    "6px 2px",
};

const buttonStyle: CSSProperties = {
  alignSelf:    "flex-start",
  marginTop:    4,
  height:       30,
  padding:      "0 16px",
  border:       0,
  borderRadius: 999,
  background:   "#c25027",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     12,
};

const noticeStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#1f7d3f",
};

const errorStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#c2410c",
};
