// components/admin-chat/GmChatView.tsx
//
// GM 관점 채팅 뷰. 좌측 방 목록 + 우측 선택된 방.
//
// 구조:
//   ┌──────────┬──────────────────┐
//   │ 방 목록   │ 선택된 방        │
//   │ (뱃지)   │ (ChatRoomBody)   │
//   └──────────┴──────────────────┘
//
// Realtime 두 채널:
//   1) 목록 채널  — gm_conversations 의 INSERT/UPDATE 구독
//                   · 유저가 메시지 보내면 트리거로 last_user_msg_at 갱신 → UPDATE 발생
//                   · 신규 유저 첫 진입 시 INSERT 발생
//                   · 열린 방이 바뀌어도 유지 (재구독 안 함)
//   2) 방 채널   — 선택된 방의 gm_conversation_messages INSERT 구독
//                   · 선택 방이 바뀔 때마다 재구독
//
// 부하 관리:
//   목록 갱신은 각 방마다 unread count 쿼리가 필요(최대 25회). UPDATE가 연달아 오면
//   낭비가 크므로 400ms 디바운스로 묶어서 처리.
//
// 안정성:
//   · 두 채널 모두 SUBSCRIBED 시점에 전체 재조회 → 재연결 누락 복구
//   · 메시지는 id 기준 dedup + created_at 정렬
//   · unmount·선택 변경 시 removeChannel 및 디바운스 타이머 정리
//   · 완료 처리는 확인 다이얼로그 경유 (ChatRoomBody 내부)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  listGmConversations,
  listGmMessages,
  markGmConversationReadForGm,
  resolveGmConversation,
  sendGmMessage,
  type GmChatMessage,
  type GmConversationForGm,
} from "@/lib/gm-chat-helpers";
import ChatRoomBody from "./ChatRoomBody";
import styles from "./GmChatView.module.css";

type Props = {
  /** 현재 GM의 profiles.id. 말풍선 좌우 판별용. */
  myProfileId: string | null;
};

/** 방 목록 재조회 디바운스 간격(ms). */
const LIST_REFRESH_DEBOUNCE_MS = 400;

/** 목록에 표시할 이름. 미등록 상태 대비 fallback. */
function displayNameOf(conv: GmConversationForGm): string {
  const p = conv.user_profile;
  if (!p) return "(알 수 없는 유저)";
  const full = [p.family_name, p.given_name].filter(Boolean).join(" ");
  return full.length > 0 ? full : "(이름 미등록)";
}

/** 이니셜 아바타용 첫 글자. 이름이 없거나 괄호 표기면 물음표. */
function initialOf(name: string): string {
  const t = name.trim();
  if (!t || t.startsWith("(")) return "?";
  // 공백 제거 후 첫 글자(한글·영문 등)
  return Array.from(t.replace(/\s/g, ""))[0] ?? "?";
}

/** 목록 우측 시각 표기. 오늘이면 HH:mm, 아니면 MM-DD. */
function shortStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth() &&
    d.getDate()     === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function GmChatView({ myProfileId }: Props) {
  const [convs,       setConvs]       = useState<GmConversationForGm[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activeId,    setActiveId]    = useState<string | null>(null);
  const [messages,    setMessages]    = useState<GmChatMessage[]>([]);
  const [msgLoading,  setMsgLoading]  = useState(false);
  const [sending,     setSending]     = useState(false);
  const [resolving,   setResolving]   = useState(false);

  const listDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Realtime 콜백 안에서 최신 activeId를 참조하기 위한 ref
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

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

  /** 방 목록 재조회 (unread count 포함). */
  const refreshList = useCallback(async () => {
    const rows = await listGmConversations();
    setConvs(rows);
    setListLoading(false);
  }, []);

  /** 디바운스된 목록 재조회. Realtime UPDATE 폭주 대비. */
  const scheduleListRefresh = useCallback(() => {
    if (listDebounceRef.current) clearTimeout(listDebounceRef.current);
    listDebounceRef.current = setTimeout(() => {
      listDebounceRef.current = null;
      void refreshList();
    }, LIST_REFRESH_DEBOUNCE_MS);
  }, [refreshList]);

  /* ── 목록 채널 (마운트 시 1회, 선택 변경과 무관하게 유지) ── */
  useEffect(() => {
    let cancelled = false;

    const channel = supabase
      .channel("gm-chat-conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gm_conversations" },
        () => {
          if (cancelled) return;
          scheduleListRefresh();
        }
      )
      .subscribe((status) => {
        // 최초 구독·재연결 모두 여기 → 전체 재조회로 누락 복구
        if (status === "SUBSCRIBED" && !cancelled) {
          void refreshList();
        }
      });

    return () => {
      cancelled = true;
      if (listDebounceRef.current) {
        clearTimeout(listDebounceRef.current);
        listDebounceRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [refreshList, scheduleListRefresh]);

  /* ── 방 채널 (선택된 방마다 재구독) ── */
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setMsgLoading(true);
    setMessages([]);

    async function refetchMessages() {
      const rows = await listGmMessages(activeId!);
      if (cancelled) return;
      setMessages((prev) => mergeMessages(prev, rows));
      setMsgLoading(false);
      // 열어본 방은 읽음 처리 → 목록 뱃지도 갱신
      const res = await markGmConversationReadForGm(activeId!);
      if (!cancelled && res.ok) scheduleListRefresh();
    }

    const channel = supabase
      .channel(`gm-chat-room-${activeId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "gm_conversation_messages",
          filter: `conversation_id=eq.${activeId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as GmChatMessage;
          setMessages((prev) => mergeMessages(prev, [row]));

          // 열려있는 방에 유저 메시지가 도착 → 즉시 읽음 처리
          if (row.sender_role === "user" && activeIdRef.current === activeId) {
            void markGmConversationReadForGm(activeId!).then((res) => {
              if (!cancelled && res.ok) scheduleListRefresh();
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !cancelled) {
          void refetchMessages();
        }
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [activeId, mergeMessages, scheduleListRefresh]);

  /* ── 전송 ── */
  async function handleSend(content: string) {
    if (!activeId || sending) return;
    setSending(true);
    try {
      const res = await sendGmMessage(activeId, content);
      if (res.ok) {
        setMessages((prev) => mergeMessages(prev, [res.message]));
      } else {
        const msg =
          res.reason === "too_long"
            ? "메시지가 너무 깁니다. 2000자 이내로 작성해주십시오."
            : res.reason === "no_profile"
            ? "GM 권한을 확인할 수 없습니다. 다시 로그인해주십시오."
            : res.reason === "empty"
            ? ""
            : "메시지 전송에 실패하였습니다. 잠시 후 다시 시도해주십시오.";
        if (msg) window.alert(msg);
      }
    } finally {
      setSending(false);
    }
  }

  /* ── 완료 처리 ── */
  async function handleResolve() {
    if (!activeId || resolving) return;
    setResolving(true);
    try {
      const res = await resolveGmConversation(activeId);
      if (res.ok) {
        // Realtime으로도 들어오지만 즉시 반영을 위해 재조회
        const rows = await listGmMessages(activeId);
        setMessages((prev) => mergeMessages(prev, rows));
      } else {
        window.alert("완료 처리에 실패하였습니다. 잠시 후 다시 시도해주십시오.");
      }
    } finally {
      setResolving(false);
    }
  }

  /* ── 렌더 ── */

  return (
    <div className={styles.split}>
      {/* 좌측 · 방 목록 */}
      <div className={styles.listPane}>
        {listLoading ? (
          <div className={styles.listNotice}>불러오는 중입니다…</div>
        ) : convs.length === 0 ? (
          <div className={styles.listNotice}>문의 채팅방이 없습니다.</div>
        ) : (
          convs.map((c) => {
            const isActive = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                className={`${styles.listItem} ${isActive ? styles.listItemActive : ""}`}
              >
                {/* 이니셜 아바타 (유저 이미지 기능 추가 시 이 자리를 사진으로 대체) */}
                <span className={styles.itemAvatar} aria-hidden="true">
                  {initialOf(displayNameOf(c))}
                </span>
                <span className={styles.itemName}>{displayNameOf(c)}</span>
                <span className={styles.itemMeta}>
                  <span className={styles.itemTime}>
                    {shortStamp(c.last_user_msg_at)}
                  </span>
                  {c.unread_count > 0 ? (
                    <span className={styles.itemBadge}>
                      {c.unread_count > 99 ? "99+" : c.unread_count}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* 우측 · 선택된 방 */}
      <div className={styles.roomPane}>
        {!activeId ? (
          <div className={styles.roomNotice}>
            좌측 목록에서 채팅방을 선택해주십시오.
          </div>
        ) : msgLoading ? (
          <div className={styles.roomNotice}>불러오는 중입니다…</div>
        ) : (
          <ChatRoomBody
            messages={messages}
            myProfileId={myProfileId}
            onSend={handleSend}
            sending={sending}
            onResolve={handleResolve}
            resolving={resolving}
          />
        )}
      </div>
    </div>
  );
}