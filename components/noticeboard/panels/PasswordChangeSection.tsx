// components/noticeboard/panels/PasswordChangeSection.tsx
//
// 마이패널 최하단의 비밀번호 변경 섹션.
//
// UX:
//   · 기본 접힘. 헤더 클릭 시 펼침.
//   · 대부분 유저에게 상시 필요한 기능이 아니라 접혀 있는 게 자연스러움.
//   · GM 재설정 임시 비번을 받은 상태(password_reset_required=true)에서는
//     상위 레이어(강제 변경 팝업)가 별도로 처리. 이 섹션은 자발적 변경용.
//
// 검증 순서 (안전 관점):
//   1) 새 비번 형식 (8자, 확인 일치, 현재와 다름) — 클라이언트 즉시
//   2) 현재 비번 재검증 — 서버(signInWithPassword)에서 확인
//   3) 비번 교체 + password_reset_required=false
//
// 포커스 처리:
//   · disabled 대신 readOnly (채팅에서 배운 방식).
//   · 폼이 짧아 포커스 유지가 그리 중요하지는 않지만, 통일된 습관 유지.

"use client";

import { useState, type CSSProperties, type ChangeEvent } from "react";
import { JUA, GAEGU, BODY } from "../../auth/fonts";
import { changeMyPassword } from "@/lib/password-helpers";

const NAVY = "#14406f";

export default function PasswordChangeSection() {
  const [expanded, setExpanded] = useState(false);

  const [current, setCurrent] = useState("");
  const [next,    setNext]    = useState("");
  const [confirm, setConfirm] = useState("");

  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function toggleExpand() {
    setExpanded((v) => !v);
    if (expanded) {
      // 닫을 때 폼 초기화
      setCurrent(""); setNext(""); setConfirm("");
      setError(null); setSuccess(false);
    }
  }

  async function handleSubmit() {
    if (pending) return;
    setError(null);
    setSuccess(false);

    // 클라이언트 검증
    if (next.length < 8) {
      setError("새 비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (next !== confirm) {
      setError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    if (next === current) {
      setError("새 비밀번호가 현재 비밀번호와 같습니다.");
      return;
    }

    setPending(true);
    const res = await changeMyPassword(current, next);
    if (res.ok) {
      setSuccess(true);
      setCurrent(""); setNext(""); setConfirm("");
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  const submitDisabled =
    pending ||
    current.length === 0 ||
    next.length === 0 ||
    confirm.length === 0;

  return (
    <div style={sectionWrapStyle}>
      <button
        type="button"
        onClick={toggleExpand}
        style={headerButtonStyle}
      >
        <span style={secTitleStyle}>🔒 비밀번호 변경</span>
        <span style={chevronStyle}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded ? (
        <div style={formStyle}>
          <input
            type="password"
            value={current}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrent(e.target.value)}
            placeholder="현재 비밀번호"
            autoComplete="current-password"
            readOnly={pending}
            style={{ ...inputStyle, opacity: pending ? 0.65 : 1 }}
          />
          <input
            type="password"
            value={next}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNext(e.target.value)}
            placeholder="새 비밀번호 (8자 이상)"
            autoComplete="new-password"
            readOnly={pending}
            style={{ ...inputStyle, opacity: pending ? 0.65 : 1 }}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitDisabled) handleSubmit();
            }}
            placeholder="새 비밀번호 확인"
            autoComplete="new-password"
            readOnly={pending}
            style={{ ...inputStyle, opacity: pending ? 0.65 : 1 }}
          />

          {error ? <div style={errorStyle}>{error}</div> : null}
          {success ? (
            <div style={successStyle}>비밀번호가 변경되었습니다.</div>
          ) : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            style={{
              ...submitButtonStyle,
              opacity: submitDisabled ? 0.4 : 1,
              cursor:  submitDisabled ? "not-allowed" : "pointer",
            }}
            // 클릭 시 입력창 포커스 유지
            onMouseDown={(e) => e.preventDefault()}
          >
            {pending ? "변경 중" : "변경"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── 스타일 ── */

const sectionWrapStyle: CSSProperties = {
  marginTop:         20,
  borderTopWidth:    2.5,
  borderTopStyle:    "dashed",
  borderTopColor:    "#a8dcf5",
  paddingTop:        14,
};

const headerButtonStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  width:          "100%",
  padding:        0,
  borderWidth:    0,
  background:     "transparent",
  cursor:         "pointer",
};

const secTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   16,
  color:      "#0d6fa8",
};

const chevronStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   11,
  color:      "#7fb3d4",
};

const formStyle: CSSProperties = {
  marginTop:         10,
  background:        "#fff",
  borderTopWidth:    2,
  borderRightWidth:  2,
  borderBottomWidth: 2,
  borderLeftWidth:   2,
  borderStyle:       "solid",
  borderTopColor:    "#cdeeff",
  borderRightColor:  "#cdeeff",
  borderBottomColor: "#cdeeff",
  borderLeftColor:   "#cdeeff",
  borderRadius:      14,
  padding:           "12px 14px",
  display:           "flex",
  flexDirection:     "column",
  gap:               8,
};

const inputStyle: CSSProperties = {
  height:            34,
  borderTopWidth:    2,
  borderRightWidth:  2,
  borderBottomWidth: 2,
  borderLeftWidth:   2,
  borderStyle:       "solid",
  borderTopColor:    "#bfe4f7",
  borderRightColor:  "#bfe4f7",
  borderBottomColor: "#bfe4f7",
  borderLeftColor:   "#bfe4f7",
  borderRadius:      9,
  padding:           "0 11px",
  fontFamily:        BODY,
  fontSize:          13,
  color:             "#1e4b6e",
  outline:           "none",
  background:        "#fff",
  minWidth:          0,
};

const errorStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   13,
  color:      "#c2410c",
  background: "#fff5f0",
  padding:    "6px 10px",
  borderRadius: 8,
};

const successStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   13,
  color:      "#1e7d6a",
  background: "#eefaf3",
  padding:    "6px 10px",
  borderRadius: 8,
};

const submitButtonStyle: CSSProperties = {
  alignSelf:    "flex-end",
  height:       34,
  padding:      "0 18px",
  borderWidth:  0,
  borderRadius: 9,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     13,
  boxShadow:    "0 3px 0 #0d6fa8",
};