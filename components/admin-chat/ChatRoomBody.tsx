// components/admin-chat/ChatRoomBody.tsx
//
// 유저·GM 채팅방 공통 본문 컴포넌트.
// 메시지 리스트 + 입력바 + (선택) 완료 버튼.
//
// 자기 메시지 판별:
//   isMine = sender_profile_id === myProfileId
//   · 유저 관점: 자기(user) 오른쪽, gm 왼쪽
//   · GM 관점:   자기(gm)   오른쪽, user 왼쪽
//   시스템 메시지는 SystemDivider로 별도 렌더.
//
// 방이 없는 상태에서는 이 컴포넌트를 렌더하지 않음 (컨테이너 책임).
// 방은 있고 메시지가 0건인 상태는 여기서 빈 안내 문구만 표시.
//
// 완료 버튼:
//   · onResolve prop이 넘어오면 렌더 → GM 전용 표시로 자연스럽게 분기
//   · 클릭 시 window.confirm 으로 재확인 (이 프로젝트 방침: 완료 취소 불가)
//
// 한글 IME 대응:
//   · Enter 전송 시 e.nativeEvent.isComposing 체크로 조합 중 오전송 방지
//
// ── v2 수정: 입력창 포커스 유지 ──
//   문제: disabled={sending} 이면 전송 중 브라우저가 포커스를 강제 해제하고,
//         sending=false 로 돌아와도 포커스가 복원되지 않아 연속 입력이 끊김.
//   해결 3중:
//     1) disabled 대신 readOnly 사용 (포커스 유지하면서 입력만 차단)
//     2) 전송 버튼에 onMouseDown preventDefault → 클릭 시 포커스 이동 자체를 차단
//     3) sending true→false 전이 시점에 명시적 focus() 복원 (보정)
//   완료 버튼은 그대로 disabled 유지 (입력창이 아니라 포커스 영향 없음).

"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { GmChatMessage } from "@/lib/gm-chat-helpers";
import SystemDivider from "./SystemDivider";
import styles from "./ChatRoomBody.module.css";

type Props = {
  messages:      GmChatMessage[];
  myProfileId:   string | null;
  onSend:        (content: string) => void | Promise<void>;
  sending:       boolean;
  /** 넘어오면 완료 버튼 렌더 (GM 전용). */
  onResolve?:    () => void | Promise<void>;
  resolving?:    boolean;
};

export default function ChatRoomBody({
  messages,
  myProfileId,
  onSend,
  sending,
  onResolve,
  resolving = false,
}: Props) {
  const [text, setText] = useState("");
  const bodyRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 새 메시지 도착 시 스크롤 하단 고정
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // 전송이 끝나면(sending true → false) 입력창 포커스 복원.
  // readOnly 방식이라 대개 유지되지만, 다른 요인으로 빠졌을 때의 보정.
  const prevSendingRef = useRef(sending);
  useEffect(() => {
    if (prevSendingRef.current && !sending) {
      inputRef.current?.focus();
    }
    prevSendingRef.current = sending;
  }, [sending]);

  async function handleSend() {
    const t = text.trim();
    if (!t || sending) return;
    // 전송 시작 시점에 clear + 실패 시 입력 복원
    const snapshot = text;
    setText("");
    try {
      await onSend(t);
    } catch {
      // onSend는 원칙적으로 throw 안 하지만 방어. 실패 시 입력 복원.
      setText(snapshot);
    } finally {
      inputRef.current?.focus();
    }
  }

  async function handleResolveClick() {
    if (!onResolve || resolving) return;
    const ok = window.confirm(
      "이 문의를 완료 처리하시겠습니까?\n\n" +
      "완료 안내가 채팅방에 삽입됩니다. 방은 계속 유지되며 이후에도 대화가 가능합니다. " +
      "완료 처리는 대시보드에서만 취소할 수 있습니다."
    );
    if (!ok) return;
    await onResolve();
  }

  return (
    <>
      <div ref={bodyRef} className={styles.body}>
        {messages.length === 0 ? (
          <div className={styles.emptyHint}>대화 내용이 없습니다.</div>
        ) : null}

        {messages.map((m) => {
          if (m.sender_role === "system") {
            return <SystemDivider key={m.id} createdAt={m.created_at} />;
          }
          const isMine =
            myProfileId !== null && m.sender_profile_id === myProfileId;
          return (
            <div
              key={m.id}
              className={isMine ? styles.rowMe : styles.rowOther}
            >
              <div className={isMine ? styles.bubbleMe : styles.bubbleOther}>
                {m.content}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.inputBar}>
        {onResolve ? (
          <button
            type="button"
            onClick={handleResolveClick}
            disabled={resolving}
            className={styles.resolveButton}
            title="문의 완료 처리"
            // 완료 버튼 클릭으로도 입력 포커스를 잃지 않도록
            onMouseDown={(e: ReactMouseEvent<HTMLButtonElement>) => e.preventDefault()}
          >
            {resolving ? "처리 중" : "완료"}
          </button>
        ) : null}

        <input
          ref={inputRef}
          value={text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
          onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              handleSend();
            }
          }}
          placeholder="메시지를 입력해주십시오"
          maxLength={2000}
          // disabled 대신 readOnly — 포커스를 잃지 않아 연속 입력이 끊기지 않음
          readOnly={sending}
          className={`${styles.input} ${sending ? styles.inputSending : ""}`}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || text.trim().length === 0}
          className={styles.sendButton}
          aria-label="전송"
          // 클릭 시 입력창에서 포커스가 떠나는 것 자체를 차단
          onMouseDown={(e: ReactMouseEvent<HTMLButtonElement>) => e.preventDefault()}
        >
          {/* 종이비행기(전송) 아이콘 — 텍스트 대신 원형 버튼에 맞춤 */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.39 1.15L4.1 11.5 12 12l-7.9.5-2.09 6.75a1 1 0 0 0 1.39 1.15Z" />
          </svg>
        </button>
      </div>
    </>
  );
}