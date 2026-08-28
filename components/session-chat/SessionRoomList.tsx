// components/session-chat/SessionRoomList.tsx
//
// 방 목록. 사양: 다른 방도 이름은 보이지만 입장 불가(can_enter=false → aria-disabled).
//   · 현재 방은 aria-current="true"
//   · 입장 불가 방은 버튼을 남겨두되 aria-disabled + 클릭 시 안내만(포커스 순서 유지)

"use client";

import type { SessionRoom } from "@/lib/session-chat-helpers";
import styles from "./Session.module.css";

type Props = {
  rooms:       SessionRoom[];
  activeId:    string | null;
  loading:     boolean;
  onSelect:    (room: SessionRoom) => void;
  onBlocked:   (room: SessionRoom) => void;
};

export default function SessionRoomList({ rooms, activeId, loading, onSelect, onBlocked }: Props) {
  return (
    <nav className={styles.roomList} aria-label="채팅방 목록" aria-busy={loading}>
      <h2 className={styles.roomListHeading}>채팅방</h2>
      {rooms.length === 0 && !loading ? (
        <div className={styles.emptyHint} style={{ padding: "12px 14px" }}>
          아직 열린 방이 없습니다.
        </div>
      ) : null}
      <ul className={styles.roomUl}>
        {rooms.map((r) => {
          const active  = r.id === activeId;
          const blocked = !r.can_enter;
          const names = r.members.map((m) => m.name).filter(Boolean).join(", ");
          return (
            <li key={r.id}>
              <button
                type="button"
                className={styles.roomBtn}
                aria-current={active ? "true" : undefined}
                aria-disabled={blocked ? "true" : undefined}
                onClick={() => (blocked ? onBlocked(r) : onSelect(r))}
              >
                <span className={styles.roomName}>
                  {r.name}
                  {r.is_archived ? <span className={`${styles.tag} ${styles.tagMuted}`}>보관</span> : null}
                  {!r.is_open ? <span className={`${styles.tag} ${styles.tagMuted}`}>닫힘</span> : null}
                  {blocked ? <span className={`${styles.tag} ${styles.tagMuted}`}>입장 불가</span> : null}
                </span>
                <span className={styles.roomMeta}>
                  {r.member_count}명{names ? ` · ${names}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
