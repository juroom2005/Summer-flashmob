// components/admin-chat/AdminChatOverlay.tsx
//
// 관리자 호출 채팅 오버레이 (v2 — open/close 대칭 애니메이션).
//
// 변경점 (v1 → v2):
//   - v1은 open=false일 때 즉시 return null → exit 애니메이션 재생 안 됨
//   - v2는 visible/closing state로 exit 애니메이션 재생 후 unmount
//     · open=true  → visible=true, closing=false → enter 애니메이션
//     · open=false → closing=true → exit 애니메이션 → duration 후 visible=false
//
// keyframes는 module.css에 자체 정의 (CSS Modules 스코프 문제 회피).

"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import styles from "./AdminChatOverlay.module.css";

type ChatMsg = { who: "me" | "admin"; text: string };

const ADMIN_REPLIES = [
  "확인했어요! 바로 봐드릴게요 🔍",
  "앗, 그건 공지사항 탭에 정리해뒀어요!",
  "네네 접수 완료! 잠시만 기다려주세요 ⏳",
];

const INITIAL_MSGS: ChatMsg[] = [
  { who: "admin", text: "안녕하세요, 운영진입니다! 무엇을 도와드릴까요? 🙌" },
];

// enter/exit 애니메이션 duration (module.css의 --overlay-anim-ms와 반드시 일치)
const ANIM_MS = 400;

type Props = {
  open:    boolean;
  onClose: () => void;
};

export default function AdminChatOverlay({ open, onClose }: Props) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(INITIAL_MSGS);
  const [text, setText] = useState("");

  // 애니메이션 라이프사이클:
  //   visible=false                → DOM에 없음
  //   visible=true, closing=false  → 표시 중 (enter 애니메이션 or 유지 상태)
  //   visible=true, closing=true   → exit 애니메이션 재생 중
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // open prop 변화 감지 → 애니메이션 라이프사이클 관리
  useEffect(() => {
    if (open) {
      // 오픈: 즉시 표시 + enter 애니메이션
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      // 닫기: exit 애니메이션 재생 후 unmount
      setClosing(true);
      exitTimerRef.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
        exitTimerRef.current = null;
      }, ANIM_MS);
    }

    return () => {
      // open이 다시 바뀌면 진행 중이던 exit 타이머 취소
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [open, visible]);

  // 채팅 스크롤 하단 고정
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, visible]);

  if (!visible) return null;

  function send() {
    const t = text.trim();
    if (!t) return;

    const meCount = msgs.filter((m) => m.who === "me").length;
    const reply = ADMIN_REPLIES[meCount % ADMIN_REPLIES.length];

    setMsgs((ms) => [...ms, { who: "me", text: t }]);
    setText("");

    setTimeout(() => {
      setMsgs((ms) => [...ms, { who: "admin", text: reply }]);
    }, 700);
  }

  return (
    <div className={`${styles.overlay} ${closing ? styles.closing : ""}`}>
      {/* 헤더 */}
      <div className={styles.header}>
        <span className={styles.avatar}>🧑‍💻</span>
        <span className={styles.titleWrap}>
          <span className={styles.title}>관리자 호출</span>
          <span className={styles.subtitle}>
            <span className={styles.statusDot} />
            운영진 온라인
          </span>
        </span>
        <button
          onClick={onClose}
          className={styles.closeButton}
          aria-label="닫기"
        >
          ✕
        </button>
      </div>

      {/* 채팅 본문 */}
      <div ref={bodyRef} className={styles.body}>
        <div className={styles.dateChip}>오늘 · 관리자와 연결됐어요</div>
        {msgs.map((m, i) => (
          <div
            key={i}
            className={m.who === "me" ? styles.rowMe : styles.rowAdmin}
          >
            <div
              className={m.who === "me" ? styles.bubbleMe : styles.bubbleAdmin}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {/* 입력 바 */}
      <div className={styles.inputBar}>
        <input
          value={text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
          onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") send();
          }}
          placeholder="메시지 입력..."
          className={styles.input}
        />
        <button onClick={send} className={styles.sendButton}>
          전송
        </button>
      </div>
    </div>
  );
}