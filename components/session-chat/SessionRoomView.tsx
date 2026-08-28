// components/session-chat/SessionRoomView.tsx
//
// 선택된 방 한 개의 화면. 데이터 소유자.
//   · 메시지 전체를 한 배열로 들고, 스크립트/채팅 스트림으로 나눠 두 패널에 전달
//   · Realtime: session_messages INSERT + UPDATE(수정·소프트삭제) 구독.
//     SUBSCRIBED 마다(최초·재연결) 전체 재조회 → 끊겼던 동안 누락 복구.
//     탭이 백그라운드였다가 돌아와도(visibilitychange) 재조회.
//
// ★ "조용히 끊긴 구독" 방어 (2026-08-27 보강) ★
//   WebSocket 이 half-open 으로 죽으면 supabase-js 상태 콜백이 침묵할 수 있다.
//   그러면 화면은 "연결됨"인데 남의 메시지가 안 온다("혼자 떠드는" 상황).
//   이를 막기 위해 라이브러리 상태에 의존하지 않는 두 겹을 더 둔다:
//     (a) 주기적 재동기화: RESYNC_MS 마다 REST 로 전체 재조회(병합은 id 기준이라
//         중복·역순 없음). 구독이 조용히 죽어도 최대 RESYNC_MS 뒤엔 밀린 게 뜬다.
//     (b) 신선도: 재동기화가 "성공한" 시각만 기록. 마지막 성공에서 STALE_MS 가
//         지나면 상태를 강제로 "재연결 중"으로 표시하고, 채팅 입력 위에 경고를
//         띄운다(전송은 막지 않음 — RPC 는 REST 라 WebSocket 이 죽어도 서버에
//         정상 저장되고 상대는 자기 재동기화 때 받는다).
//   전송(RPC) 자체가 실패하면 그건 인터넷 단절이며 role="alert" 로 이미 표시된다.
//
// 사고 방지:
//   · 낙관적 업데이트 없음. RPC 반환 행을 병합할 뿐이라 실패해도 화면에 잔상 없음.
//   · 병합은 id 기준이라 Realtime 과 재조회가 겹쳐도 중복·역순 없음.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { supabase } from "@/lib/supabase";
import {
  fetchSessionMessages,
  gmDeleteSessionMessage,
  gmPostSessionScript,
  gmUpdateSessionScript,
  mergeSessionMessages,
  rollSessionDice,
  sendSessionMessage,
  type RollType,
  type SessionMessage,
  type SessionRoom,
} from "@/lib/session-chat-helpers";
import ChatPane from "./ChatPane";
import ScriptPane from "./ScriptPane";
import styles from "./Session.module.css";

type Props = {
  room:        SessionRoom;
  myProfileId: string | null;
  isGm:        boolean;
  /** site_settings.session_chat_enabled */
  enabled:     boolean;
  onBack:      () => void;
};

type MobileTab = "script" | "chat";
type ConnState = "connecting" | "live" | "reconnecting";

// 재동기화 주기 / "오래됨" 기준 (1번: 촘촘)
const RESYNC_MS = 10_000;
const STALE_MS  = 25_000;
// 신선도 판정을 위한 시계 틱 (STALE 경계를 넘었는지 주기적으로 확인)
const FRESH_TICK_MS = 5_000;

const MOBILE_QUERY = "(max-width: 899px)";

/** 모바일 폭 여부. SSR 에선 false, 마운트 후 matchMedia 로 갱신. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return mobile;
}

export default function SessionRoomView({ room, myProfileId, isGm, enabled, onBack }: Props) {
  const roomId = room.id;
  const isMobile = useIsMobile();

  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [conn, setConn]         = useState<ConnState>("connecting");
  // 마지막으로 서버와 동기화에 성공한 시각(ms). null = 아직 한 번도 성공 못 함.
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  // 신선도 재평가용 틱. STALE 경계를 주기적으로 다시 계산하기 위한 리렌더 트리거.
  const [freshTick, setFreshTick] = useState(0);

  const [sending, setSending]     = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [scriptBusy, setScriptBusy]   = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const [mobileTab, setMobileTab] = useState<MobileTab>("script");
  const [unreadScript, setUnreadScript] = useState(0);
  const [unreadChat, setUnreadChat]     = useState(0);
  const mobileTabRef = useRef<MobileTab>("script");
  mobileTabRef.current = mobileTab;

  const merge = useCallback((incoming: SessionMessage[]) => {
    setMessages((prev) => mergeSessionMessages(prev, incoming));
  }, []);

  /* ── 재동기화 ──
     성공 시에만 lastSyncAt 갱신. 실패면 기존 메시지 유지(화면 안 지움) +
     신선도 정체 → STALE 경계를 넘으면 경고로 바뀜.
     initial=true 는 방 최초 로드(성공하면 loading 해제). */
  const resync = useCallback(
    async (initial = false) => {
      const res = await fetchSessionMessages(roomId);
      if (res.ok) {
        // 성공: 서버 상태로 교체(삭제분 정리). 병합으로 안전.
        setMessages(mergeSessionMessages([], res.messages));
        setLastSyncAt(Date.now());
        if (initial) setLoading(false);
      } else if (initial) {
        // 최초 로드 실패: 로딩만 해제(빈 화면 + 곧 경고). 다음 틱에 재시도됨.
        setLoading(false);
      }
      return res.ok;
    },
    [roomId]
  );

  /* ── Realtime 구독 ── */
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setLoading(true);
    setConn("connecting");
    setLastSyncAt(null);
    setUnreadScript(0);
    setUnreadChat(0);
    setChatError(null);
    setScriptError(null);

    const channel = supabase
      .channel(`session-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "session_messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as SessionMessage;
          merge([row]);
          // 실시간 이벤트가 왔다는 건 구독이 살아있다는 신호 → 신선도 갱신
          setLastSyncAt(Date.now());
          // 숨은 모바일 탭 뱃지 (내가 보낸 건 제외)
          const mine = !!myProfileId && row.sender_profile_id === myProfileId;
          if (mine) return;
          if (row.kind === "script" && mobileTabRef.current !== "script") {
            setUnreadScript((n) => n + 1);
          } else if (row.kind !== "script" && mobileTabRef.current !== "chat") {
            setUnreadChat((n) => n + 1);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "session_messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (cancelled) return;
          merge([payload.new as SessionMessage]);
          setLastSyncAt(Date.now());
        }
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setConn("live");
          void resync(true);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConn("reconnecting");
        }
      });

    // 백그라운드 → 복귀 시 즉시 재동기화
    function onVisible() {
      if (document.visibilityState === "visible" && !cancelled) void resync();
    }
    document.addEventListener("visibilitychange", onVisible);

    // (a) 주기적 재동기화 — 구독 상태와 무관하게 항상 돈다
    const resyncTimer = setInterval(() => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return; // 숨은 탭은 복귀 때 처리
      void resync();
    }, RESYNC_MS);

    // (b) 신선도 재평가 틱 — STALE 경계 넘었는지 주기적으로 확인
    const freshTimer = setInterval(() => {
      if (!cancelled) setFreshTick((n) => (n + 1) % 1_000_000);
    }, FRESH_TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(resyncTimer);
      clearInterval(freshTimer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [roomId, merge, resync, myProfileId]);

  // 폭이 바뀌면 뱃지 초기화(데스크톱에선 둘 다 보이므로 의미 없음)
  useEffect(() => {
    setUnreadScript(0);
    setUnreadChat(0);
  }, [isMobile]);

  /* ── 신선도 판정 ──
     마지막 동기화 성공에서 STALE_MS 초과면 stale. 아직 한 번도 성공 못 했고
     로딩이 끝났으면(=최초 조회 실패) 역시 stale 로 본다. */
  const stale = useMemo(() => {
    void freshTick; // 틱마다 재평가 (deps 에 포함)
    if (lastSyncAt == null) return !loading; // 최초 성공 전엔 로딩 중이 아니면 stale
    return Date.now() - lastSyncAt > STALE_MS;
  }, [lastSyncAt, loading, freshTick]);

  // 표시용 연결 상태: 구독이 live 라도 신선도가 죽었으면 경고로.
  const effectiveConn: ConnState =
    conn === "live" ? (stale ? "reconnecting" : "live") : conn;

  /* ── 스트림 분리 ── */
  const scriptMsgs = useMemo(() => messages.filter((m) => m.kind === "script"), [messages]);
  const chatMsgs   = useMemo(() => messages.filter((m) => m.kind !== "script"), [messages]);

  /* ── 발언 가능 여부 ── */
  const canPost = isGm || (enabled && room.is_open && room.can_enter);
  const readOnlyNote = !room.can_enter
    ? "이 방의 참가자가 아닙니다."
    : !room.is_open
    ? "닫힌 방입니다. 열람만 가능합니다."
    : !enabled
    ? "지금은 세션 채팅을 사용할 수 없습니다."
    : null;

  // 연결 불안정 경고(입력창 위). 발언 가능 + stale 일 때만.
  const staleWarning =
    canPost && stale && !loading
      ? "연결이 불안정합니다. 최신 메시지가 안 보이거나 전송이 늦을 수 있습니다. 자동으로 다시 맞추는 중입니다."
      : null;

  /* ── 액션 ── */
  async function handleSend(content: string): Promise<boolean> {
    if (sending) return false;
    setSending(true);
    setChatError(null);
    try {
      const res = await sendSessionMessage(roomId, content);
      if (!res.ok) {
        setChatError(res.message);
        return false;
      }
      merge([res.data]);
      setLastSyncAt(Date.now()); // 서버 왕복 성공 → 신선
      return true;
    } finally {
      setSending(false);
    }
  }

  async function handleRoll(type: RollType) {
    if (sending) return;
    setSending(true);
    setChatError(null);
    try {
      const res = await rollSessionDice(roomId, type);
      if (!res.ok) {
        setChatError(res.message);
        return;
      }
      merge([res.data]);
      setLastSyncAt(Date.now());
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(messageId: string) {
    const res = await gmDeleteSessionMessage(messageId);
    if (!res.ok) {
      setChatError(res.message);
      setScriptError(res.message);
      return;
    }
    // UPDATE 이벤트로도 오지만, 즉시 반영
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }

  async function handlePostScript(content: string): Promise<boolean> {
    if (scriptBusy) return false;
    setScriptBusy(true);
    setScriptError(null);
    try {
      const res = await gmPostSessionScript(roomId, content);
      if (!res.ok) {
        setScriptError(res.message);
        return false;
      }
      merge([res.data]);
      setLastSyncAt(Date.now());
      return true;
    } finally {
      setScriptBusy(false);
    }
  }

  async function handleEditScript(messageId: string, content: string): Promise<boolean> {
    if (scriptBusy) return false;
    setScriptBusy(true);
    setScriptError(null);
    try {
      const res = await gmUpdateSessionScript(messageId, content);
      if (!res.ok) {
        setScriptError(res.message);
        return false;
      }
      merge([res.data]);
      setLastSyncAt(Date.now());
      return true;
    } finally {
      setScriptBusy(false);
    }
  }

  /* ── 모바일 탭 ── */
  function selectTab(t: MobileTab) {
    setMobileTab(t);
    if (t === "script") setUnreadScript(0);
    else setUnreadChat(0);
  }
  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next: MobileTab = mobileTab === "script" ? "chat" : "script";
      selectTab(next);
      const el = document.getElementById(`session-tab-${next}`);
      el?.focus();
    }
  }

  const memberNames = room.members.map((m) => m.name).filter(Boolean).join(", ");

  const connLabel =
    effectiveConn === "live"
      ? "실시간 연결됨"
      : effectiveConn === "connecting"
      ? "연결 중…"
      : "재연결 중…";

  return (
    <section className={styles.roomView} aria-label={`채팅방: ${room.name}`}>
      <div className={styles.roomHeader}>
        <button type="button" className={`${styles.btn} ${styles.btnSmall} ${styles.backBtn}`} onClick={onBack}>
          ← 목록
        </button>
        <h2 className={styles.roomHeaderTitle}>
          {room.name}
          <span className={styles.topbarSub}>
            {room.is_open ? "열림" : "닫힘"} · {room.member_count}명
            {memberNames ? ` (${memberNames})` : ""}
          </span>
        </h2>
        <span
          className={`${styles.status} ${effectiveConn !== "live" ? styles.statusWarn : ""}`}
          role="status"
          aria-live="polite"
        >
          {connLabel}
        </span>
      </div>

      {/* 모바일 탭 (데스크톱은 두 패널이 나란히 보이므로 렌더하지 않음) */}
      {isMobile ? (
      <div className={styles.tabs} role="tablist" aria-label="스크립트 / 채팅 전환">
        <button
          type="button"
          role="tab"
          id="session-tab-script"
          aria-selected={mobileTab === "script"}
          aria-controls="session-panel-script"
          tabIndex={mobileTab === "script" ? 0 : -1}
          className={styles.tab}
          onClick={() => selectTab("script")}
          onKeyDown={onTabKeyDown}
        >
          스크립트
          {unreadScript > 0 ? (
            <span className={styles.tabBadge} aria-label={`새 스크립트 ${unreadScript}개`}>
              {unreadScript > 99 ? "99+" : unreadScript}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          id="session-tab-chat"
          aria-selected={mobileTab === "chat"}
          aria-controls="session-panel-chat"
          tabIndex={mobileTab === "chat" ? 0 : -1}
          className={styles.tab}
          onClick={() => selectTab("chat")}
          onKeyDown={onTabKeyDown}
        >
          채팅
          {unreadChat > 0 ? (
            <span className={styles.tabBadge} aria-label={`새 메시지 ${unreadChat}개`}>
              {unreadChat > 99 ? "99+" : unreadChat}
            </span>
          ) : null}
        </button>
      </div>
      ) : null}

      <div
        id="session-panel-script"
        role={isMobile ? "tabpanel" : undefined}
        aria-labelledby={isMobile ? "session-tab-script" : undefined}
        aria-label={isMobile ? undefined : "GM 스크립트"}
        className={`${styles.pane} ${styles.scriptPane}`}
        hidden={isMobile && mobileTab !== "script" ? true : undefined}
        aria-busy={loading}
      >
        <ScriptPane
          roomId={roomId}
          messages={scriptMsgs}
          isGm={isGm}
          loading={loading}
          busy={scriptBusy}
          error={scriptError}
          onPost={isGm ? handlePostScript : undefined}
          onEdit={isGm ? handleEditScript : undefined}
          onDelete={isGm ? handleDelete : undefined}
        />
      </div>

      <div
        id="session-panel-chat"
        role={isMobile ? "tabpanel" : undefined}
        aria-labelledby={isMobile ? "session-tab-chat" : undefined}
        aria-label={isMobile ? undefined : "채팅"}
        className={`${styles.pane} ${styles.chatPane}`}
        hidden={isMobile && mobileTab !== "chat" ? true : undefined}
        aria-busy={loading}
      >
        <ChatPane
          roomId={roomId}
          messages={chatMsgs}
          myProfileId={myProfileId}
          isGm={isGm}
          loading={loading}
          canPost={canPost}
          readOnlyNote={readOnlyNote}
          staleWarning={staleWarning}
          sending={sending}
          error={chatError}
          onSend={handleSend}
          onRoll={handleRoll}
          onDelete={isGm ? handleDelete : undefined}
        />
      </div>
    </section>
  );
}