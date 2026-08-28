// components/noticeboard/SessionEntryButton.tsx
// ═══════════════════════════════════════════════════════════════════
// 세션 채팅 입장 버튼 (홈 스테이지 좌하단, 채팅 문의 버튼 오른쪽)
// ═══════════════════════════════════════════════════════════════════
//
// 노출 규칙:
//   · GM            : 항상 표시 (준비·테스트용)
//   · 로그인 유저    : site_settings.session_chat_enabled = true 일 때만
//   · 비로그인       : 표시하지 않음
//
// site_settings UPDATE 를 Realtime 으로 구독해 GM 이 토글을 바꾸면 새로고침
// 없이 나타나거나 사라진다. 조회 실패 시 숨김(fail-closed).
//
// 실제 차단은 서버(RLS/RPC). 이 버튼은 노출만 담당.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getSessionChatEnabled } from "@/lib/session-chat-helpers";
import styles from "./SessionEntryButton.module.css";

type Props = {
  isLoggedIn: boolean;
  isGm:       boolean;
};

export default function SessionEntryButton({ isLoggedIn, isGm }: Props) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) { setEnabled(false); return; }
    let cancelled = false;

    async function refresh() {
      const on = await getSessionChatEnabled();
      if (!cancelled) setEnabled(on);
    }
    void refresh();

    const ch = supabase
      .channel("session-entry-site-settings")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "site_settings" },
        () => { void refresh(); }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [isLoggedIn]);

  if (!isLoggedIn) return null;
  if (!enabled && !isGm) return null;

  return (
    <div className={styles.wrap}>
      <a href="/session" className={styles.btn} aria-label="세션 채팅 입장">
        <span className={styles.sign} aria-hidden="true">
          {/* 주사위(d6) 아이콘 */}
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3A1.5 1.5 0 1 0 7.5 9a1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />
          </svg>
        </span>
        <span className={styles.text}>세션 채팅</span>
      </a>
    </div>
  );
}
