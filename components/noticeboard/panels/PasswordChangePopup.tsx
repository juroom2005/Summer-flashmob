// components/noticeboard/panels/PasswordChangePopup.tsx
//
// 비밀번호 변경 팝업 (자발/강제 공용).
//
// 두 모드:
//   · 자발 (forced=false): 마이패널 계정 카드의 "변경" 버튼에서 열림
//                          취소 가능, 언제든 닫기 가능
//   · 강제 (forced=true) : password_reset_required=true 감지 시 layout에서 자동 오픈
//                          상단 안내 문구 다름, 하단 버튼 "나중에"/"변경"
//                          (세션 dismiss 상태 관리는 상위 컨트롤러 소관, 이 파일은
//                           onClose 만 호출)
//
// 필드:
//   · 현재 비밀번호 / 새 비밀번호 / 새 비밀번호 확인
//   · 각 필드 눈 아이콘으로 표시/숨김 토글
//
// 검증 (헬퍼가 서버측 재검증까지 처리):
//   1) 새 비번 8자 이상
//   2) 새 비번 확인 일치
//   3) 새 비번 ≠ 현재 비번
//   4) 헬퍼가 signInWithPassword 로 현재 비번 재검증
//
// 성공 후:
//   · onSuccess 콜백 → 상위가 필요시 상태 갱신 (예: password_reset_required 재조회)
//   · 성공 화면 표시 → "닫기" 버튼으로 명시적 종료

"use client";

import { useState, type CSSProperties, type ChangeEvent } from "react";
import { JUA, GAEGU, BODY } from "../../auth/fonts";
import { changeMyPassword } from "@/lib/password-helpers";

const NAVY = "#14406f";

type Props = {
  forced:     boolean;
  onClose:    () => void;
  onSuccess?: () => void;
};

export default function PasswordChangePopup({ forced, onClose, onSuccess }: Props) {
  const [current, setCurrent] = useState("");
  const [next,    setNext]    = useState("");
  const [confirm, setConfirm] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext,    setShowNext]    = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [pending,  setPending]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  async function handleSubmit() {
    if (pending) return;
    setError(null);

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
      setSucceeded(true);
      // 폼 즉시 비움 (혹시 성공 화면 뒤에 다시 보일 여지 원천 차단)
      setCurrent(""); setNext(""); setConfirm("");
      onSuccess?.();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  // 배경 클릭으로 닫기: 강제 모드에서도 허용 (사용자 방침: "명시적으로 알렸음"만 성립하면 됨)
  function handleBackdropClick() {
    if (pending) return;
    onClose();
  }

  const submitDisabled =
    pending ||
    current.length === 0 ||
    next.length === 0 ||
    confirm.length === 0;

  return (
    <div style={backdropStyle} onClick={handleBackdropClick}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        {/* ── 헤더 ── */}
        <div style={headerStyle}>
          <div style={titleStyle}>
            🔒 {forced ? "비밀번호 변경 안내" : "비밀번호 변경"}
          </div>
          {forced ? (
            <div style={forcedNoticeStyle}>
              임시 비밀번호로 로그인하셨습니다. 안전을 위해 새 비밀번호로 변경해주십시오.
            </div>
          ) : null}
        </div>

        {/* ── 성공 화면 ── */}
        {succeeded ? (
          <>
            <div style={successCardStyle}>
              <div style={successEmojiStyle}>✅</div>
              <div style={successTextStyle}>
                비밀번호가 변경되었습니다.
              </div>
            </div>
            <div style={buttonRowStyle}>
              <button
                type="button"
                onClick={onClose}
                style={primaryButtonStyle}
              >
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            {/* ── 폼 ── */}
            <PasswordField
              label="현재 비밀번호"
              value={current}
              onChange={setCurrent}
              show={showCurrent}
              onToggleShow={() => setShowCurrent((v) => !v)}
              autoComplete="new-password"
              pending={pending}
            />
            <PasswordField
              label="새 비밀번호 (8자 이상)"
              value={next}
              onChange={setNext}
              show={showNext}
              onToggleShow={() => setShowNext((v) => !v)}
              autoComplete="new-password"
              pending={pending}
            />
            <PasswordField
              label="새 비밀번호 확인"
              value={confirm}
              onChange={setConfirm}
              show={showConfirm}
              onToggleShow={() => setShowConfirm((v) => !v)}
              autoComplete="new-password"
              pending={pending}
              onEnter={() => {
                if (!submitDisabled) handleSubmit();
              }}
            />

            {error ? <div style={errorStyle}>{error}</div> : null}

            {/* ── 버튼 ── */}
            <div style={buttonRowStyle}>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                style={{
                  ...secondaryButtonStyle,
                  opacity: pending ? 0.4 : 1,
                  cursor:  pending ? "not-allowed" : "pointer",
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {forced ? "나중에" : "취소"}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitDisabled}
                style={{
                  ...primaryButtonStyle,
                  opacity: submitDisabled ? 0.4 : 1,
                  cursor:  submitDisabled ? "not-allowed" : "pointer",
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {pending ? "변경 중" : "변경"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════
 * PasswordField — 눈 아이콘 토글 포함 입력 필드
 * ═════════════════════════════════════════════ */

function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  pending,
  onEnter,
}: {
  label:        string;
  value:        string;
  onChange:     (v: string) => void;
  show:         boolean;
  onToggleShow: () => void;
  autoComplete: string;
  pending:      boolean;
  onEnter?:     () => void;
}) {
  return (
    <div style={fieldWrapStyle}>
      <label style={fieldLabelStyle}>{label}</label>
      <div style={inputRowStyle}>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
          autoComplete={autoComplete}
          readOnly={pending}
          style={{ ...inputStyle, opacity: pending ? 0.65 : 1 }}
        />
        <button
          type="button"
          onClick={onToggleShow}
          disabled={pending}
          aria-label={show ? "비밀번호 숨기기" : "비밀번호 표시"}
          title={show ? "숨기기" : "표시"}
          style={{
            ...eyeButtonStyle,
            opacity: pending ? 0.4 : 1,
            cursor:  pending ? "not-allowed" : "pointer",
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {show ? "🙈" : "👁"}
        </button>
      </div>
    </div>
  );
}

/* ── 스타일 ── */

const backdropStyle: CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(20, 30, 50, 0.55)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  padding:        20,
  zIndex:         200,
};

const cardStyle: CSSProperties = {
  width:         "100%",
  maxWidth:      420,
  background:    "#fff",
  borderRadius:  16,
  padding:       "20px 22px",
  display:       "flex",
  flexDirection: "column",
  gap:           12,
  boxShadow:     "0 20px 40px rgba(20, 40, 90, 0.35)",
};

const headerStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           6,
};

const titleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   18,
  color:      "#0d6fa8",
};

const forcedNoticeStyle: CSSProperties = {
  fontFamily:    GAEGU,
  fontWeight:    700,
  fontSize:      13.5,
  color:         "#9a6b00",
  background:    "#fffaeb",
  borderTopWidth:    1.5,
  borderRightWidth:  1.5,
  borderBottomWidth: 1.5,
  borderLeftWidth:   1.5,
  borderStyle:       "solid",
  borderTopColor:    "#f0e4c0",
  borderRightColor:  "#f0e4c0",
  borderBottomColor: "#f0e4c0",
  borderLeftColor:   "#f0e4c0",
  borderRadius:  10,
  padding:       "8px 12px",
  lineHeight:    1.5,
};

/* 입력 필드 */

const fieldWrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           4,
};

const fieldLabelStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#5a7488",
};

const inputRowStyle: CSSProperties = {
  display: "flex",
  gap:     6,
};

const inputStyle: CSSProperties = {
  flex:              1,
  minWidth:          0,
  height:            36,
  borderTopWidth:    2,
  borderRightWidth:  2,
  borderBottomWidth: 2,
  borderLeftWidth:   2,
  borderStyle:       "solid",
  borderTopColor:    "#bfe4f7",
  borderRightColor:  "#bfe4f7",
  borderBottomColor: "#bfe4f7",
  borderLeftColor:   "#bfe4f7",
  borderRadius:      10,
  padding:           "0 12px",
  fontFamily:        BODY,
  fontSize:          14,
  color:             NAVY,
  outline:           "none",
  background:        "#fff",
};

const eyeButtonStyle: CSSProperties = {
  width:             36,
  height:            36,
  borderTopWidth:    1.5,
  borderRightWidth:  1.5,
  borderBottomWidth: 1.5,
  borderLeftWidth:   1.5,
  borderStyle:       "solid",
  borderTopColor:    "#cfe4f2",
  borderRightColor:  "#cfe4f2",
  borderBottomColor: "#cfe4f2",
  borderLeftColor:   "#cfe4f2",
  borderRadius:      10,
  background:        "#f6faff",
  fontSize:          16,
  padding:           0,
  flexShrink:        0,
};

const errorStyle: CSSProperties = {
  fontFamily:   GAEGU,
  fontWeight:   700,
  fontSize:     13,
  color:        "#c2410c",
  background:   "#fff5f0",
  padding:      "8px 12px",
  borderRadius: 10,
};

/* 성공 화면 */

const successCardStyle: CSSProperties = {
  display:        "flex",
  flexDirection:  "column",
  alignItems:     "center",
  gap:            8,
  padding:        "20px 16px",
  background:     "#eefaf3",
  borderRadius:   12,
};

const successEmojiStyle: CSSProperties = {
  fontSize: 34,
};

const successTextStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   15,
  color:      "#1e7d6a",
};

/* 버튼 */

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap:     8,
  marginTop: 4,
};

const secondaryButtonStyle: CSSProperties = {
  flex:              1,
  height:            36,
  borderTopWidth:    1.5,
  borderRightWidth:  1.5,
  borderBottomWidth: 1.5,
  borderLeftWidth:   1.5,
  borderStyle:       "solid",
  borderTopColor:    "#cfd8de",
  borderRightColor:  "#cfd8de",
  borderBottomColor: "#cfd8de",
  borderLeftColor:   "#cfd8de",
  borderRadius:      999,
  background:        "#fff",
  color:             "#48606f",
  fontFamily:        JUA,
  fontSize:          13,
};

const primaryButtonStyle: CSSProperties = {
  flex:         1,
  height:       36,
  borderWidth:  0,
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     13,
  boxShadow:    "0 3px 0 #0d6fa8",
};