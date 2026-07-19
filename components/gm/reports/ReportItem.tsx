// components/gm/reports/ReportItem.tsx
//
// mismatch 문의 개별 카드.
//
// 상태:
//   - 미완료: 상단 노란 좌측 보더, "완료 처리" 버튼 활성
//   - 완료:   상단 초록 좌측 보더, 회색 톤 다운, "완료됨" 배지
//
// UX:
//   - 기본 접힘: 이름·코드·시각·메시지 요약(2줄 클램프)
//   - 펼침: snapshot 전체(나이·성별·학교·학년·스탯 3종) + 메시지 전문
//   - 카드 헤더 영역 클릭 시 펼침 토글
//   - "완료 처리" 버튼은 별도 클릭(pointerdown propagation stop)
//
// 완료 처리:
//   - 낙관적 반영: 부모 onResolved 콜백 즉시 호출 → 부모가 목록에서 낙관 갱신
//   - DB UPDATE 실패 시 부모가 롤백 처리 (여기선 결과만 전달)

"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import type { MismatchReportRow } from "@/lib/auth-helpers";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

const GENDER_LABEL: Record<"male" | "female" | "other", string> = {
  male:   "남",
  female: "여",
  other:  "기타",
};

type Props = {
  report:      MismatchReportRow;
  onResolve:   (reportId: string) => void;   // 완료 버튼 클릭 시
  resolving:   boolean;                       // 완료 처리 중 (버튼 비활성)
};

export default function ReportItem({ report, onResolve, resolving }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isResolved = report.resolved_at !== null;

  const s = report.snapshot;
  const characterName =
    [s.family_name, s.given_name].filter(Boolean).join(" ") || "이름 없음";

  function handleResolveClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (isResolved || resolving) return;
    onResolve(report.id);
  }

  return (
    <div
      style={{
        ...cardStyle,
        borderLeftColor: isResolved ? "#4db6a0" : "#e0a500",
        background:      isResolved ? "#f7fbfa" : "#fff",
        opacity:         isResolved ? 0.75      : 1,
      }}
    >
      {/* 헤더 (클릭 시 펼침 토글) */}
      <div style={headerStyle} onClick={() => setExpanded((v) => !v)}>
        <div style={headerLeftStyle}>
          <span style={nameStyle}>{characterName}</span>
          <span style={codeStyle}>{report.invite_code}</span>
          {isResolved ? (
            <span style={resolvedBadgeStyle}>완료</span>
          ) : null}
        </div>
        <div style={headerRightStyle}>
          <span style={dateStyle}>{formatDateTime(report.created_at)}</span>
          <span style={chevronStyle}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* 메시지 - 접힘 상태에선 2줄 클램프, 펼치면 전체 */}
      <div style={expanded ? messageFullStyle : messageClampStyle}>
        {report.message}
      </div>

      {/* 펼침 콘텐츠 */}
      {expanded ? (
        <>
          <div style={dividerStyle} />

          <div style={snapshotSectionStyle}>
            <div style={snapshotLabelStyle}>당시 등록 정보</div>
            <div style={snapshotGridStyle}>
              <SnapshotItem label="나이"   value={s.age != null ? `${s.age}세` : "-"} />
              <SnapshotItem label="성별"   value={s.gender ? GENDER_LABEL[s.gender] : "-"} />
              <SnapshotItem label="학년"   value={s.grade != null ? `${s.grade}학년` : "-"} />
              <SnapshotItem label="학교"   value={s.school_name ?? "-"} />
              <SnapshotItem label="리듬감" value={String(s.rhythm_stat)} />
              <SnapshotItem label="체력"   value={String(s.physical_stat)} />
              <SnapshotItem label="표현력" value={String(s.expression_stat)} />
            </div>
          </div>

          {isResolved ? (
            <div style={resolvedMetaStyle}>
              완료 처리 시각 {formatDateTime(report.resolved_at ?? "")}
            </div>
          ) : (
            <div style={actionRowStyle}>
              <button
                onClick={handleResolveClick}
                disabled={resolving}
                style={resolveButtonStyle}
              >
                {resolving ? "처리 중..." : "완료 처리"}
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/* ── 서브 컴포넌트 ── */

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={snapshotItemStyle}>
      <span style={snapshotItemLabelStyle}>{label}</span>
      <span style={snapshotItemValueStyle}>{value}</span>
    </div>
  );
}

/* ── 유틸 ── */

function formatDateTime(iso: string): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}.${m}.${day} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

/* ── 스타일 ── */

const cardStyle: CSSProperties = {
  border:       "2px solid #cdeeff",
  borderLeft:   "6px solid",
  borderRadius: 12,
  padding:      "12px 16px",
  boxShadow:    "0 2px 0 rgba(46,163,221,.12)",
  transition:   "background 120ms, opacity 120ms",
};

const headerStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            10,
  cursor:         "pointer",
  userSelect:     "none",
};

const headerLeftStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        10,
  flexWrap:   "wrap",
  minWidth:   0,
};

const headerRightStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
  flexShrink: 0,
};

const nameStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   16,
  color:      "#14406f",
};

const codeStyle: CSSProperties = {
  fontFamily:    "monospace",
  fontSize:      12,
  letterSpacing: "0.08em",
  color:         "#0d6fa8",
  background:    "#eaf6fe",
  border:        "1.5px solid #cdeeff",
  borderRadius:  6,
  padding:       "1px 8px",
};

const resolvedBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     11,
  color:        "#1e7d6a",
  background:   "#d6f2e8",
  border:       "1.5px solid #8fdcc7",
  borderRadius: 999,
  padding:      "1px 9px",
};

const dateStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#7fb3d4",
};

const chevronStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#7fb3d4",
};

const messageClampStyle: CSSProperties = {
  marginTop:            8,
  fontFamily:           BODY,
  fontSize:             14,
  lineHeight:           1.5,
  color:                "#2a5878",
  display:              "-webkit-box",
  WebkitLineClamp:      2,
  WebkitBoxOrient:      "vertical" as const,
  overflow:             "hidden",
  wordBreak:            "break-word",
};

const messageFullStyle: CSSProperties = {
  marginTop:  8,
  fontFamily: BODY,
  fontSize:   14,
  lineHeight: 1.6,
  color:      "#2a5878",
  whiteSpace: "pre-wrap",
  wordBreak:  "break-word",
};

const dividerStyle: CSSProperties = {
  margin:     "12px 0",
  height:     0,
  borderTop:  "1.5px dashed #cdeeff",
};

const snapshotSectionStyle: CSSProperties = {
  marginBottom: 10,
};

const snapshotLabelStyle: CSSProperties = {
  fontFamily:   GAEGU,
  fontWeight:   700,
  fontSize:     13,
  color:        "#2ea3dd",
  marginBottom: 6,
};

const snapshotGridStyle: CSSProperties = {
  display:              "grid",
  gridTemplateColumns:  "repeat(auto-fit, minmax(120px, 1fr))",
  gap:                  "6px 12px",
};

const snapshotItemStyle: CSSProperties = {
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "baseline",
  gap:            8,
  fontFamily:     BODY,
  fontSize:       13,
};

const snapshotItemLabelStyle: CSSProperties = {
  color:    "#7fb3d4",
  fontSize: 12,
};

const snapshotItemValueStyle: CSSProperties = {
  color:      "#14406f",
  fontWeight: 700,
};

const actionRowStyle: CSSProperties = {
  display:        "flex",
  justifyContent: "flex-end",
};

const resolveButtonStyle: CSSProperties = {
  height:       34,
  padding:      "0 16px",
  border:       0,
  borderRadius: 10,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
  boxShadow:    "0 3px 0 #0d6fa8",
};

const resolvedMetaStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#7fb3d4",
  textAlign:  "right",
};