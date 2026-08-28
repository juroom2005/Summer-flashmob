// components/session-chat/ScriptPane.tsx
//
// 방의 "스크립트 스트림"(kind='script') 패널. GM 진행문이 마크다운 카드로 쌓인다.
//   · 유저: 읽기 전용
//   · GM  : 하단 작성기(텍스트/미리보기 토글, Ctrl+Enter 게시) + 카드별 수정·삭제
//
// 스크롤 정책은 ChatPane 과 동일(하단 근처면 따라가고, 아니면 "새 스크립트" 버튼).
// 게시 실패 시 작성 내용을 유지한다(입력 유실 방지).

"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { SessionMessage } from "@/lib/session-chat-helpers";
import MarkdownView from "./MarkdownView";
import TypingScript from "./TypingScript";
import Loader from "./Loader";
import styles from "./Session.module.css";

type Props = {
  roomId:    string;
  messages:  SessionMessage[];     // kind='script' 만
  isGm:      boolean;
  /** 방 최초 조회 중이면 true. 로더 표시. */
  loading:   boolean;
  busy:      boolean;
  error:     string | null;
  onPost?:   (content: string) => Promise<boolean>;
  onEdit?:   (messageId: string, content: string) => Promise<boolean>;
  onDelete?: (messageId: string) => Promise<void>;
};

const NEAR_BOTTOM_PX = 120;
const MAX_LEN = 20000;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function ScriptPane({
  roomId,
  messages,
  isGm,
  loading,
  busy,
  error,
  onPost,
  onEdit,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);

  // 타이핑 대상 판별:
  //   방 진입 시점에 이미 있던 스크립트 id 들(seenRef)은 타이핑하지 않는다.
  //   그 뒤 새로 도착한 "가장 마지막" 스크립트 1개만 타이핑 대상(typingId).
  //   내가(GM) 쓴 것도 새로 도착하면 타이핑됨 — 게시 직후 효과가 자연스럽다.
  const seenRef = useRef<Set<string> | null>(null);
  const [typingId, setTypingId] = useState<string | null>(null);

  useEffect(() => {
    // 방이 바뀌면 판별 기준 초기화. 첫 messages 스냅샷을 "이미 본 것"으로 등록.
    seenRef.current = null;
    setTypingId(null);
  }, [roomId]);

  useEffect(() => {
    // 아직 초기 로딩 중이면 등록을 미룬다.
    // (재진입 시 messages 가 빈 배열로 먼저 왔다가 데이터가 채워지는데,
    //  빈 배열을 "최초 스냅샷"으로 잡으면 뒤늦게 온 스크립트가 새 것으로 오인돼
    //  마지막 스크립트가 다시 타이핑된다. 로딩이 끝난 첫 스냅샷을 기준으로 삼는다.)
    if (loading) return;

    if (seenRef.current === null) {
      // 로딩 완료 후 첫 스냅샷: 전부 본 것으로 등록, 타이핑 없음.
      seenRef.current = new Set(messages.map((m) => m.id));
      return;
    }
    // 새로 등장한 스크립트 찾기(등록 안 된 id).
    const fresh = messages.filter((m) => !seenRef.current!.has(m.id));
    if (fresh.length > 0) {
      for (const m of fresh) seenRef.current!.add(m.id);
      // 여러 개가 한꺼번에 와도 마지막 1개만 타이핑.
      setTypingId(fresh[fresh.length - 1].id);
    }
  }, [messages, loading]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = dist < NEAR_BOTTOM_PX;
    if (nearBottomRef.current) setShowJump(false);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
    setShowJump(false);
  }

  useEffect(() => {
    nearBottomRef.current = true;
    setShowJump(false);
    setDraft("");
    setEditingId(null);
    setPreview(false);
    const id = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(id);
  }, [roomId]);

  const lastId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!lastId) return;
    if (nearBottomRef.current) scrollToBottom();
    else setShowJump(true);
  }, [lastId]);

  const canWrite = isGm && !!onPost;

  async function submit() {
    const t = draft;
    if (!t.trim() || busy) return;
    let ok = false;
    if (editingId && onEdit) {
      ok = await onEdit(editingId, t);
    } else if (onPost) {
      ok = await onPost(t);
    }
    if (ok) {
      setDraft("");
      setEditingId(null);
      setPreview(false);
      nearBottomRef.current = true;
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      void submit();
    }
  }

  function startEdit(m: SessionMessage) {
    setEditingId(m.id);
    setDraft(m.content);
    setPreview(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
    setPreview(false);
  }

  async function handleDelete(m: SessionMessage) {
    if (!onDelete) return;
    const ok = window.confirm("이 스크립트를 삭제하시겠습니까? (기록에서 숨겨집니다)");
    if (!ok) return;
    await onDelete(m.id);
    if (editingId === m.id) cancelEdit();
  }

  return (
    <>
      {loading ? <Loader label="스크립트를 불러오는 중" /> : (
      <div
        ref={scrollRef}
        className={styles.paneScroll}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="GM 스크립트"
      >
        {messages.length === 0 ? (
          <div className={styles.emptyHint}>
            {canWrite ? "아래 작성기에서 첫 스크립트를 게시하세요." : "아직 게시된 스크립트가 없습니다."}
          </div>
        ) : null}

        {messages.map((m) => (
          <article
            key={m.id}
            className={styles.scriptEntry}
            aria-label={`스크립트 ${fmtTime(m.created_at)}`}
          >
            <div className={styles.scriptEntryHead}>
              <span className={`${styles.msgName} ${styles.msgNameGm}`}>GM</span>
              <time dateTime={m.created_at}>{fmtTime(m.created_at)}</time>
              {m.edited_at ? <span>(수정됨)</span> : null}
              {canWrite ? (
                <span className={styles.scriptEntryTools}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSmall}`}
                    onClick={() => startEdit(m)}
                    disabled={busy}
                    aria-label={`스크립트 수정 (${fmtTime(m.created_at)})`}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSmall} ${styles.btnDanger}`}
                    onClick={() => void handleDelete(m)}
                    disabled={busy}
                    aria-label={`스크립트 삭제 (${fmtTime(m.created_at)})`}
                  >
                    삭제
                  </button>
                </span>
              ) : null}
            </div>
            <TypingScript
              content={m.content}
              animate={m.id === typingId}
              onTick={() => {
                if (nearBottomRef.current) scrollToBottom();
              }}
              onDone={() => setTypingId((cur) => (cur === m.id ? null : cur))}
            />
          </article>
        ))}

        {showJump ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSmall} ${styles.btnPrimary} ${styles.jumpBtn}`}
            onClick={scrollToBottom}
          >
            새 스크립트 ↓
          </button>
        ) : null}
      </div>
      )}

      {error ? (
        <div className={styles.alert} role="alert">{error}</div>
      ) : null}

      {canWrite ? (
        <div className={styles.composer}>
          <div className={styles.composerRow}>
            <label htmlFor={`script-draft-${roomId}`} className={styles.composerLabel}>
              {editingId ? "스크립트 수정 중" : "스크립트 작성 (마크다운)"}
            </label>
            <span className="grow" style={{ flex: "1 1 auto" }} />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSmall}`}
              onClick={() => setPreview((v) => !v)}
              aria-pressed={preview}
            >
              {preview ? "편집으로" : "미리보기"}
            </button>
          </div>

          {preview ? (
            <div className={styles.preview} aria-label="미리보기">
              {draft.trim() ? <MarkdownView content={draft} /> : <span className={styles.hint}>내용이 없습니다.</span>}
            </div>
          ) : (
            <textarea
              id={`script-draft-${roomId}`}
              ref={textareaRef}
              className={styles.textarea}
              value={draft}
              maxLength={MAX_LEN}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={"## 장면 1\n선택지:\n1. 문을 연다\n2. 되돌아간다"}
              readOnly={busy}
              aria-busy={busy}
            />
          )}

          <div className={styles.composerRow}>
            <span className={styles.hint}>Ctrl+Enter 로 게시 · {draft.length.toLocaleString()} / {MAX_LEN.toLocaleString()}</span>
            <span className="grow" style={{ flex: "1 1 auto" }} />
            {editingId ? (
              <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={cancelEdit} disabled={busy}>
                수정 취소
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void submit()}
              disabled={busy || draft.trim().length === 0}
            >
              {editingId ? "수정 저장" : "게시"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}