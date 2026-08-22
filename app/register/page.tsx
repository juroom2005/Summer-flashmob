// app/register/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { callEdgeFunction } from "@/lib/ef-client";

export default function RegisterPage() {
  const router = useRouter();

  const [inviteCode, setInviteCode] = useState("");
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [password2,  setPassword2]  = useState("");

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const codeTrim  = inviteCode.trim();
    const emailTrim = email.trim();

    if (!codeTrim) {
      setError("초대코드를 입력하세요.");
      return;
    }
    if (!emailTrim) {
      setError("이메일을 입력하세요.");
      return;
    }
    if (!password) {
      setError("비밀번호를 입력하세요.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== password2) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);

    try {
      // 1) auth.users 생성 + 즉시 세션 (Confirm OFF 전제)
      const { error: signUpErr } = await supabase.auth.signUp({
        email:    emailTrim,
        password,
      });

      if (signUpErr) {
        setError(signUpErr.message || "가입에 실패했습니다.");
        setLoading(false);
        return;
      }

      // 2) register-user EF 호출 (JWT는 자동으로 실림)
      const result = await callEdgeFunction<{ success: boolean }>(
        "register-user",
        { invite_code: codeTrim }
      );

      if (!result.ok) {
        // EF 실패 → auth 계정만 남음. 유저에게 안내하고 로그아웃.
        // (재시도 시 같은 이메일로 signUp이 실패할 수 있어 명시적 로그아웃)
        await supabase.auth.signOut();
        setError(
          `가입 완료 처리에 실패했습니다: ${result.error}${
            result.detail ? ` (${result.detail})` : ""
          }`
        );
        setLoading(false);
        return;
      }

      // 3) 성공 → 홈으로
      router.push("/");
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={panelStyle}>
        <div style={tagStyle}>// REGISTER</div>
        <h1 style={titleStyle}>초대코드로 가입</h1>

        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={labelStyle}>
            <span style={labelTextStyle}>초대코드</span>
            <input
              type="text"
              value={inviteCode}
              onChange={(ev) => setInviteCode(ev.target.value.toUpperCase())}
              disabled={loading}
              placeholder="XXXX-XXXX-XXXX"
              style={{ ...inputStyle, fontFamily: "var(--mono)", letterSpacing: "0.1em" }}
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>이메일</span>
            <input
              type="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              disabled={loading}
              autoComplete="email"
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>비밀번호 (8자 이상)</span>
            <input
              type="password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              disabled={loading}
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>비밀번호 확인</span>
            <input
              type="password"
              value={password2}
              onChange={(ev) => setPassword2(ev.target.value)}
              disabled={loading}
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>

          {error && <div style={errorStyle}>{error}</div>}

          <button type="submit" disabled={loading} style={buttonStyle}>
            {loading ? "가입 처리 중..." : "가입"}
          </button>

          <div style={consentStyle}>
            가입 시{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={linkStyle}>
              개인정보 처리 안내
            </a>
            에 동의한 것으로 간주됩니다.
          </div>
        </form>

        <div style={footerStyle}>
          이미 가입하셨나요?{" "}
          <a href="/login" style={linkStyle}>로그인</a>
        </div>
      </div>
    </div>
  );
}

/* ===== 스타일 (login/page.tsx와 동일 톤. 재사용성 낮으니 지금은 복제 유지) ===== */

const pageStyle: React.CSSProperties = {
  minHeight:       "100vh",
  display:         "flex",
  alignItems:      "center",
  justifyContent:  "center",
  padding:         "24px",
};

const panelStyle: React.CSSProperties = {
  width:        "100%",
  maxWidth:     "420px",
  padding:      "36px 32px",
  background:   "var(--panel-bg)",
  border:       "1px solid var(--panel-border)",
  borderRadius: "8px",
};

const tagStyle: React.CSSProperties = {
  fontFamily:    "var(--mono)",
  fontSize:      "var(--fs-xs)",
  color:         "var(--green)",
  letterSpacing: "0.15em",
  marginBottom:  "12px",
};

const titleStyle: React.CSSProperties = {
  fontFamily:   "var(--display)",
  fontSize:     "var(--fs-xl)",
  fontWeight:   800,
  color:        "var(--text)",
  marginBottom: "28px",
};

const formStyle: React.CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           "16px",
};

const labelStyle: React.CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           "6px",
};

const labelTextStyle: React.CSSProperties = {
  fontFamily:    "var(--mono)",
  fontSize:      "var(--fs-xs)",
  color:         "var(--text-mid)",
  letterSpacing: "0.1em",
};

const inputStyle: React.CSSProperties = {
  padding:      "10px 12px",
  fontSize:     "var(--fs-md)",
  fontFamily:   "var(--body)",
  color:        "var(--text)",
  background:   "#fff",
  border:       "1px solid var(--panel-border)",
  borderRadius: "4px",
  outline:      "none",
};

const errorStyle: React.CSSProperties = {
  padding:      "10px 12px",
  fontSize:     "var(--fs-sm)",
  color:        "#c0392b",
  background:   "rgba(192, 57, 43, 0.08)",
  border:       "1px solid rgba(192, 57, 43, 0.2)",
  borderRadius: "4px",
};

const buttonStyle: React.CSSProperties = {
  marginTop:    "8px",
  padding:      "12px 16px",
  fontFamily:   "var(--mono)",
  fontSize:     "var(--fs-sm)",
  letterSpacing: "0.1em",
  color:        "#fff",
  background:   "var(--green)",
  border:       "none",
  borderRadius: "4px",
  cursor:       "pointer",
};

const footerStyle: React.CSSProperties = {
  marginTop:  "24px",
  fontSize:   "var(--fs-sm)",
  color:      "var(--text-mid)",
  textAlign:  "center",
};

const consentStyle: React.CSSProperties = {
  marginTop: "4px",
  fontSize:  "var(--fs-xs)",
  color:     "var(--text-mid)",
  textAlign: "center",
  lineHeight: 1.6,
};

const linkStyle: React.CSSProperties = {
  color:          "var(--green)",
  textDecoration: "none",
  fontWeight:     600,
};