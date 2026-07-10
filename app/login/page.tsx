// app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isCurrentUserGm } from "@/lib/auth-helpers";

export default function LoginPage() {
  const router = useRouter();

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력하세요.");
      return;
    }

    setLoading(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email:    email.trim(),
        password,
      });

      if (signInErr) {
        setError(signInErr.message || "로그인에 실패했습니다.");
        setLoading(false);
        return;
      }

      // 로그인 성공 후 GM 여부에 따라 라우팅
      const isGm = await isCurrentUserGm();
      router.push(isGm ? "/gm" : "/");
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={panelStyle}>
        <div style={tagStyle}>// LOGIN</div>
        <h1 style={titleStyle}>로그인</h1>

        <form onSubmit={handleSubmit} style={formStyle}>
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
            <span style={labelTextStyle}>비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              disabled={loading}
              autoComplete="current-password"
              style={inputStyle}
            />
          </label>

          {error && <div style={errorStyle}>{error}</div>}

          <button type="submit" disabled={loading} style={buttonStyle}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <div style={footerStyle}>
          아직 계정이 없으신가요?{" "}
          <a href="/register" style={linkStyle}>초대코드로 가입</a>
        </div>
      </div>
    </div>
  );
}

/* ===== 스타일 (globals.css의 CSS 변수 활용) ===== */

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

const linkStyle: React.CSSProperties = {
  color:          "var(--green)",
  textDecoration: "none",
  fontWeight:     600,
};