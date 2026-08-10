// components/gm/events/GmEventsTab.tsx
// ═══════════════════════════════════════════════════════════════════
// GM 관리 페이지 · 공용 일정 관리 탭
// ═══════════════════════════════════════════════════════════════════
//
// community_events CRUD. 여기서 등록한 일정은 모든 유저의 마이패널
// 달력에 표시된다.
//
// 구성:
//   [ 새 일정 작성 폼 ]  날짜 · 아이콘 · 제목 · (선택)내용
//   [ 기존 일정 리스트 ] 월별 그룹, 날짜순. 편집(인라인)/삭제.
//
// 26년 한 해로 고정 (CALENDAR_YEAR). 날짜 input 의 min/max 로 범위 제한.
// RLS 가 최종 방어. 프론트에서 GM 판정 실패해도 서버가 거부한다.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CALENDAR_YEAR,
  DEFAULT_EVENT_ICON,
  MAX_EVENT_TITLE_LEN,
  MAX_EVENT_BODY_LEN,
  MAX_EVENT_ICON_LEN,
  createCommunityEvent,
  deleteCommunityEvent,
  listCommunityEventsByYear,
  updateCommunityEvent,
  type CommunityEvent,
  type CommunityEventInput,
} from "@/lib/community-events-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

// 자주 쓰는 아이콘 프리셋 (클릭 선택). 직접 입력도 가능.
const ICON_PRESET = ["📌", "📣", "🎤", "🕺", "📷", "🎯", "⏰", "🎉", "📝", "🎬"];

const DATE_MIN = `${CALENDAR_YEAR}-01-01`;
const DATE_MAX = `${CALENDAR_YEAR}-12-31`;

// ═══════════════════════════════════════════════════════════════════
// 본체
// ═══════════════════════════════════════════════════════════════════
export default function GmEventsTab() {
  const [events, setEvents]       = useState<CommunityEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice]       = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listCommunityEventsByYear(CALENDAR_YEAR);
      setEvents(rows);
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
      {/* 새 일정 작성 폼 (편집 중이 아닐 때만) */}
      {editingId === null ? (
        <EventForm
          key="new"
          mode="create"
          onSuccess={async (msg) => {
            showNotice(msg);
            await reload();
          }}
          onError={showNotice}
        />
      ) : null}

      {notice ? <div style={noticeBarStyle}>{notice}</div> : null}

      <div style={listHeaderStyle}>
        <div style={{ fontFamily: JUA, fontSize: 16, color: "#0d6fa8" }}>
          {CALENDAR_YEAR}년 공용 일정
        </div>
        <div style={{ fontFamily: BODY, fontSize: 12, color: "#5a8db8" }}>
          {loading ? "불러오는 중" : `${events.length}개`}
        </div>
      </div>

      <div style={listStyle}>
        {loading ? (
          <EmptyLine text="불러오는 중입니다." />
        ) : events.length === 0 ? (
          <EmptyLine text="등록된 일정이 없습니다." />
        ) : (
          events.map((ev) =>
            editingId === ev.id ? (
              <EventForm
                key={ev.id}
                mode="edit"
                initial={ev}
                onCancel={() => setEditingId(null)}
                onSuccess={async (msg) => {
                  showNotice(msg);
                  setEditingId(null);
                  await reload();
                }}
                onError={showNotice}
              />
            ) : (
              <EventItem
                key={ev.id}
                event={ev}
                onEdit={() => setEditingId(ev.id)}
                onDelete={async () => {
                  if (!window.confirm(`"${ev.title}"\n일정을 삭제하시겠습니까?`)) return;
                  const r = await deleteCommunityEvent(ev.id);
                  if (r.ok) {
                    showNotice("일정이 삭제되었습니다.");
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
// 서브 : 일정 작성/편집 폼
// ═══════════════════════════════════════════════════════════════════
type FormProps =
  | {
      mode: "create";
      onSuccess: (msg: string) => void;
      onError: (msg: string) => void;
    }
  | {
      mode: "edit";
      initial: CommunityEvent;
      onCancel: () => void;
      onSuccess: (msg: string) => void;
      onError: (msg: string) => void;
    };

function EventForm(props: FormProps) {
  const initial = props.mode === "edit" ? props.initial : null;

  const [eventDate, setEventDate] = useState<string>(initial?.eventDate ?? DATE_MIN);
  const [icon, setIcon]           = useState<string>(initial?.icon ?? DEFAULT_EVENT_ICON);
  const [title, setTitle]         = useState<string>(initial?.title ?? "");
  const [body, setBody]           = useState<string>(initial?.body ?? "");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    !submitting &&
    eventDate.length > 0 &&
    icon.trim().length > 0 &&
    title.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    const input: CommunityEventInput = { eventDate, icon, title, body };
    const r = props.mode === "create"
      ? await createCommunityEvent(input)
      : await updateCommunityEvent(props.initial.id, input);

    setSubmitting(false);

    if (r.ok) {
      if (props.mode === "create") {
        setEventDate(DATE_MIN);
        setIcon(DEFAULT_EVENT_ICON);
        setTitle("");
        setBody("");
      }
      props.onSuccess(props.mode === "create" ? "일정이 등록되었습니다." : "일정이 수정되었습니다.");
    } else {
      props.onError(r.message);
    }
  };

  return (
    <div style={formCardStyle}>
      <div style={formHeaderStyle}>
        <div style={{ fontFamily: JUA, fontSize: 15, color: "#0d6fa8" }}>
          {props.mode === "create" ? "새 일정 작성" : "일정 수정"}
        </div>
        {props.mode === "edit" ? (
          <button type="button" onClick={props.onCancel} style={ghostBtnStyle}>
            취소
          </button>
        ) : null}
      </div>

      {/* 날짜 + 아이콘 한 줄 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="date"
          value={eventDate}
          min={DATE_MIN}
          max={DATE_MAX}
          onChange={(e) => setEventDate(e.target.value)}
          disabled={submitting}
          style={dateInputStyle}
        />
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value.slice(0, MAX_EVENT_ICON_LEN))}
          maxLength={MAX_EVENT_ICON_LEN}
          disabled={submitting}
          aria-label="아이콘"
          style={iconInputStyle}
        />
      </div>

      {/* 아이콘 프리셋 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {ICON_PRESET.map((p) => {
          const active = p === icon;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setIcon(p)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                border: active ? "2px solid #1a9edb" : "2px solid #e0eff8",
                background: active ? "#eaf7fe" : "#fff",
                fontSize: 17,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              {p}
            </button>
          );
        })}
      </div>

      {/* 제목 */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, MAX_EVENT_TITLE_LEN))}
        placeholder="일정 제목"
        maxLength={MAX_EVENT_TITLE_LEN}
        disabled={submitting}
        style={inputStyle}
      />

      {/* 내용 (선택) */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_EVENT_BODY_LEN))}
        placeholder="내용 (선택)"
        maxLength={MAX_EVENT_BODY_LEN}
        rows={4}
        disabled={submitting}
        style={textareaStyle}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <div style={{ fontFamily: BODY, fontSize: 11, color: "#8fbdd8" }}>
          {title.length} / {MAX_EVENT_TITLE_LEN} · 내용 {body.length} / {MAX_EVENT_BODY_LEN}
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
// 서브 : 일정 리스트 항목
// ═══════════════════════════════════════════════════════════════════
function EventItem({
  event,
  onEdit,
  onDelete,
}: {
  event: CommunityEvent;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const label = useMemo(() => formatEventDate(event.eventDate), [event.eventDate]);

  return (
    <div style={itemStyle}>
      <div style={itemHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span style={dateChipStyle}>{label}</span>
          <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }}>{event.icon}</span>
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
            {event.title}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <button type="button" onClick={onEdit} style={ghostBtnStyle}>편집</button>
          <button type="button" onClick={onDelete} style={dangerBtnStyle}>삭제</button>
        </div>
      </div>
      {event.body ? (
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
          {event.body}
        </div>
      ) : null}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: BODY, fontSize: 13, color: "#a4b6cc", textAlign: "center", padding: "24px 0" }}>
      {text}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 유틸 : "YYYY-MM-DD" → "M월 D일 (요일)"
// ────────────────────────────────────────────────────────────────────
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function formatEventDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  const dow = DOW[dt.getDay()] ?? "";
  return `${m}월 ${d}일 (${dow})`;
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

const dateInputStyle: CSSProperties = {
  height: 40,
  border: "2px solid #bfe4f7",
  borderRadius: 10,
  padding: "0 12px",
  fontFamily: BODY,
  fontSize: 14,
  color: "#1e4b6e",
  outline: "none",
  background: "#fff",
};

const iconInputStyle: CSSProperties = {
  width: 64,
  height: 40,
  border: "2px solid #bfe4f7",
  borderRadius: 10,
  padding: "0 10px",
  fontFamily: BODY,
  fontSize: 18,
  textAlign: "center",
  color: "#1e4b6e",
  outline: "none",
  background: "#fff",
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

const dateChipStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize: 12,
  background: "#cdeeff",
  color: "#0d6fa8",
  padding: "2px 10px",
  borderRadius: 999,
  whiteSpace: "nowrap",
  flexShrink: 0,
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