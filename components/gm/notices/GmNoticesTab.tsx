// components/gm/notices/GmNoticesTab.tsx
// ═══════════════════════════════════════════════════════════════════
// GM 관리 페이지 · 공지 게시판 관리 탭
// ═══════════════════════════════════════════════════════════════════
//
// 구성:
//   [ 새 공지 작성 폼 ]
//     - 카테고리 선택 (일정 · 공지 · 기타)
//     - 제목 input (100자)
//     - 본문 textarea (5000자)
//     - 저장 버튼
//   [ 기존 공지 리스트 ]
//     - 최신순
//     - 카테고리 칩 · 제목 · 날짜 · 편집/삭제
//     - 편집은 인라인 (해당 항목이 폼으로 변환됨)
//     - 삭제는 window.confirm 확인 후 실행
//
// RLS 가 최종 방어. 프론트에서 GM 판정 실패해도 서버가 거부한다.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  NOTICE_CATEGORIES,
  NOTICE_CATEGORY_COLOR,
  NOTICE_CATEGORY_LABEL,
  createNotice,
  deleteNotice,
  listNotices,
  updateNotice,
  type Notice,
  type NoticeCategory,
  type NoticeInput,
} from "@/lib/notices-helpers";

// ────────────────────────────────────────────────────────────────────
// 폰트
// ────────────────────────────────────────────────────────────────────
const JUA   = "'Jua', sans-serif";
const BODY  = "'Gowun Dodum', sans-serif";

// ────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────
const MAX_TITLE_LEN = 100;
const MAX_BODY_LEN  = 5000;

// ═══════════════════════════════════════════════════════════════════
// 본체
// ═══════════════════════════════════════════════════════════════════
export default function GmNoticesTab() {
  const [notices, setNotices]         = useState<Notice[]>([]);
  const [loading, setLoading]         = useState(true);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [notice, setNotice]           = useState<string | null>(null); // 사용자 안내 문구

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listNotices();
      setNotices(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 3200);
  }, []);

  return (
    <div style={containerStyle}>
      {/* 새 공지 작성 폼 (편집 중이 아닐 때만 노출) */}
      {editingId === null ? (
        <NoticeForm
          key="new"
          mode="create"
          onSuccess={async (msg) => {
            showNotice(msg);
            await reload();
          }}
          onError={showNotice}
        />
      ) : null}

      {/* 안내 문구 */}
      {notice ? <div style={noticeBarStyle}>{notice}</div> : null}

      {/* 리스트 헤더 */}
      <div style={listHeaderStyle}>
        <div style={{ fontFamily: JUA, fontSize: 16, color: "#0d6fa8" }}>공지 목록</div>
        <div style={{ fontFamily: BODY, fontSize: 12, color: "#5a8db8" }}>
          {loading ? "불러오는 중" : `${notices.length}개`}
        </div>
      </div>

      {/* 리스트 */}
      <div style={listStyle}>
        {loading ? (
          <EmptyLine text="불러오는 중입니다." />
        ) : notices.length === 0 ? (
          <EmptyLine text="등록된 공지가 없습니다." />
        ) : (
          notices.map((n) =>
            editingId === n.id ? (
              <NoticeForm
                key={n.id}
                mode="edit"
                initial={n}
                onCancel={() => setEditingId(null)}
                onSuccess={async (msg) => {
                  showNotice(msg);
                  setEditingId(null);
                  await reload();
                }}
                onError={showNotice}
              />
            ) : (
              <NoticeItem
                key={n.id}
                notice={n}
                onEdit={() => setEditingId(n.id)}
                onDelete={async () => {
                  if (!window.confirm(`"${n.title}"\n공지를 삭제하시겠습니까?`)) return;
                  const r = await deleteNotice(n.id);
                  if (r.ok) {
                    showNotice("공지가 삭제되었습니다.");
                    await reload();
                  } else {
                    showNotice(r.message);
                  }
                }}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 공지 작성/편집 폼
// ═══════════════════════════════════════════════════════════════════
type FormProps =
  | {
      mode: "create";
      onSuccess: (msg: string) => void;
      onError: (msg: string) => void;
    }
  | {
      mode: "edit";
      initial: Notice;
      onCancel: () => void;
      onSuccess: (msg: string) => void;
      onError: (msg: string) => void;
    };

function NoticeForm(props: FormProps) {
  const initial = props.mode === "edit" ? props.initial : null;

  const [category, setCategory] = useState<NoticeCategory>(initial?.category ?? "notice");
  const [title, setTitle]       = useState<string>(initial?.title ?? "");
  const [body, setBody]         = useState<string>(initial?.body ?? "");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    !submitting &&
    title.trim().length > 0 &&
    body.trim().length  > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    const input: NoticeInput = { category, title, body };
    const r = props.mode === "create"
      ? await createNotice(input)
      : await updateNotice(props.initial.id, input);

    setSubmitting(false);

    if (r.ok) {
      if (props.mode === "create") {
        setTitle("");
        setBody("");
        setCategory("notice");
      }
      props.onSuccess(props.mode === "create" ? "공지가 등록되었습니다." : "공지가 수정되었습니다.");
    } else {
      props.onError(r.message);
    }
  };

  return (
    <div style={formCardStyle}>
      <div style={formHeaderStyle}>
        <div style={{ fontFamily: JUA, fontSize: 15, color: "#0d6fa8" }}>
          {props.mode === "create" ? "새 공지 작성" : "공지 수정"}
        </div>
        {props.mode === "edit" ? (
          <button type="button" onClick={props.onCancel} style={ghostBtnStyle}>
            취소
          </button>
        ) : null}
      </div>

      {/* 카테고리 선택 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {NOTICE_CATEGORIES.map((c) => {
          const active = c === category;
          const color = NOTICE_CATEGORY_COLOR[c];
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              style={{
                padding: "5px 14px",
                borderRadius: 999,
                border: active ? `2px solid ${color.fg}` : "2px solid #e0eff8",
                background: active ? color.bg : "#fff",
                color: active ? color.fg : "#5a8db8",
                fontFamily: JUA,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {NOTICE_CATEGORY_LABEL[c]}
            </button>
          );
        })}
      </div>

      {/* 제목 */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_LEN))}
        placeholder="제목"
        maxLength={MAX_TITLE_LEN}
        disabled={submitting}
        style={inputStyle}
      />

      {/* 본문 */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LEN))}
        placeholder="내용"
        maxLength={MAX_BODY_LEN}
        rows={6}
        disabled={submitting}
        style={textareaStyle}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <div style={{ fontFamily: BODY, fontSize: 11, color: "#8fbdd8" }}>
          {title.length} / {MAX_TITLE_LEN} · {body.length} / {MAX_BODY_LEN}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            ...primaryBtnStyle,
            opacity: canSubmit ? 1 : 0.55,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "처리 중" : props.mode === "create" ? "등록" : "저장"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 공지 리스트 항목 (편집 아님 상태)
// ═══════════════════════════════════════════════════════════════════
function NoticeItem({
  notice,
  onEdit,
  onDelete,
}: {
  notice: Notice;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = NOTICE_CATEGORY_COLOR[notice.category];
  const date = formatDate(notice.createdAt);
  const edited = notice.updatedAt !== notice.createdAt;

  return (
    <div style={itemStyle}>
      <div style={itemHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontFamily: JUA,
              fontSize: 12,
              background: color.bg,
              color: color.fg,
              padding: "2px 10px",
              borderRadius: 999,
              whiteSpace: "nowrap",
            }}
          >
            {NOTICE_CATEGORY_LABEL[notice.category]}
          </span>
          <div
            style={{
              fontFamily: JUA,
              fontSize: 15,
              color: "#1656b8",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
              flex: 1,
            }}
          >
            {notice.title}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <div style={{ fontFamily: BODY, fontSize: 12, color: "#8fbdd8" }}>
            {date}{edited ? " (수정됨)" : ""}
          </div>
          <button type="button" onClick={onEdit} style={ghostBtnStyle}>편집</button>
          <button type="button" onClick={onDelete} style={dangerBtnStyle}>삭제</button>
        </div>
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontSize: 13,
          color: "#1e4b6e",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          marginTop: 6,
        }}
      >
        {notice.body}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 빈 상태 라인
// ═══════════════════════════════════════════════════════════════════
function EmptyLine({ text }: { text: string }) {
  return (
    <div
      style={{
        fontFamily: BODY,
        fontSize: 13,
        color: "#a4b6cc",
        textAlign: "center",
        padding: "24px 0",
      }}
    >
      {text}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 유틸 : 날짜 포맷 "YYYY.MM.DD"
// ────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

// ────────────────────────────────────────────────────────────────────
// 스타일
// ────────────────────────────────────────────────────────────────────
const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const formCardStyle: CSSProperties = {
  background: "#fff",
  border: "2px solid #cdeeff",
  borderRadius: 14,
  padding: "16px 18px",
};

const formHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 40,
  border: "2px solid #bfe4f7",
  borderRadius: 10,
  padding: "0 12px",
  fontFamily: BODY,
  fontSize: 14,
  color: "#1e4b6e",
  outline: "none",
  background: "#fff",
  marginBottom: 8,
};

const textareaStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "2px solid #bfe4f7",
  borderRadius: 10,
  padding: "10px 12px",
  fontFamily: BODY,
  fontSize: 14,
  color: "#1e4b6e",
  outline: "none",
  background: "#fff",
  resize: "vertical",
  lineHeight: 1.5,
};

const primaryBtnStyle: CSSProperties = {
  minWidth: 84,
  height: 36,
  padding: "0 18px",
  border: 0,
  borderRadius: 10,
  background: "#1a9edb",
  color: "#fff",
  fontFamily: JUA,
  fontSize: 14,
  boxShadow: "0 3px 0 #0d6fa8",
};

const ghostBtnStyle: CSSProperties = {
  height: 28,
  padding: "0 12px",
  border: "1.5px solid #bfe4f7",
  borderRadius: 8,
  background: "#fff",
  color: "#0d6fa8",
  fontFamily: JUA,
  fontSize: 12,
  cursor: "pointer",
};

const dangerBtnStyle: CSSProperties = {
  height: 28,
  padding: "0 12px",
  border: "1.5px solid #f4c9c9",
  borderRadius: 8,
  background: "#fff",
  color: "#c94a4a",
  fontFamily: JUA,
  fontSize: 12,
  cursor: "pointer",
};

const noticeBarStyle: CSSProperties = {
  padding: "10px 14px",
  background: "#fff8d1",
  border: "1.5px solid #f2e3a1",
  borderRadius: 10,
  fontFamily: BODY,
  fontSize: 13,
  color: "#7a6510",
};

const listHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  paddingBottom: 6,
  borderBottom: "1.5px dashed #cdeeff",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const itemStyle: CSSProperties = {
  background: "#fff",
  border: "1.5px solid #e0eff8",
  borderRadius: 12,
  padding: "12px 14px",
};

const itemHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};