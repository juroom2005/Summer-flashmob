// components/admin-chat/UserChatView.tsx
//
// 유저 관점 GM 채팅방 뷰 (유저당 방 1개 고정).
//
// 흐름:
//   1) 마운트 시 ensureMyGmConversation() → 방 id 확보 (없으면 생성)
//   2) listMyGmMessages() → 전체 이력 로드
//   3) markMyGmConversationRead() → 읽음 스탬프 갱신
//   4) Realtime 구독 시작 (gm_conversation_messages INSERT, 자기 방 필터)
//
// 안정성 설계:
//   · 자기가 보낸 메시지도 Realtime으로 되돌아옴 → id 기준 dedup
//   · SUBSCRIBED 이벤트마다 전체 재조회 → 재연결 시 누락 메시지 복구
//   · unmount 시 removeChannel 로 확실히 정리
//   · 방 확보 실패(null) → 에러 상태 표시. 재시도 버튼 제공
//   · 모든 async 콜백은 cancelled 플래그로 stale 반영 차단
//
// 읽음 처리:
//   · 최초 로드 시 1회
//   · 이후 GM/system 메시지가 Realtime으로 도착할 때마다 (오버레이가 열려있는 상태이므로)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ensureMyGmConversation,
  listMyGmMessages,
  markMyGmConversationRead,
  sendMyGmMessage,
  type GmChatMessage,
} from "@/lib/gm-chat-helpers";
import ChatRoomBody from "./ChatRoomBody";
import styles from "./UserChatView.module.css";

type Props = {
  /** 현재 유저의 profiles.id. 말풍선 좌우 판별용. */
  myProfileId: string | null;
};

type LoadState = "loading" | "ready" | "error";

export default function UserChatView({ myProfileId }: Props) {
  const [convId,   setConvId]   = useState<string | null>(null);
  const [messages, setMessages] = useState<GmChatMessage[]>([]);
  const [state,    setState]    = useState<LoadState>("loading");
  const [sending,  setSending]  = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // stale 콜백 차단용
  const cancelledRef = useRef(false);

  /** id 기준 dedup + created_at 오름차순 정렬로 병합. */
  const mergeMessages = useCallback(
    (prev: GmChatMessage[], incoming: GmChatMessage[]): GmChatMessage[] => {
      const map = new Map<string, GmChatMessage>();
      for (const m of prev)     map.set(m.id, m);
      for (const m of incoming) map.set(m.id, m);
      return Array.from(map.values()).sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
      );
    },
    []
  );

  /* ── 1단계: 방 확보 ── */
  useEffect(() => {
    cancelledRef.current = false;
    setState("loading");

    (async () => {
      const id = await ensureMyGmConversation();
      if (cancelledRef.current) return;

      if (!id) {
        setState("error");
        return;
      }
      setConvId(id);
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [reloadTick]);

  /* ── 2단계: 방 확보 후 이력 로드 + Realtime 구독 ── */
  useEffect(() => {
    if (!convId) return;

    let cancelled = false;

    /** 전체 재조회. 최초 로드·재연결 복구 양쪽에서 사용. */
    async function refetchAll() {
      const rows = await listMyGmMessages(convId!);
      if (cancelled) return;
      setMessages((prev) => mergeMessages(prev, rows));
      setState("ready");
      // 읽음 스탬프 갱신 (실패해도 치명적이지 않음)
      void markMyGmConversationRead(convId!);
    }

    const channel = supabase
      .channel(`gm-chat-user-${convId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "gm_conversation_messages",
          filter: `conversation_id=eq.${convId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as GmChatMessage;
          setMessages((prev) => mergeMessages(prev, [row]));

          // GM·system 메시지가 도착했고 오버레이가 열려있는 상태 → 즉시 읽음 처리
          if (row.sender_role === "gm" || row.sender_role === "system") {
            void markMyGmConversationRead(convId!);
          }
        }
      )
      .subscribe((status) => {
        // 최초 구독 성공·재연결 성공 모두 여기로 들어옴 → 매번 전체 재조회로 누락 복구
        if (status === "SUBSCRIBED" && !cancelled) {
          void refetchAll();
        }
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [convId, mergeMessages]);

  /* ── 전송 ── */
  async function handleSend(content: string) {
    if (!convId || sending) return;
    setSending(true);
    try {
      const res = await sendMyGmMessage(convId, content);
      if (res.ok) {
        // Realtime으로도 들어오지만 즉시 반영 위해 병합 (dedup 되므로 중복 없음)
        setMessages((prev) => mergeMessages(prev, [res.message]));
      } else {
        const msg =
          res.reason === "too_long"
            ? "메시지가 너무 깁니다. 2000자 이내로 작성해주십시오."
            : res.reason === "no_profile"
            ? "프로필 정보를 확인할 수 없습니다. 다시 로그인해주십시오."
            : res.reason === "empty"
            ? ""
            : "메시지 전송에 실패하였습니다. 잠시 후 다시 시도해주십시오.";
        if (msg) window.alert(msg);
      }
    } finally {
      setSending(false);
    }
  }

  /* ── 렌더 ── */

  if (state === "loading") {
    return <div className={styles.notice}>불러오는 중입니다…</div>;
  }

  if (state === "error" || !convId) {
    return (
      <div className={styles.notice}>
        <p className={styles.noticeText}>
          채팅방을 준비하지 못하였습니다.
          <br />
          잠시 후 다시 시도해주십시오.
        </p>
        <button
          type="button"
          className={styles.retryButton}
          onClick={() => setReloadTick((t) => t + 1)}
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <ChatRoomBody
      messages={messages}
      myProfileId={myProfileId}
      onSend={handleSend}
      sending={sending}
    />
  );
}