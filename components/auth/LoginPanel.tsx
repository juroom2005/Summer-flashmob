// components/auth/LoginPanel.tsx
"use client";

import { useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { JUA, GAEGU, BODY } from "./fonts";

type Props = {
  onSuccess?:         () => void;
  onSwitchToRegister: () => void;
};

export default function LoginPanel({ onSuccess, onSwitchToRegister }: Props) {
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

      onSuccess?.();
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ fontFamily: JUA, fontSize: 23, color: "#0d6fa8", marginBottom: 4 }}>
       로그인
      </div>
      <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 17, color: "#2ea3dd", marginBottom: 16 }}>
        가입한 이메일과 비밀번호를 입력하세요.
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
          placeholder="비밀번호"
          autoComplete="current-password"
          disabled={loading}
          style={inputStyle}
        />

        {error ? (
          <div style={errorStyle}>{error}</div>
        ) : null}

        <button type="submit" disabled={loading} style={primaryButtonStyle}>
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>

      <div style={{ textAlign: "center", fontSize: 12.5, color: "#7fb3d4", marginTop: 12 }}>
        처음이라면{" "}
        <button
          type="button"
          onClick={onSwitchToRegister}
          style={switchLinkStyle}
        >
          초대코드로 가입
        </button>
      </div>
    </div>
  );
}

/* ── 스타일 (NoticeBoard 톤 정합) ── */

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