// components/auth/RegisterPanel.tsx
"use client";

import { useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { callEdgeFunction } from "@/lib/ef-client";
import { JUA, GAEGU, BODY } from "./fonts";

type Props = {
  onSuccess?:      () => void;
  onSwitchToLogin: () => void;
};

export default function RegisterPanel({ onSuccess, onSwitchToLogin }: Props) {
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

      // 2) register-user EF 호출
      const result = await callEdgeFunction<{ success: boolean }>(
        "register-user",
        { invite_code: codeTrim }
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

  return (
    <div>
      <div style={{ fontFamily: JUA, fontSize: 23, color: "#0d6fa8", marginBottom: 4 }}>
        📮 초대코드로 가입
      </div>
      <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 17, color: "#2ea3dd", marginBottom: 16 }}>
        운영진에게 받은 초대코드가 필요해요!
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="text"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          placeholder="초대코드 (XXXX-XXXX-XXXX)"
          disabled={loading}
          style={{ ...inputStyle, fontFamily: "monospace", letterSpacing: "0.1em" }}
        />
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

        {error ? (
          <div style={errorStyle}>{error}</div>
        ) : null}

        <button type="submit" disabled={loading} style={primaryButtonStyle}>
          {loading ? "가입 처리 중..." : "가입"}
        </button>
      </form>

      <div style={{ textAlign: "center", fontSize: 12.5, color: "#7fb3d4", marginTop: 12 }}>
        이미 가입하셨나요?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          style={switchLinkStyle}
        >
          로그인
        </button>
      </div>
    </div>
  );
}

/* ── 스타일 (LoginPanel과 정합) ── */

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