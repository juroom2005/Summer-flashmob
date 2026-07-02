// app/page.tsx (임시 검증용)
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [status, setStatus] = useState<string>("확인 중...");

  useEffect(() => {
    (async () => {
      try {
        // auth 세션 조회 — 로그인 안 돼있으면 null이 정상
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          setStatus(`❌ auth 오류: ${error.message}`);
          return;
        }
        setStatus(
          `✅ Supabase 연결 OK / 세션: ${data.session ? "있음" : "없음 (정상)"}`
        );
      } catch (e) {
        setStatus(`❌ 예외: ${String(e)}`);
      }
    })();
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        fontFamily: "var(--mono)",
        padding: 24,
      }}
    >
      <div style={{ fontSize: "var(--fs-xl)", fontWeight: 700 }}>
        SUMMER FLASHMOB
      </div>
      <div
        style={{
          fontSize: "var(--fs-sm)",
          color: "var(--text-mid)",
          letterSpacing: "0.05em",
        }}
      >
        // 로컬 환경 정합 검증
      </div>
      <div
        style={{
          fontSize: "var(--fs-md)",
          padding: "12px 20px",
          background: "var(--accent-light)",
          border: "1px solid var(--accent-border)",
          borderRadius: 6,
        }}
      >
        {status}
      </div>
    </main>
  );
}