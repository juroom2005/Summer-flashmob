// components/gm/InviteCodeList.tsx
//
// 초대코드 발급 이력 목록 (v2 — 연장 성공 flash 피드백 추가).
//
// 변경점 (v1 → v2):
//   - 연장 성공 시 인라인 flash 메시지 3초 표시 ("✓ +N일 연장됨")
//   - 삭제는 리스트에서 사라지므로 별도 피드백 불필요 (자동 인지)
//
// 조회: RLS 정책 invite_codes_gm_only_select가 GM 세션 SELECT 허용 → 프론트 직접.
// 삭제: delete-invite EF (RPC delete_invite_and_shell 내부 처리)
// 연장: extend-invite EF (max(now, expires_at) + N일)

"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { callEdgeFunction } from "@/lib/ef-client";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

/* ── 타입 ── */

type InviteRow = {
  id:           string;
  code:         string;
  expires_at:   string;
  used:         boolean;
  used_at:      string | null;
  invitee_note: string | null;
  created_at:   string;
  profile: {
    family_name: string | null;
    given_name:  string | null;
  } | null;
};

type Props = {
  refreshKey: number;
};

/* ═══════════════════════════════════════════════════════════
   InviteCodeList — 컨테이너
   ═══════════════════════════════════════════════════════════ */

export default function InviteCodeList({ refreshKey }: Props) {
  const [rows,    setRows]    = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: selErr } = await supabase
        .from("invite_codes")
        .select(`
          id, code, expires_at, used, used_at, invitee_note, created_at,
          profile:profiles!invite_codes_profile_id_fkey (family_name, given_name)
        `)
        .order("created_at", { ascending: false });

      if (selErr) {
        setError(`이력 조회 실패: ${selErr.message}`);
        setRows([]);
        return;
      }

      const normalized: InviteRow[] = (data ?? []).map((r) => ({
        id:           r.id,
        code:         r.code,
        expires_at:   r.expires_at,
        used:         r.used,
        used_at:      r.used_at,
        invitee_note: r.invitee_note,
        created_at:   r.created_at,
        profile: Array.isArray(r.profile) ? (r.profile[0] ?? null) : (r.profile ?? null),
      }));

      setRows(normalized);
    } catch (e) {
      setError(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [refreshKey, load]);

  const handleRowChanged = useCallback(() => {
    load();
  }, [load]);

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={titleStyle}>📋 발급 이력</span>
        <span style={countStyle}>{rows.length}건</span>
        <button
          onClick={load}
          disabled={loading}
          style={reloadButtonStyle}
          aria-label="새로고침"
        >
          {loading ? "..." : "🔄"}
        </button>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      {loading && rows.length === 0 ? (
        <div style={emptyStyle}>불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div style={emptyStyle}>아직 발급된 코드가 없어요.</div>
      ) : (
        <div style={listStyle}>
          {rows.map((row) => (
            <InviteCodeRow
              key={row.id}
              row={row}
              onChanged={handleRowChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   InviteCodeRow — 각 행 (액션·상태 격리)
   ═══════════════════════════════════════════════════════════ */

function InviteCodeRow({
  row,
  onChanged,
}: {
  row:       InviteRow;
  onChanged: () => void;
}) {
  const [extendDays, setExtendDays] = useState<string>("7");
  const [busy,       setBusy]       = useState<"delete" | "extend" | null>(null);
  const [rowError,   setRowError]   = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);
  const [flashMsg,   setFlashMsg]   = useState<string | null>(null);

  // flash 타이머 정리 (언마운트 시 or 다음 flash 시 이전 timer 취소)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  function showFlash(msg: string, durationMs = 3000) {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashMsg(msg);
    flashTimerRef.current = setTimeout(() => {
      setFlashMsg(null);
      flashTimerRef.current = null;
    }, durationMs);
  }

  const now = Date.now();
  const isExpired = new Date(row.expires_at).getTime() < now;
  const isUsed    = row.used;

  const badge = isUsed
    ? { text: "가입 완료", bg: "#c9f2e6", fg: "#1e7d6a", border: "#4db6a0" }
    : isExpired
      ? { text: "만료",     bg: "#e8e8e8", fg: "#666",    border: "#bbb" }
      : { text: "활성",     bg: "#cdeeff", fg: "#0d6fa8", border: "#2ea3dd" };

  const displayName = row.profile
    ? `${row.profile.family_name ?? ""} ${row.profile.given_name ?? ""}`.trim() || "(이름 없음)"
    : "(profile 없음)";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(row.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      console.error("[InviteCodeRow] clipboard failed:", e);
      window.prompt("코드를 복사하세요:", row.code);
    }
  }

  async function handleExtend() {
    setRowError(null);
    const days = parseInt(extendDays, 10);
    if (!Number.isInteger(days) || days < 7 || days > 30) {
      setRowError("연장 일수는 7~30 사이여야 합니다.");
      return;
    }

    setBusy("extend");
    try {
      const result = await callEdgeFunction<{ code: string; expires_at: string }>(
        "extend-invite",
        { code_id: row.id, extend_days: days }
      );

      if (!result.ok) {
        setRowError(
          `연장 실패: ${result.error}${result.detail ? ` (${result.detail})` : ""}`
        );
        setBusy(null);
        return;
      }

      // 성공 flash 표시 (재조회 후에도 유지되도록 onChanged 전에)
      showFlash(`✓ +${days}일 연장됨`);
      setBusy(null);
      onChanged();
    } catch (e) {
      setRowError(String(e));
      setBusy(null);
    }
  }

  async function handleDelete() {
    setRowError(null);

    const confirmMsg = isUsed
      ? `⚠️ 이 코드는 이미 사용됐습니다.\n\n삭제하면 발급 이력이 사라지지만 실제 유저 계정은 유지됩니다.\n(유저는 유저관리 기능에서 별도 삭제)\n\n정말 삭제하시겠습니까?`
      : `이 코드와 대응 shell profile을 함께 삭제합니다.\n계속하시겠습니까?`;

    if (!window.confirm(confirmMsg)) return;

    setBusy("delete");
    try {
      const result = await callEdgeFunction<{ success: boolean }>(
        "delete-invite",
        { code_id: row.id }
      );

      if (!result.ok) {
        setRowError(
          `삭제 실패: ${result.error}${result.detail ? ` (${result.detail})` : ""}`
        );
        setBusy(null);
        return;
      }

      onChanged();
    } catch (e) {
      setRowError(String(e));
      setBusy(null);
    }
  }

  return (
    <div style={{
      ...rowStyle,
      opacity: isExpired && !isUsed ? 0.6 : 1,
      background: isExpired && !isUsed ? "#f2f2f2" : "#fff",
      borderColor: isExpired && !isUsed ? "#d0d0d0" : "#bfe4f7",
    }}>
      {/* 1행: 코드 + 뱃지 + 대상 이름 + 액션 */}
      <div style={rowLine1Style}>
        <div style={codeBoxStyle}>
          <span style={codeTextStyle}>{row.code}</span>
          <button onClick={handleCopy} style={copyButtonStyle} title="복사">
            {copied ? "✓" : "📋"}
          </button>
        </div>

        <span style={{
          ...badgeStyle,
          background:  badge.bg,
          color:       badge.fg,
          borderColor: badge.border,
        }}>
          {badge.text}
        </span>

        {/* flash 성공 메시지 */}
        {flashMsg ? <span style={flashStyle}>{flashMsg}</span> : null}

        <span style={targetNameStyle}>{displayName}</span>

        <div style={actionsStyle}>
          {isUsed ? null : (
            <>
              <select
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
                disabled={busy !== null}
                style={extendSelectStyle}
              >
                <option value="7">7일</option>
                <option value="14">14일</option>
                <option value="21">21일</option>
                <option value="30">30일</option>
              </select>
              <button
                onClick={handleExtend}
                disabled={busy !== null}
                style={extendButtonStyle}
              >
                {busy === "extend" ? "..." : "🔄 연장"}
              </button>
            </>
          )}

          <button
            onClick={handleDelete}
            disabled={busy !== null}
            style={{
              ...deleteButtonStyle,
              borderColor: isUsed ? "#c0392b" : "#e88",
              color:       isUsed ? "#c0392b" : "#c85",
            }}
            title={isUsed ? "⚠️ 사용된 코드 삭제" : "삭제"}
          >
            {busy === "delete" ? "..." : "🗑"}
          </button>
        </div>
      </div>

      {/* 2행: 메타 정보 */}
      <div style={rowLine2Style}>
        {row.invitee_note ? (
          <span style={metaItemStyle}>
            📝 <span style={metaValueStyle}>{row.invitee_note}</span>
          </span>
        ) : null}
        <span style={metaItemStyle}>
          발급 <span style={metaValueStyle}>{formatDate(row.created_at)}</span>
        </span>
        <span style={metaItemStyle}>
          만료 <span style={metaValueStyle}>{formatDate(row.expires_at)}</span>
        </span>
        {isUsed && row.used_at ? (
          <span style={metaItemStyle}>
            사용 <span style={metaValueStyle}>{formatDate(row.used_at)}</span>
          </span>
        ) : null}
      </div>

      {rowError ? <div style={rowErrorStyle}>{rowError}</div> : null}
    </div>
  );
}

/* ── 유틸 ── */

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const m  = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${m}/${dd} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

/* ── 스타일 ── */

const cardStyle: CSSProperties = {
  padding:      "20px 24px",
  background:   "#fff",
  border:       "2px solid #bfe4f7",
  borderRadius: 18,
  boxShadow:    "0 4px 0 rgba(46,163,221,.15)",
};

const headerStyle: CSSProperties = {
  display:       "flex",
  alignItems:    "center",
  gap:           10,
  marginBottom:  16,
  paddingBottom: 12,
  borderBottom:  "2px dashed #d6effc",
};

const titleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   20,
  color:      "#0d6fa8",
};

const countStyle: CSSProperties = {
  fontFamily:   GAEGU,
  fontWeight:   700,
  fontSize:     14,
  color:        "#7fb3d4",
  padding:      "2px 10px",
  background:   "#f4fbff",
  borderRadius: 999,
};

const reloadButtonStyle: CSSProperties = {
  marginLeft:   "auto",
  width:        32,
  height:       32,
  border:       "1.5px solid #bfe4f7",
  borderRadius: 8,
  background:   "#fff",
  cursor:       "pointer",
  fontSize:     14,
};

const errorStyle: CSSProperties = {
  padding:      "10px 14px",
  fontFamily:   BODY,
  fontSize:     13,
  color:        "#c0392b",
  background:   "rgba(192, 57, 43, 0.08)",
  border:       "1.5px solid rgba(192, 57, 43, 0.25)",
  borderRadius: 8,
  marginBottom: 12,
};

const emptyStyle: CSSProperties = {
  padding:    "32px 20px",
  textAlign:  "center",
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   16,
  color:      "#a4c4d8",
};

const listStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           10,
};

const rowStyle: CSSProperties = {
  padding:      "12px 14px",
  border:       "1.5px solid #bfe4f7",
  borderRadius: 12,
  transition:   "background .15s, opacity .15s",
};

const rowLine1Style: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        10,
  flexWrap:   "wrap",
};

const rowLine2Style: CSSProperties = {
  display:    "flex",
  gap:        14,
  flexWrap:   "wrap",
  marginTop:  8,
  paddingTop: 6,
  borderTop:  "1px dashed rgba(0,0,0,0.06)",
};

const codeBoxStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        6,
};

const codeTextStyle: CSSProperties = {
  fontFamily:    "monospace",
  fontSize:      15,
  fontWeight:    700,
  color:         "#0d6fa8",
  letterSpacing: "0.1em",
};

const copyButtonStyle: CSSProperties = {
  width:          26,
  height:         26,
  border:         "1.5px solid #d6effc",
  borderRadius:   6,
  background:     "#f4fbff",
  cursor:         "pointer",
  fontSize:       11,
  display:        "inline-flex",
  alignItems:     "center",
  justifyContent: "center",
};

const badgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     12,
  padding:      "3px 10px",
  border:       "1.5px solid",
  borderRadius: 999,
  whiteSpace:   "nowrap",
};

const flashStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     12,
  color:        "#fff",
  background:   "#4db6a0",
  padding:      "3px 10px",
  borderRadius: 999,
  whiteSpace:   "nowrap",
  animation:    "flashPulse 3s ease-out",
};

const targetNameStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     14,
  fontWeight:   700,
  color:        "#14406f",
  overflow:     "hidden",
  textOverflow: "ellipsis",
  whiteSpace:   "nowrap",
  minWidth:     0,
  flex:         "0 1 auto",
};

const actionsStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        6,
  marginLeft: "auto",
};

const extendSelectStyle: CSSProperties = {
  height:       30,
  padding:      "0 8px",
  border:       "1.5px solid #bfe4f7",
  borderRadius: 8,
  background:   "#f4fbff",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#1e4b6e",
  cursor:       "pointer",
};

const extendButtonStyle: CSSProperties = {
  height:       30,
  padding:      "0 12px",
  border:       "1.5px solid #4db6a0",
  borderRadius: 8,
  background:   "#fff",
  color:        "#1e7d6a",
  fontFamily:   JUA,
  fontSize:     12,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const deleteButtonStyle: CSSProperties = {
  width:        30,
  height:       30,
  border:       "1.5px solid",
  borderRadius: 8,
  background:   "#fff",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
};

const metaItemStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#7fb3d4",
};

const metaValueStyle: CSSProperties = {
  color:      "#14406f",
  fontWeight: 600,
};

const rowErrorStyle: CSSProperties = {
  marginTop:    8,
  padding:      "6px 10px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#c0392b",
  background:   "rgba(192,57,43,.08)",
  border:       "1px solid rgba(192,57,43,.25)",
  borderRadius: 6,
};