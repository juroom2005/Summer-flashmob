// components/session-chat/SessionShell.tsx
//
// /session 라우트의 실제 화면. 가드 + 방 목록 + 선택된 방.
//
// 가드(fail-closed):
//   · 미로그인 / 프로필 없음 → 로그인 안내만 (관리 UI 미렌더)
//   · 토글 OFF 이고 GM 아님 → "준비 중" 안내만
//   실제 차단은 서버(RLS + RPC)가 한다. 여기는 노출 차단.
//
// Realtime:
//   · session_rooms / session_room_members 변경 → 목록 재조회(디바운스)
//   · site_settings UPDATE → 토글 재조회 (GM 이 끄면 유저 화면이 즉시 안내로 바뀜)
//
// 모바일: 목록 화면 ↔ 방 화면 전환(.showList / .showRoom).

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentProfile } from "@/lib/auth-helpers";
import {
  getSessionChatEnabled,
  listSessionRooms,
  type SessionRoom,
} from "@/lib/session-chat-helpers";
import SessionRoomList from "./SessionRoomList";
import SessionRoomView from "./SessionRoomView";
import Loader from "./Loader";
import styles from "./Session.module.css";

const LIST_DEBOUNCE_MS = 300;

type Me = { profileId: string; isGm: boolean; name: string };

export default function SessionShell() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = 확인 중
  const [enabled, setEnabled] = useState<boolean>(false);
  const [rooms, setRooms] = useState<SessionRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileShowRoom, setMobileShowRoom] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  /* ── 가드 ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getCurrentProfile();
      if (cancelled) return;
      if (!p) { setMe(null); return; }
      setMe({
        profileId: p.id,
        isGm:      p.is_gm === true,
        name:      p.is_gm ? "GM" : `${p.family_name ?? ""} ${p.given_name ?? ""}`.trim(),
      });
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── 토글 ── */
  const refreshEnabled = useCallback(async () => {
    const on = await getSessionChatEnabled();
    setEnabled(on);
  }, []);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    void refreshEnabled();
    const ch = supabase
      .channel("session-site-settings")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "site_settings" },
        () => { if (!cancelled) void refreshEnabled(); }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !cancelled) void refreshEnabled();
      });
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [me, refreshEnabled]);

  /* ── 방 목록 ── */
  const refreshRooms = useCallback(async () => {
    if (!me) return;
    const list = await listSessionRooms(false);
    setRooms(list);
    setRoomsLoading(false);
  }, [me]);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void refreshRooms();
    }, LIST_DEBOUNCE_MS);
  }, [refreshRooms]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    const ch = supabase
      .channel("session-rooms-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "session_rooms" },
        () => { if (!cancelled) scheduleRefresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "session_room_members" },
        () => { if (!cancelled) scheduleRefresh(); })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !cancelled) void refreshRooms();
      });
    return () => {
      cancelled = true;
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      void supabase.removeChannel(ch);
    };
  }, [me, refreshRooms, scheduleRefresh]);

  // 선택된 방이 목록에서 사라졌거나(보관) 입장권을 잃으면 선택 해제
  useEffect(() => {
    if (!activeId) return;
    const r = rooms.find((x) => x.id === activeId);
    if (!roomsLoading && (!r || !r.can_enter)) {
      setActiveId(null);
      setMobileShowRoom(false);
      if (r && !r.can_enter) showToast("이 방의 참가자에서 제외되었습니다.");
    }
  }, [rooms, activeId, roomsLoading]);

  /* ── 렌더 ── */

  if (me === undefined) {
    return (
      <div className={styles.page}>
        <div className={styles.centerNote}>
          <Loader label="조사방을 여는 중" />
        </div>
      </div>
    );
  }

  if (me === null) {
    return (
      <div className={styles.page}>
        <div className={styles.centerNote}>
          <h2>로그인이 필요합니다</h2>
          <p>조사는 로그인한 참가자만 이용할 수 있습니다.</p>
          <a href="/" className={styles.linkBtn}>홈으로</a>
        </div>
      </div>
    );
  }

  if (!enabled && !me.isGm) {
    return (
      <div className={styles.page}>
        <div className={styles.centerNote}>
          <h2>조사 준비 중</h2>
          <p>지금은 열려 있지 않습니다. GM 이 열면 홈 화면에 입장 버튼이 나타납니다.</p>
          <a href="/" className={styles.linkBtn}>홈으로</a>
        </div>
      </div>
    );
  }

  const activeRoom = activeId ? rooms.find((r) => r.id === activeId) ?? null : null;

  return (
    <div className={styles.page}>
      <a href="#session-main" className={styles.srOnly}>본문으로 건너뛰기</a>
      <header className={styles.topbar}>
        <h1 className={styles.topbarTitle}>
          Summer-flashmob!
          <span className={styles.topbarSub}>{me.name}</span>
          {me.isGm && !enabled ? (
            <span className={`${styles.status} ${styles.statusWarn}`} style={{ marginLeft: 8 }}>
              유저 노출 OFF
            </span>
          ) : null}
        </h1>
        {me.isGm ? <a href="/gm" className={`${styles.linkBtn} ${styles.btnSmall}`}>GM 관리</a> : null}
        <a href="/" className={`${styles.linkBtn} ${styles.btnSmall}`}>홈으로</a>
      </header>

      <div
        id="session-main"
        className={`${styles.body} ${mobileShowRoom && activeRoom ? styles.showRoom : styles.showList}`}
      >
        <SessionRoomList
          rooms={rooms}
          activeId={activeId}
          loading={roomsLoading}
          onSelect={(r) => { setActiveId(r.id); setMobileShowRoom(true); }}
          onBlocked={() => showToast("이 방의 참가자가 아니라 들어갈 수 없습니다.")}
        />

        {activeRoom ? (
          <SessionRoomView
            key={activeRoom.id}
            room={activeRoom}
            myProfileId={me.profileId}
            isGm={me.isGm}
            enabled={enabled}
            onBack={() => setMobileShowRoom(false)}
          />
        ) : (
          <section className={styles.roomView} aria-label="방 선택 안내">
            <div className={styles.centerNote} style={{ gridColumn: "1 / -1" }}>
              <h2>방을 선택하세요</h2>
              <p>왼쪽 목록에서 참가 중인 방을 고르면 스크립트와 채팅이 열립니다.</p>
            </div>
          </section>
        )}
      </div>

      {toast ? (
        <div role="status" aria-live="polite" className={styles.alert} style={{ position: "fixed", left: 12, right: 12, bottom: 16, zIndex: 50, textAlign: "center" }}>
          {toast}
        </div>
      ) : null}
    </div>
  );
}