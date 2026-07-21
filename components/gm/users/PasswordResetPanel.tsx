// components/gm/users/PasswordResetPanel.tsx
//
// GM 이 특정 유저의 비밀번호를 임시 비번으로 재설정.
//
// 렌더 조건:
//   · 가입 유저(is_registered = true) 만 대상
//   · GM 계정 대상 불가
//   → UserDetail 쪽에서 조건부 마운트. 이 컴포넌트 자체엔 조건 분기 없음.
//
// 흐름:
//   1) "비밀번호 재설정" 버튼 → window.confirm 확인
//   2) EF 호출 → 임시 비번 반환
//   3) 임시 비번을 모달로 표시 (한 번만 확인 가능하다는 경고 포함)
//   4) GM 이 카톡 등으로 유저에게 전달 → 유저 로그인 → 강제 변경 팝업
//
// 안정성:
//   · confirm 후 호출 (오조작 방지)
//   · 응답의 tempPassword 는 서버에 별도 저장 없음 → 모달 닫으면 다시 볼 수 없음.
//     경고 문구를 명시적으로 표시.

"use client";

import { useState, type CSSProperties } from "react";
import { resetGmUserPassword } from "@/lib/password-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";
const MONO = "'Menlo', 'Consolas', monospace";

type Props = {
  profileId:   string;
  displayName: string;
};

export default function PasswordResetPanel({ profileId, displayName }: Props) {
  const [pending,      setPending]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied,       setCopied]       = useState(false);

  async function handleReset() {
    if (pending) return;

    const ok = window.confirm(
      `${displayName} 님의 비밀번호를 임시 비밀번호로 재설정하시겠습니까?\n\n` +
      "새 임시 비밀번호가 즉시 생성되며, 이 화면에서 한 번만 확인할 수 있습니다. " +
      "유저는 임시 비밀번호로 로그인 후 반드시 새 비밀번호로 변경하도록 안내됩니다."
    );
    if (!ok) return;

    setPending(true);
    setError(null);

    const res = await resetGmUserPassword(profileId);

    if (res.ok) {
      setTempPassword(res.tempPassword);
      setCopied(false);
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function handleCopy() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
    } catch {
      // 클립보드 접근 실패 시 사용자에게 수동 복사 안내
      window.alert(
        "자동 복사에 실패하였습니다. 표시된 비밀번호를 직접 선택하여 복사해주십시오."
      );
    }
  }

  function closeModal() {
    setTempPassword(null);
    setCopied(false);
  }

  return (
    <>
      <div style={wrapStyle}>
        <div style={sectionTitleStyle}>🔑 비밀번호 재설정</div>
        <div style={descStyle}>
          유저가 비밀번호를 잊었을 때 사용합니다. 새 임시 비밀번호가 생성되며,
          유저는 로그인 후 강제로 변경 안내를 받습니다.
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={pending}
          style={{
            ...buttonStyle,
            opacity: pending ? 0.4 : 1,
            cursor:  pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "생성 중" : "임시 비밀번호 생성"}
        </button>

        {error ? <div style={errorStyle}>{error}</div> : null}
      </div>

      {/* ── 임시 비번 표시 모달 ── */}
      {tempPassword ? (
        <div style={modalBackdropStyle} onClick={closeModal}>
          <div
            style={modalCardStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={modalTitleStyle}>임시 비밀번호가 생성되었습니다</div>
            <div style={modalTargetStyle}>대상 · {displayName}</div>

            <div style={passwordBoxStyle}>
              <code style={passwordTextStyle}>{tempPassword}</code>
            </div>

            <div style={modalButtonRowStyle}>
              <button
                type="button"
                onClick={handleCopy}
                style={copyButtonStyle}
              >
                {copied ? "복사됨" : "복사"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                style={closeButtonStyle}
              >
                닫기
              </button>
            </div>

            <div style={modalWarningStyle}>
              ⚠ 이 창을 닫으면 임시 비밀번호를 다시 확인할 수 없습니다.
              유저에게 안전하게 전달한 뒤 닫아주십시오.
            </div>
          </div>
        </div>
      ) : null}
    </>
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
  borderRadius:  10,
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

const buttonStyle: CSSProperties = {
  alignSelf:    "flex-start",
  height:       30,
  padding:      "0 16px",
  border:       0,
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     12,
};

const errorStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#c2410c",
};

/* ── 모달 ── */

const modalBackdropStyle: CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(20, 30, 50, 0.55)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  padding:        20,
  zIndex:         200,
};

const modalCardStyle: CSSProperties = {
  width:         "100%",
  maxWidth:      440,
  background:    "#fff",
  borderRadius:  16,
  padding:       "20px 22px",
  display:       "flex",
  flexDirection: "column",
  gap:           12,
  boxShadow:     "0 20px 40px rgba(20, 40, 90, 0.35)",
};

const modalTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   17,
  color:      "#14406f",
};

const modalTargetStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#5a7488",
};

const passwordBoxStyle: CSSProperties = {
  background:    "#f2f8fc",
  borderTopWidth:    2,
  borderRightWidth:  2,
  borderBottomWidth: 2,
  borderLeftWidth:   2,
  borderStyle:       "solid",
  borderTopColor:    "#bfe4f7",
  borderRightColor:  "#bfe4f7",
  borderBottomColor: "#bfe4f7",
  borderLeftColor:   "#bfe4f7",
  borderRadius:  10,
  padding:       "14px 16px",
  textAlign:     "center",
  userSelect:    "all",
};

const passwordTextStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize:   20,
  color:      "#0d6fa8",
  letterSpacing: "0.05em",
  wordBreak:  "break-all",
};

const modalButtonRowStyle: CSSProperties = {
  display: "flex",
  gap:     8,
};

const copyButtonStyle: CSSProperties = {
  flex:         1,
  height:       34,
  border:       0,
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
};

const closeButtonStyle: CSSProperties = {
  flex:         1,
  height:       34,
  borderTopWidth:    1.5,
  borderRightWidth:  1.5,
  borderBottomWidth: 1.5,
  borderLeftWidth:   1.5,
  borderStyle:       "solid",
  borderTopColor:    "#cfd8de",
  borderRightColor:  "#cfd8de",
  borderBottomColor: "#cfd8de",
  borderLeftColor:   "#cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
};

const modalWarningStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#a33b3b",
  lineHeight: 1.6,
  background: "#fdf7f7",
  borderRadius: 8,
  padding:    "8px 10px",
};