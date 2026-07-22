// components/password-reset/PasswordResetBanner.tsx
//
// 홈 상단 배너. password_reset_required 가 true 인 동안 계속 표시.
//
// UX:
//   · 강제 팝업을 나중에 로 닫아도 배너는 계속 남음 (dismiss 무관)
//   · 클릭 시 자발 팝업 재오픈 (마이패널로 이동보다 클릭 수 절약)
//   · 팝업 성공 → refresh → required=false → 배너 자연 소멸
//
// 색상 톤: 노란 계열 (경고 성격). 강제 팝업의 안내 박스와 톤 일치.

"use client";

import { useState, type CSSProperties } from "react";
import { GAEGU } from "../auth/fonts";
import { usePasswordResetContext } from "./PasswordResetProvider";
import PasswordChangePopup from "@/components/noticeboard/panels/PasswordChangePopup";

export default function PasswordResetBanner() {
  const { required, loading, refresh } = usePasswordResetContext();
  const [showPopup, setShowPopup] = useState(false);

  if (loading || !required) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowPopup(true)}
        style={bannerStyle}
      >
        <span style={emojiStyle}>🔑</span>
        <span style={textStyle}>
          임시 비밀번호를 사용 중입니다. 클릭해서 새 비밀번호로 변경해주십시오.
        </span>
      </button>

      {showPopup ? (
        <PasswordChangePopup
          forced={false}
          onClose={() => setShowPopup(false)}
          onSuccess={() => void refresh()}
        />
      ) : null}
    </>
  );
}

/* ── 스타일 ── */

const bannerStyle: CSSProperties = {
  position:       "fixed",
  top:            0,
  left:           0,
  right:          0,
  zIndex:         150,
  display:        "flex",
  alignItems:     "center",
  gap:            10,
  width:          "100%",
  padding:        "10px 16px",
  background:     "linear-gradient(90deg, #fff5c4, #fff0a8)",
  borderTopWidth:    0,
  borderRightWidth:  0,
  borderBottomWidth: 2,
  borderLeftWidth:   0,
  borderStyle:       "solid",
  borderBottomColor: "#e0a500",
  color:          "#9a6b00",
  cursor:         "pointer",
  textAlign:      "left",
  boxShadow:      "0 2px 6px rgba(224, 165, 0, 0.15)",
};

const emojiStyle: CSSProperties = {
  fontSize:   18,
  flexShrink: 0,
};

const textStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   14,
  lineHeight: 1.4,
  flex:       1,
};