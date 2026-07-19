// components/gm/reports/ReportList.tsx
//
// mismatch 문의 리스트 컨테이너.
//
// 역할:
//   - 마운트 시 미완료 문의 조회
//   - "완료된 문의 포함" 토글 시 재조회
//   - ReportItem에서 올라오는 완료 처리 요청을 낙관적 반영 + DB UPDATE
//   - 완료 처리 실패 시 원상 복구 + 안내 배너
//
// 규칙:
//   - 개별 카드 UI는 ReportItem 담당 (파일 분리)
//   - DB 접근 로직은 auth-helpers 헬퍼 경유 (직접 supabase 호출 안 함)

"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  listMismatchReports,
  markReportResolved,
  type MismatchReportRow,
} from "@/lib/auth-helpers";
import ReportItem from "./ReportItem";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

export default function ReportList() {
  const [reports,          setReports]          = useState<MismatchReportRow[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [includeResolved,  setIncludeResolved]  = useState(false);
  const [resolvingIds,     setResolvingIds]     = useState<Set<string>>(new Set());
  const [errorMessage,     setErrorMessage]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await listMismatchReports(includeResolved);
    setReports(rows);
    setLoading(false);
  }, [includeResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 완료 처리.
   * 낙관적 반영: 해당 행의 resolved_at을 현재 시각으로 즉시 갱신.
   * DB 실패 시 원본 상태로 롤백 + 안내.
   */
  const handleResolve = useCallback(async (reportId: string) => {
    const original = reports.find((r) => r.id === reportId);
    if (!original || original.resolved_at) return;

    setErrorMessage(null);
    setResolvingIds((prev) => new Set(prev).add(reportId));

    // 낙관적 반영
    const nowIso = new Date().toISOString();
    setReports((prev) =>
      prev.map((r) =>
        r.id === reportId ? { ...r, resolved_at: nowIso } : r
      )
    );

    const res = await markReportResolved(reportId);

    setResolvingIds((prev) => {
      const next = new Set(prev);
      next.delete(reportId);
      return next;
    });

    if (!res.ok) {
      // 롤백
      setReports((prev) =>
        prev.map((r) =>
          r.id === reportId ? { ...r, resolved_at: original.resolved_at } : r
        )
      );
      setErrorMessage("완료 처리에 실패했습니다. 잠시 후 다시 시도해주십시오.");
      return;
    }

    // 미완료만 보는 필터라면 완료된 행은 목록에서 제거
    if (!includeResolved) {
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    }
  }, [reports, includeResolved]);

  return (
    <div style={containerStyle}>
      {/* 상단 컨트롤 */}
      <div style={controlBarStyle}>
        <div style={countLabelStyle}>
          {loading
            ? "불러오는 중..."
            : includeResolved
              ? `전체 ${reports.length}건`
              : `미완료 ${reports.length}건`}
        </div>
        <label style={toggleLabelStyle}>
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          완료된 문의도 표시
        </label>
      </div>

      {/* 에러 배너 */}
      {errorMessage ? (
        <div style={errorStyle}>
          <span style={{ flex: 1 }}>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            style={errorCloseStyle}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* 리스트 */}
      {loading ? null : reports.length === 0 ? (
        <div style={emptyStyle}>
          {includeResolved
            ? "접수된 문의가 없습니다."
            : "미완료 문의가 없습니다."}
        </div>
      ) : (
        <div style={listStyle}>
          {reports.map((r) => (
            <ReportItem
              key={r.id}
              report={r}
              onResolve={handleResolve}
              resolving={resolvingIds.has(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 스타일 ── */

const containerStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           14,
};

const controlBarStyle: CSSProperties = {
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "center",
  gap:            12,
  padding:        "10px 14px",
  background:     "#fff",
  border:         "2px solid #bfe4f7",
  borderRadius:   12,
  boxShadow:      "0 2px 0 rgba(46,163,221,.15)",
  flexWrap:       "wrap",
};

const countLabelStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   14,
  color:      "#0d6fa8",
};

const toggleLabelStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     13,
  color:        "#2a5878",
  display:      "flex",
  alignItems:   "center",
  cursor:       "pointer",
  userSelect:   "none",
};

const errorStyle: CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          8,
  padding:      "10px 14px",
  background:   "rgba(192, 57, 43, 0.08)",
  border:       "1.5px solid rgba(192, 57, 43, 0.25)",
  borderRadius: 10,
  fontFamily:   BODY,
  fontSize:     13,
  color:        "#c0392b",
};

const errorCloseStyle: CSSProperties = {
  border:     0,
  background: "transparent",
  color:      "#c0392b",
  fontFamily: JUA,
  fontSize:   13,
  cursor:     "pointer",
};

const emptyStyle: CSSProperties = {
  padding:      "28px 20px",
  textAlign:    "center",
  background:   "#fff",
  border:       "2px dashed #cdeeff",
  borderRadius: 12,
  fontFamily:   GAEGU,
  fontWeight:   700,
  fontSize:     15,
  color:        "#7fb3d4",
};

const listStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           10,
};