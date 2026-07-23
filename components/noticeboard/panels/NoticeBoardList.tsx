// components/noticeboard/panels/NoticeBoardList.tsx
// ═══════════════════════════════════════════════════════════════════
// 홈 공지사항 리스트 (좌측 상단 · 아코디언)
// ═══════════════════════════════════════════════════════════════════
//
// 구성:
//   [ 카테고리 필터 (전체 · 일정 · 공지 · 기타) ]
//   [ 리스트 스크롤 영역 ]
//     - 각 항목: 카테고리 칩 · 제목 · 날짜 · 펼침 화살표
//     - 클릭 시 본문이 그 자리에서 펼쳐진다 (아코디언)
//
// 접근 정책:
//   RLS 는 익명 포함 전체 SELECT 허용. 로그인 여부와 무관하게 표시된다.
//
// 갱신:
//   마운트 시 로드. GM 이 다른 탭에서 편집한 결과는 새로고침 필요.
//   Realtime 은 후속 과제.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  NOTICE_CATEGORIES,
  NOTICE_CATEGORY_COLOR,
  NOTICE_CATEGORY_LABEL,
  listNotices,
  type Notice,
  type NoticeCategory,
} from "@/lib/notices-helpers";

// ────────────────────────────────────────────────────────────────────
// 폰트
// ────────────────────────────────────────────────────────────────────
const JUA   = "'Jua', sans-serif";
const BODY  = "'Gowun Dodum', sans-serif";

// ────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────
const LIST_MAX_HEIGHT = 260;

type Filter = "all" | NoticeCategory;

// ═══════════════════════════════════════════════════════════════════
// 본체
// ═══════════════════════════════════════════════════════════════════
export default function NoticeBoardList() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<Filter>("all");
  const [openId, setOpenId]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listNotices()
      .then((rows) => {
        if (!cancelled) setNotices(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return notices;
    return notices.filter((n) => n.category === filter);
  }, [notices, filter]);

  return (
    <div style={cardStyle}>
      {/* 헤더 : 제목 + 카테고리 필터 */}
      <div style={headerStyle}>
        <div style={titleStyle}>공지사항</div>
        <FilterBar filter={filter} onChange={setFilter} />
      </div>

      {/* 리스트 */}
      <div style={listContainerStyle}>
        {loading ? (
          <EmptyLine text="불러오는 중입니다." />
        ) : filtered.length === 0 ? (
          <EmptyLine
            text={
              filter === "all"
                ? "등록된 공지가 없습니다."
                : "이 분류에 해당하는 공지가 없습니다."
            }
          />
        ) : (
          <ul style={ulStyle}>
            {filtered.map((n) => (
              <NoticeRow
                key={n.id}
                notice={n}
                open={openId === n.id}
                onToggle={() =>
                  setOpenId((cur) => (cur === n.id ? null : n.id))
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 카테고리 필터 바
// ═══════════════════════════════════════════════════════════════════
function FilterBar({
  filter,
  onChange,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
}) {
  const items: { key: Filter; label: string; color?: { bg: string; fg: string } }[] = [
    { key: "all", label: "전체" },
    ...NOTICE_CATEGORIES.map((c) => ({
      key: c as Filter,
      label: NOTICE_CATEGORY_LABEL[c],
      color: NOTICE_CATEGORY_COLOR[c],
    })),
  ];

  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {items.map((it) => {
        const active = filter === it.key;
        const bg = active ? (it.color?.bg ?? "#cdeeff") : "#fff";
        const fg = active ? (it.color?.fg ?? "#0d6fa8") : "#5a8db8";
        const border = active ? (it.color?.fg ?? "#0d6fa8") : "#e0eff8";
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            style={{
              padding: "3px 12px",
              borderRadius: 999,
              border: `1.5px solid ${border}`,
              background: bg,
              color: fg,
              fontFamily: JUA,
              fontSize: 12,
              cursor: active ? "default" : "pointer",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 아코디언 한 줄
// ═══════════════════════════════════════════════════════════════════
function NoticeRow({
  notice,
  open,
  onToggle,
}: {
  notice: Notice;
  open: boolean;
  onToggle: () => void;
}) {
  const color = NOTICE_CATEGORY_COLOR[notice.category];
  const date = formatDate(notice.createdAt);
  const edited = notice.updatedAt !== notice.createdAt;

  return (
    <li style={rowStyle}>
      <button type="button" onClick={onToggle} style={rowHeaderBtnStyle}>
        <span
          style={{
            fontFamily: JUA,
            fontSize: 12,
            background: color.bg,
            color: color.fg,
            padding: "2px 10px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {NOTICE_CATEGORY_LABEL[notice.category]}
        </span>
        <span
          style={{
            fontFamily: JUA,
            fontSize: 14,
            color: "#1656b8",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            flex: 1,
            textAlign: "left",
          }}
        >
          {notice.title}
        </span>
        <span
          style={{
            fontFamily: BODY,
            fontSize: 11,
            color: "#8fbdd8",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {date}
        </span>
        <span
          style={{
            fontFamily: BODY,
            fontSize: 11,
            color: "#0d6fa8",
            width: 14,
            textAlign: "center",
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
          }}
        >
          ▾
        </span>
      </button>

      {open ? (
        <div style={rowBodyStyle}>
          {edited ? (
            <div
              style={{
                fontFamily: BODY,
                fontSize: 11,
                color: "#8fbdd8",
                marginBottom: 4,
              }}
            >
              (수정됨 · {formatDate(notice.updatedAt)})
            </div>
          ) : null}
          <div
            style={{
              fontFamily: BODY,
              fontSize: 13,
              color: "#1e4b6e",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {notice.body}
          </div>
        </div>
      ) : null}
    </li>
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
        padding: "20px 0",
      }}
    >
      {text}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 유틸 : 날짜 포맷 "M/D"
// ────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ────────────────────────────────────────────────────────────────────
// 스타일
// ────────────────────────────────────────────────────────────────────
const cardStyle: CSSProperties = {
  background: "#fff",
  border: "2px solid #cdeeff",
  borderRadius: 16,
  padding: "14px 16px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 8,
};

const titleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize: 17,
  color: "#0d6fa8",
};

const listContainerStyle: CSSProperties = {
  maxHeight: LIST_MAX_HEIGHT,
  overflowY: "auto",
  background: "#fafdff",
  border: "1.5px solid #e6f2fb",
  borderRadius: 10,
  padding: "6px 8px",
};

const ulStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const rowStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #e6f2fb",
  borderRadius: 8,
};

const rowHeaderBtnStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  border: 0,
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
};

const rowBodyStyle: CSSProperties = {
  padding: "0 14px 12px 14px",
  borderTop: "1px dashed #e6f2fb",
  paddingTop: 8,
};