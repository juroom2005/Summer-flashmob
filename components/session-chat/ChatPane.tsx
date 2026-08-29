// components/session-chat/ChatPane.tsx
//
// 방의 "채팅 스트림"(chat / roll / system) 패널.
//   · 메시지 로그: role="log" aria-live="polite" — 새 메시지를 보조기기에 알림
//   · 입력바: 텍스트 + 전송, 주사위 2종(1d100 / 성공·실패)
//   · 한글 IME: Enter 전송 시 isComposing 체크
//   · 전송 중엔 disabled 대신 readOnly (포커스 유지 — admin-chat 과 같은 이유)
//   · 스크롤: 하단 근처에 있을 때만 자동 스크롤. 위로 올려둔 상태면
//     "새 메시지" 버튼으로 이동 (읽던 위치를 강제로 잃지 않게)
//   · 이전 기록: 상단 근처 도달 시 자동으로 이전 페이지 로드(onLoadOlder).
//     프리펜드 전후 scrollHeight 차이만큼 scrollTop 을 보정해 화면이 튀지
//     않게 한다(앵커링). 보정은 "가장 오래된 메시지 id 가 바뀐" 렌더에서만
//     소비되므로, 로드 중 하단에 새 메시지가 도착해도 오작동하지 않는다.
//
// 데이터·전송은 부모(SessionRoomView)가 담당. 여기는 표시·입력만.

"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { RollType, SessionMessage } from "@/lib/session-chat-helpers";
import { buildNameColorMap } from "@/lib/session-name-color";
import Loader from "./Loader";
import styles from "./Session.module.css";

type Props = {
  roomId:       string;
  messages:     SessionMessage[];
  myProfileId:  string | null;
  isGm:         boolean;
  /** 방 최초 조회 중이면 true. 로더 표시. */
  loading:      boolean;
  /** false 면 입력·주사위 비활성(닫힌 방 · 토글 OFF · 비멤버). */
  canPost:      boolean;
  /** canPost=false 일 때 입력창 대신 보여줄 안내. */
  readOnlyNote: string | null;
  /** 연결이 불안정할 때 입력창 위에 띄울 경고. null 이면 표시 안 함. */
  staleWarning: string | null;
  /** 아직 안 불러온 이전 채팅이 남았으면 true. */
  hasMore:      boolean;
  /** 이전 페이지 로드 중이면 true (부모 상태). */
  loadingOlder: boolean;
  /** 상단 도달 시 호출. 부모가 fetch·병합·hasMore 갱신을 담당. */
  onLoadOlder:  () => Promise<void>;
  sending:      boolean;
  error:        string | null;
  onSend:       (content: string) => Promise<boolean>;
  onRoll:       (type: RollType) => Promise<void>;
  onDelete?:    (messageId: string) => Promise<void>;
};

const NEAR_BOTTOM_PX = 80;
/** 상단에서 이 거리 안으로 스크롤이 올라오면 이전 페이지를 로드한다. */
const NEAR_TOP_PX = 80;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPane({
  roomId,
  messages,
  myProfileId,
  isGm,
  loading,
  canPost,
  readOnlyNote,
  staleWarning,
  hasMore,
  loadingOlder,
  onLoadOlder,
  sending,
  error,
  onSend,
  onRoll,
  onDelete,
}: Props) {
  const [text, setText] = useState("");
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
  // 프리펜드 앵커: 로드 직전의 scrollHeight/scrollTop 스냅샷.
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  // 이중 발화 방지. 부모 loadingOlder 반영 전의 스크롤 이벤트 연타를 막는다.
  const loadInflightRef = useRef(false);

  /** 이전 페이지 로드 트리거. 앵커 스냅샷을 찍고 부모에 위임. */
  async function triggerLoadOlder() {
    if (loadInflightRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    loadInflightRef.current = true;
    anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    try {
      await onLoadOlder();
    } finally {
      loadInflightRef.current = false;
    }
  }

  // 스크롤 위치 추적 + 상단 근처 자동 로드
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = dist < NEAR_BOTTOM_PX;
    if (nearBottomRef.current) setShowJump(false);

    if (
      el.scrollTop < NEAR_TOP_PX &&
      hasMore &&
      !loadingOlder &&
      !loading &&
      messages.length > 0
    ) {
      void triggerLoadOlder();
    }
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
    setShowJump(false);
  }

  // 방 바뀌면 맨 아래로 (묵은 앵커도 폐기 — 새 방 첫 렌더에서 오소비 방지)
  useEffect(() => {
    anchorRef.current = null;
    nearBottomRef.current = true;
    setShowJump(false);
    const id = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(id);
  }, [roomId]);

  // 프리펜드 앵커 소비: "가장 오래된 메시지"가 바뀐 렌더에서만.
  // (하단 append 는 firstId 가 안 바뀌므로 이 effect 를 건드리지 않는다.)
  const firstId = messages.length ? messages[0].id : null;
  useLayoutEffect(() => {
    const a  = anchorRef.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    anchorRef.current = null;
    el.scrollTop = a.top + (el.scrollHeight - a.height);
  }, [firstId]);

  // 참가자 이름 색맵. 발신자 집합(정렬 후 join)이 바뀔 때만 다시 만든다.
  // roll/system 등 non-user 도 sender_profile_id 가 있으면 포함되지만,
  // 실제 색은 아래에서 GM·본인·시스템을 제외하고만 적용한다.
  const senderKey = messages.map((m) => m.sender_profile_id ?? "").join(",");
  const nameColors = useMemo(
    () => buildNameColorMap(messages.map((m) => m.sender_profile_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [senderKey]
  );

  // 새 메시지: 하단 근처면 따라가고, 아니면 버튼 표시
  const lastId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!lastId) return;
    if (nearBottomRef.current) {
      scrollToBottom();
    } else {
      setShowJump(true);
    }
  }, [lastId]);

  // 전송 끝나면 포커스 복원
  const prevSendingRef = useRef(sending);
  useEffect(() => {
    if (prevSendingRef.current && !sending) inputRef.current?.focus();
    prevSendingRef.current = sending;
  }, [sending]);

  async function handleSend() {
    const t = text.trim();
    if (!t || sending || !canPost) return;
    const snapshot = text;
    setText("");
    const ok = await onSend(t);
    if (!ok) setText(snapshot);
    inputRef.current?.focus();
    nearBottomRef.current = true;
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    void handleSend();
  }

  function keepFocus(e: ReactMouseEvent<HTMLButtonElement>) {
    e.preventDefault();
  }

  async function handleDelete(m: SessionMessage) {
    if (!onDelete) return;
    const ok = window.confirm("이 메시지를 삭제하시겠습니까? (기록에서 숨겨집니다)");
    if (!ok) return;
    await onDelete(m.id);
  }

  return (
    <>
      {loading ? <Loader label="채팅을 불러오는 중" /> : (
      <div
        ref={scrollRef}
        className={styles.paneScroll}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="채팅 메시지"
      >
        {loadingOlder ? (
          <div className={styles.emptyHint} role="status" aria-live="polite">
            이전 대화를 불러오는 중…
          </div>
        ) : !hasMore && messages.length > 0 ? (
          <div className={styles.emptyHint} aria-hidden="true">
            대화의 처음입니다
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div className={styles.emptyHint}>아직 대화가 없습니다.</div>
        ) : null}

        {messages.map((m) => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className={`${styles.msgRow} ${styles.msgRowCenter}`}>
                <span className={styles.system}>
                  {m.content}
                  <span className={styles.srOnly}> ({fmtTime(m.created_at)})</span>
                </span>
              </div>
            );
          }

          if (m.kind === "roll") {
            const meta = m.meta;
            let cls = "";
            // 아이콘은 d100 굴림에만 주사위 하나. coin/dance 는 아이콘 없음.
            const icon = meta?.roll_type === "d100" ? "🎲 " : "";
            if (meta?.roll_type === "coin") {
              cls = meta.result === "success" ? styles.rollSuccess : styles.rollFail;
            } else if (meta?.roll_type === "dance") {
              switch (meta.result) {
                case "critical_success": cls = styles.rollCrit; break;
                case "extreme_success":
                case "hard_success":
                case "success":          cls = styles.rollSuccess; break;
                case "fumble":           cls = styles.rollFumble; break;
                default:                 cls = styles.rollFail; break; // fail
              }
            }
            // 춤추기 결과는 " · " 로 나뉜 세 토막(이름·굴림·판정)을 줄바꿈해서 보여준다.
            // content 원문은 그대로 두고 표시만 분리(로그·검색은 한 줄 유지).
            const isDance = meta?.roll_type === "dance";
            const lines = isDance ? m.content.split(" · ") : [m.content];
            return (
              <div key={m.id} className={`${styles.msgRow} ${styles.msgRowCenter}`}>
                <span className={styles.rollGroup}>
                  <span className={`${styles.roll} ${cls}`}>
                    {icon ? <span aria-hidden="true">{icon}</span> : null}
                    {lines.map((line, i) => (
                      <span key={i} className={isDance ? styles.rollLine : undefined}>{line}</span>
                    ))}
                    <span className={styles.srOnly}> ({fmtTime(m.created_at)})</span>
                  </span>
                  {isGm && onDelete ? (
                    <button
                      type="button"
                      className={styles.delBtn}
                      onClick={() => void handleDelete(m)}
                      aria-label={`주사위 결과 삭제: ${m.content}`}
                      title="삭제"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  ) : null}
                </span>
              </div>
            );
          }

          const isMine  = !!myProfileId && m.sender_profile_id === myProfileId;
          const isGmMsg = m.sender_role === "gm";
          return (
            <article
              key={m.id}
              className={`${styles.msgRow} ${isMine ? styles.msgRowMe : ""}`}
              aria-label={`${m.sender_name || "알 수 없음"} ${fmtTime(m.created_at)}`}
            >
              <div className={styles.msgMeta}>
                <span
                  className={`${styles.msgName} ${isGmMsg ? styles.msgNameGm : ""}`}
                  // GM·본인은 기존 색 유지. 그 외 참가자만 방 단위 색맵 적용.
                  style={
                    isGmMsg || isMine || !m.sender_profile_id
                      ? undefined
                      : { color: nameColors.get(m.sender_profile_id) }
                  }
                >
                  {m.sender_name || "(탈퇴)"}
                </span>
              </div>
              <div className={styles.msgLine}>
                <div
                  className={`${styles.bubble} ${isMine ? styles.bubbleMe : ""} ${
                    isGmMsg && !isMine ? styles.bubbleGm : ""
                  }`}
                >
                  {m.content}
                </div>
                <time className={styles.msgTime} dateTime={m.created_at}>
                  {fmtTime(m.created_at)}
                </time>
                {isGm && onDelete ? (
                  <button
                    type="button"
                    className={styles.delBtn}
                    onClick={() => void handleDelete(m)}
                    aria-label={`메시지 삭제: ${m.content.slice(0, 20)}`}
                    title="삭제"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}

        {showJump ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSmall} ${styles.btnPrimary} ${styles.jumpBtn}`}
            onClick={scrollToBottom}
          >
            새 메시지 ↓
          </button>
        ) : null}
      </div>
      )}

      {error ? (
        <div className={styles.alert} role="alert">{error}</div>
      ) : null}

      {staleWarning ? (
        <div className={styles.staleWarn} role="status" aria-live="polite">
          {staleWarning}
        </div>
      ) : null}

      <div className={styles.chatInputBar}>
        {canPost ? (
          <>
            <div className={styles.diceRow} role="group" aria-label="주사위">
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall}`}
                onMouseDown={keepFocus}
                onClick={() => void onRoll("d100")}
                disabled={sending}
              >
                <span aria-hidden="true">🎲</span> 1d100
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall}`}
                onMouseDown={keepFocus}
                onClick={() => void onRoll("coin")}
                disabled={sending}
              >
                성공/실패
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall}`}
                onMouseDown={keepFocus}
                onClick={() => void onRoll("dance")}
                disabled={sending}
              >
                춤추기
              </button>
            </div>
            <div className={styles.inputRow}>
              <label htmlFor={`chat-input-${roomId}`} className={styles.srOnly}>
                메시지 입력
              </label>
              <input
                id={`chat-input-${roomId}`}
                ref={inputRef}
                className={styles.input}
                type="text"
                value={text}
                maxLength={2000}
                placeholder="메시지를 입력하세요"
                autoComplete="off"
                enterKeyHint="send"
                readOnly={sending}
                aria-busy={sending}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onMouseDown={keepFocus}
                onClick={() => void handleSend()}
                disabled={sending || text.trim().length === 0}
              >
                전송
              </button>
            </div>
          </>
        ) : (
          <div className={styles.readOnlyNote} role="status">
            {readOnlyNote ?? "지금은 발언할 수 없습니다."}
          </div>
        )}
      </div>
    </>
  );
}