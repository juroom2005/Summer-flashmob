// components/auth/RegisterPanel.tsx
//
// 초대코드 가입 흐름 (v2 — 3단계).
//
// 변경점 (v1 → v2):
//   Step 1: 초대코드만 입력 → preview-invite EF 호출 → 캐릭터 정보 확보
//   Step 2: 캐릭터 정보 카드 표시 + 이메일·비번 입력 → auth.signUp + register-user EF
//     · "네, 저 맞아요" 버튼: 가입 진행
//     · "정보가 달라요" 버튼: mismatch 화면으로 전환
//   Step 3 (mismatch): GM 문의 안내. "다시 확인" 버튼으로 Step 1 복귀
//
// 이 흐름의 장점:
//   - 가입 전에 확인하므로 정보 틀렸을 때 auth 계정 orphan 안 생김
//   - 유저가 자기가 어떤 캐릭터로 등록되는지 사전 인지

"use client";

import { useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { callEdgeFunction } from "@/lib/ef-client";
import { JUA, GAEGU, BODY } from "./fonts";

type Props = {
  onSuccess?:      () => void;
  onSwitchToLogin: () => void;
};

type Step = "code" | "confirm" | "mismatch";

type Gender = "male" | "female" | "other";

type PreviewData = {
  family_name: string;
  given_name:  string;
  age:         number;
  gender:      Gender;
  school_name: string;
  grade:       number;
};

const GENDER_LABEL: Record<Gender, string> = {
  male:   "남",
  female: "여",
  other:  "기타",
};

export default function RegisterPanel({ onSuccess, onSwitchToLogin }: Props) {
  const [step, setStep] = useState<Step>("code");

  // Step 1 상태
  const [inviteCode, setInviteCode] = useState("");

  // Step 2 상태
  const [preview,    setPreview]    = useState<PreviewData | null>(null);
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [password2,  setPassword2]  = useState("");

  // 공통
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  /* ── Step 1: 코드 확인 → preview 조회 ── */
  async function handleCheckCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const codeTrim = inviteCode.trim();
    if (!codeTrim) {
      setError("초대코드를 입력하세요.");
      return;
    }

    setLoading(true);
    try {
      const result = await callEdgeFunction<PreviewData>(
        "preview-invite",
        { invite_code: codeTrim }
      );

      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }

      setPreview(result.data);
      setStep("confirm");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  /* ── Step 2: 정보 확인 → 실제 가입 ── */
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const emailTrim = email.trim();
    if (!emailTrim) {
      setError("이메일을 입력하세요.");
      return;
    }
    if (!password) {
      setError("비밀번호를 입력하세요.");
      return;
    }
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    if (password !== password2) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    try {
      // 1) auth 계정 생성
      const { error: signUpErr } = await supabase.auth.signUp({
        email:    emailTrim,
        password,
      });

      if (signUpErr) {
        setError(signUpErr.message || "가입에 실패했습니다.");
        setLoading(false);
        return;
      }

      // 2) register-user EF (shell profile에 user_id 연결)
      const result = await callEdgeFunction<{ success: boolean }>(
        "register-user",
        { invite_code: inviteCode.trim().toUpperCase() }
      );

      if (!result.ok) {
        // EF 실패 → auth 계정만 남음. 세션 정리 후 안내.
        await supabase.auth.signOut();
        setError(
          `가입 완료 처리에 실패했습니다: ${result.error}${
            result.detail ? ` (${result.detail})` : ""
          }`
        );
        setLoading(false);
        return;
      }

      onSuccess?.();
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  /* ── Step 3: 다시 확인 ── */
  function handleRetry() {
    setStep("code");
    setPreview(null);
    setInviteCode("");
    setEmail("");
    setPassword("");
    setPassword2("");
    setError(null);
  }

  return (
    <div>
      {/* ═══ Step 1: 코드 입력 ═══ */}
      {step === "code" ? (
        <>
          <div style={titleStyle}>📮 초대코드로 가입</div>
          <div style={subtitleStyle}>운영진에게 받은 초대코드를 입력하세요!</div>

          <form onSubmit={handleCheckCode} style={formStyle}>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="초대코드 (XXXX-XXXX-XXXX)"
              disabled={loading}
              autoFocus
              style={{ ...inputStyle, fontFamily: "monospace", letterSpacing: "0.1em" }}
            />

            {error ? <div style={errorStyle}>{error}</div> : null}

            <button type="submit" disabled={loading} style={primaryButtonStyle}>
              {loading ? "확인 중..." : "다음"}
            </button>
          </form>

          <div style={switchWrapStyle}>
            이미 가입하셨나요?{" "}
            <button
              type="button"
              onClick={onSwitchToLogin}
              style={switchLinkStyle}
            >
              로그인
            </button>
          </div>
        </>
      ) : null}

      {/* ═══ Step 2: 정보 확인 + 가입 ═══ */}
      {step === "confirm" && preview ? (
        <>
          <div style={titleStyle}>✨ 캐릭터 확인</div>
          <div style={subtitleStyle}>이 정보로 가입할게요. 맞나요?</div>

          {/* 캐릭터 정보 카드 */}
          <div style={previewCardStyle}>
            <div style={previewNameStyle}>
              {preview.family_name} {preview.given_name}
            </div>
            <div style={previewMetaGridStyle}>
              <div style={previewMetaItemStyle}>
                <span style={previewMetaLabelStyle}>나이</span>
                <span style={previewMetaValueStyle}>{preview.age}세</span>
              </div>
              <div style={previewMetaItemStyle}>
                <span style={previewMetaLabelStyle}>성별</span>
                <span style={previewMetaValueStyle}>{GENDER_LABEL[preview.gender]}</span>
              </div>
              <div style={previewMetaItemStyle}>
                <span style={previewMetaLabelStyle}>학년</span>
                <span style={previewMetaValueStyle}>{preview.grade}학년</span>
              </div>
              <div style={previewMetaItemStyle}>
                <span style={previewMetaLabelStyle}>학교</span>
                <span style={previewMetaValueStyle}>{preview.school_name}</span>
              </div>
            </div>
          </div>

          <form onSubmit={handleRegister} style={formStyle}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일"
              autoComplete="email"
              disabled={loading}
              style={inputStyle}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 (6자 이상)"
              autoComplete="new-password"
              disabled={loading}
              style={inputStyle}
            />
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="비밀번호 확인"
              autoComplete="new-password"
              disabled={loading}
              style={inputStyle}
            />

            {error ? <div style={errorStyle}>{error}</div> : null}

            <button type="submit" disabled={loading} style={primaryButtonStyle}>
              {loading ? "가입 처리 중..." : "네, 저 맞아요"}
            </button>
          </form>

          <div style={switchWrapStyle}>
            <button
              type="button"
              onClick={() => setStep("mismatch")}
              style={switchLinkStyle}
              disabled={loading}
            >
              정보가 달라요
            </button>
          </div>
        </>
      ) : null}

      {/* ═══ Step 3: 정보 불일치 안내 ═══ */}
      {step === "mismatch" ? (
        <>
          <div style={titleStyle}>🙏 GM에게 문의해주세요</div>
          <div style={subtitleStyle}>정보가 다르다면 등록이 잘못된 것 같아요.</div>

          <div style={mismatchCardStyle}>
            <div style={mismatchTextStyle}>
              홈 화면 오른쪽 위 <strong>「📞 관리자호출」</strong> 버튼으로
              운영진에게 연락해주세요.
              <br /><br />
              어떤 캐릭터 정보가 잘못 등록됐는지 알려주시면
              바로 확인해드릴게요!
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={handleRetry}
              style={secondaryButtonStyle}
            >
              다시 확인
            </button>
          </div>

          <div style={switchWrapStyle}>
            이미 가입하셨나요?{" "}
            <button
              type="button"
              onClick={onSwitchToLogin}
              style={switchLinkStyle}
            >
              로그인
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ── 스타일 ── */

const titleStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     23,
  color:        "#0d6fa8",
  marginBottom: 4,
};

const subtitleStyle: CSSProperties = {
  fontFamily:   GAEGU,
  fontWeight:   700,
  fontSize:     17,
  color:        "#2ea3dd",
  marginBottom: 16,
};

const formStyle: CSSProperties = {
  display:        "flex",
  flexDirection:  "column",
  gap:            10,
};

const inputStyle: CSSProperties = {
  height:       44,
  border:       "2px solid #bfe4f7",
  borderRadius: 12,
  padding:      "0 14px",
  fontFamily:   BODY,
  fontSize:     15,
  color:        "#1e4b6e",
  outline:      "none",
  background:   "#f4fbff",
};

const errorStyle: CSSProperties = {
  padding:      "8px 12px",
  fontFamily:   BODY,
  fontSize:     13,
  color:        "#c0392b",
  background:   "rgba(192, 57, 43, 0.08)",
  border:       "1.5px solid rgba(192, 57, 43, 0.25)",
  borderRadius: 8,
};

const primaryButtonStyle: CSSProperties = {
  height:       46,
  border:       0,
  borderRadius: 12,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     17,
  cursor:       "pointer",
  boxShadow:    "0 4px 0 #0d6fa8",
};

const secondaryButtonStyle: CSSProperties = {
  height:       44,
  border:       "2px solid #bfe4f7",
  borderRadius: 12,
  background:   "#fff",
  color:        "#0d6fa8",
  fontFamily:   JUA,
  fontSize:     15,
  cursor:       "pointer",
};

const switchWrapStyle: CSSProperties = {
  textAlign:  "center",
  fontSize:   12.5,
  color:      "#7fb3d4",
  marginTop:  12,
};

const switchLinkStyle: CSSProperties = {
  background:     "none",
  border:         "none",
  padding:        0,
  color:          "#1a9edb",
  fontFamily:     "inherit",
  fontSize:       "inherit",
  fontWeight:     700,
  cursor:         "pointer",
  textDecoration: "underline",
};

/* ── preview 카드 ── */

const previewCardStyle: CSSProperties = {
  padding:      "16px 20px",
  background:   "#f4fbff",
  border:       "2px solid #bfe4f7",
  borderRadius: 14,
  marginBottom: 16,
};

const previewNameStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     22,
  color:        "#0d6fa8",
  textAlign:    "center",
  marginBottom: 12,
  paddingBottom: 10,
  borderBottom: "1.5px dashed #a8dcf5",
};

const previewMetaGridStyle: CSSProperties = {
  display:              "grid",
  gridTemplateColumns:  "1fr 1fr",
  gap:                  "8px 14px",
};

const previewMetaItemStyle: CSSProperties = {
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "baseline",
  fontFamily:     BODY,
  fontSize:       14,
};

const previewMetaLabelStyle: CSSProperties = {
  color:      "#7fb3d4",
  fontSize:   12,
};

const previewMetaValueStyle: CSSProperties = {
  color:      "#14406f",
  fontWeight: 700,
};

/* ── mismatch 카드 ── */

const mismatchCardStyle: CSSProperties = {
  padding:      "16px 18px",
  background:   "#fff8d6",
  border:       "2px solid #e2c341",
  borderRadius: 14,
};

const mismatchTextStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   14,
  lineHeight: 1.6,
  color:      "#7a6a12",
};