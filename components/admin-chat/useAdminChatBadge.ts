// components/admin-chat/useAdminChatBadge.ts
//
// 관리자호출 아이콘에 표시할 미읽음 카운트를 관리하는 훅.
//
// 역할별 카운트 정의:
//   · 일반 유저 → 자기 방의 미읽음 메시지 개수 (GM 답장 + 완료 안내)
//   · GM        → 미읽음 방 개수 (답을 기다리는 유저 수)
//   · 미로그인   → 0
//
// Realtime:
//   · 유저 → gm_conversation_messages INSERT 구독 (자기 방 필터)
//            방 id를 알아야 필터가 걸리므로, 방이 아직 없으면 구독 없이 0 유지.
//            방 생성은 오버레이 진입 시 이뤄지므로, 첫 진입 전에는 받을 메시지도 없음.
//   · GM   → gm_conversations 의 전체 변경 구독
//
// 부하 관리:
//   변경 이벤트마다 카운트 재조회가 발생하므로 300ms 디바운스로 묶음.
//
// 사용:
//   const { count } = useAdminChatBadge({ chatOpen: overlay === "admin" });
//   · chatOpen=true 인 동안에는 오버레이 쪽에서 읽음 처리가 계속 일어나므로
//     카운트가 0으로 수렴함. 별도 억제 로직 불필요.
//
// 안정성:
//   · 모든 조회 실패는 0 반환 (헬퍼 레벨에서 처리). 뱃지가 잘못 뜨는 것보다 안 뜨는 게 안전
//   · unmount 시 채널 제거 + 타이머 정리
//   · cancelled 플래그로 stale 반영 차단

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import {
  getGmUnreadRoomCount,
  getMyGmConversation,
  getMyGmUnreadCount,
} from "@/lib/gm-chat-helpers";

/** 카운트 재조회 디바운스 간격(ms). */
const REFRESH_DEBOUNCE_MS = 300;

type Options = {
  /** 채팅 오버레이가 열려있는지. 열림 전이 시 즉시 한 번 갱신하는 용도. */
  chatOpen: boolean;
};

export function useAdminChatBadge({ chatOpen }: Options): { count: number } {
  const { user, isGm, loading } = useCurrentUser();
  const [count, setCount] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 역할에 맞는 카운트 재조회. */
  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0);
      return;
    }
    const n = isGm ? await getGmUnreadRoomCount() : await getMyGmUnreadCount();
    setCount(n);
  }, [user, isGm]);

  /** 디바운스된 재조회. */
  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  /* ── Realtime 구독 + 최초 조회 ── */
  useEffect(() => {
    if (loading) return;

    if (!user) {
      setCount(0);
      return;
    }

    let cancelled = false;

    // GM: 방 테이블 전체 변경 구독
    if (isGm) {
      const channel = supabase
        .channel("gm-chat-badge-gm")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "gm_conversations" },
          () => {
            if (!cancelled) scheduleRefresh();
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && !cancelled) void refresh();
        });

      return () => {
        cancelled = true;
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        void supabase.removeChannel(channel);
      };
    }

    // 일반 유저: 자기 방의 메시지 INSERT 구독.
    // 방 id를 먼저 조회해야 필터를 걸 수 있음.
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      // 최초 카운트는 방 유무와 무관하게 조회 (방 없으면 0)
      await refresh();
      if (cancelled) return;

      const conv = await getMyGmConversation();
      if (cancelled || !conv) return;

      channel = supabase
        .channel(`gm-chat-badge-user-${conv.id}`)
        .on(
          "postgres_changes",
          {
            event:  "INSERT",
            schema: "public",
            table:  "gm_conversation_messages",
            filter: `conversation_id=eq.${conv.id}`,
          },
          () => {
            if (!cancelled) scheduleRefresh();
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && !cancelled) void refresh();
        });
    })();

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user, isGm, loading, refresh, scheduleRefresh]);

  /* ── 오버레이 열림/닫힘 전이 시 즉시 갱신 ──
   * 열 때: 방이 막 생성된 직후일 수 있어 재조회
   * 닫을 때: 오버레이 안에서 읽음 처리된 결과를 반영
   */
  useEffect(() => {
    if (loading || !user) return;
    void refresh();
  }, [chatOpen, loading, user, refresh]);

  return { count };
}