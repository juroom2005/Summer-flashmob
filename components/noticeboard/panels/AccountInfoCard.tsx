// components/noticeboard/panels/AccountInfoCard.tsx
//
// 마이패널 최하단의 계정 정보 카드.
//
// 유리질감 카드 안에:
//   · 가입 이메일
//   · 비밀번호 마스킹 도트 + "변경" 버튼
//   · 안내 문구 (비번은 표시 불가, 잊었다면 GM 문의)
//
// 왜 실제 비밀번호를 표시하지 않는가:
//   Supabase auth 는 비밀번호를 해시(bcrypt)로만 저장. 원문은 서버 어디에도 남지 않음.
//   따라서 "지금 내 비번이 무엇인지" 는 유저 본인이 기억하는 값 외에는 어디에도 없음.
//   시각적 자리에는 고정 길이 도트만 표시 (실제 비번 길이와 무관).
//
// "변경" 버튼:
//   자발적 변경 팝업(PasswordChangePopup, forced=false) 을 오픈.

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { JUA, GAEGU, BODY } from "../../auth/fonts";
import { getCurrentUser } from "@/lib/auth-helpers";
import PasswordChangePopup from "./PasswordChangePopup";

const NAVY = "#14406f";

/** 실제 비번과 무관한 시각적 마스킹 길이. */
const MASK_DOTS = "●●●●●●●●●●";

export default function AccountInfoCard() {
  const [email,     setEmail]     = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (cancelled) return;
      setEmail(user?.email ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={sectionWrapStyle}>
      <div style={secTitleStyle}>💳 계정 정보</div>

      <div style={cardStyle}>
        {/* 이메일 */}
        <div style={rowStyle}>
          <span style={labelStyle}>📧 가입 이메일</span>
          <span style={valueStyle}>
            {loading ? "…" : email ?? "이메일 정보 없음"}
          </span>
        </div>

        <div style={dividerStyle} />

        {/* 비밀번호 */}
        <div style={passwordRowStyle}>
          <div style={passwordLeftStyle}>
            <span style={labelStyle}>🔒 비밀번호</span>
            <span style={maskStyle}>{MASK_DOTS}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowPopup(true)}
            style={changeButtonStyle}
            onMouseDown={(e) => e.preventDefault()}
          >
            변경
          </button>
        </div>

        <div style={helperNoteStyle}>
          비밀번호를 분실하셨을 경우 마스토돈 총괄계정 DM을 통해 문의 부탁드립니다.
        </div>
      </div>

      {showPopup ? (
        <PasswordChangePopup
          forced={false}
          onClose={() => setShowPopup(false)}
        />
      ) : null}
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

const secTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   16,
  color:      "#0d6fa8",
  marginBottom: 10,
};

/** 유리질감 카드. 반투명 + 약한 블러 + 미묘한 보더. */
const cardStyle: CSSProperties = {
  background:       "rgba(255, 255, 255, 0.55)",
  backdropFilter:   "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  borderTopWidth:    1.5,
  borderRightWidth:  1.5,
  borderBottomWidth: 1.5,
  borderLeftWidth:   1.5,
  borderStyle:       "solid",
  borderTopColor:    "rgba(255, 255, 255, 0.85)",
  borderRightColor:  "rgba(191, 228, 247, 0.85)",
  borderBottomColor: "rgba(191, 228, 247, 0.85)",
  borderLeftColor:   "rgba(255, 255, 255, 0.85)",
  borderRadius:      16,
  padding:           "14px 16px",
  boxShadow:         "0 4px 14px rgba(168, 220, 245, 0.35), inset 0 1px 0 rgba(255,255,255,0.6)",
  display:           "flex",
  flexDirection:     "column",
  gap:               10,
};

const rowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            10,
};

const labelStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#5a7488",
  flexShrink: 0,
};

const valueStyle: CSSProperties = {
  fontFamily:   GAEGU,
  fontWeight:   700,
  fontSize:     14,
  color:        NAVY,
  overflow:     "hidden",
  textOverflow: "ellipsis",
  whiteSpace:   "nowrap",
  minWidth:     0,
};

const dividerStyle: CSSProperties = {
  height:     1,
  background: "rgba(191, 228, 247, 0.6)",
};

const passwordRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            10,
};

const passwordLeftStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           4,
  minWidth:      0,
};

const maskStyle: CSSProperties = {
  fontFamily:    "'Menlo', 'Consolas', monospace",
  fontSize:      13,
  color:         NAVY,
  letterSpacing: "0.08em",
};

const changeButtonStyle: CSSProperties = {
  height:       32,
  padding:      "0 16px",
  borderWidth:  0,
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     12,
  boxShadow:    "0 3px 0 #0d6fa8",
  cursor:       "pointer",
  flexShrink:   0,
};

const helperNoteStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#7a94a8",
  lineHeight: 1.5,
};