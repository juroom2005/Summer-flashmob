// components/gm/session/GmSessionTab.tsx
// ═══════════════════════════════════════════════════════════════════
// GM 관리 페이지 · 세션 채팅 탭
// ═══════════════════════════════════════════════════════════════════
//
// 구성:
//   [ 노출 토글 ]  site_settings.session_chat_enabled — 홈 화면 입장 버튼 노출 +
//                  유저 발언 허용. GM 은 토글과 무관하게 /session 이용 가능.
//   [ 방 만들기 ]  이름 + 참가 유저 체크(가입 완료·활성 유저만 표시)
//   [ 방 목록 ]    열기/닫기 · 멤버 편집(교체) · 이름 변경 · 보관/복구 · 방으로 이동
//
// 사고 방지:
//   · 삭제 없음(보관만). 보관해도 기록은 남고 복구 가능.
//   · 멤버 편집은 "저장" 누를 때만 서버 반영. 편집 중 취소 가능.
//   · 모든 쓰기는 session_gm_* RPC (assert_caller_is_gm). 프론트는 노출 차단만.
//
// 접근성:
//   · 토글은 role="switch" aria-checked
//   · 체크박스는 <label> 로 감싸 클릭 영역·라벨 결합
//   · 결과 메시지는 role="status"/"alert"
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { listGmUsers, type GmUserRow } from "@/lib/gm-user-helpers";
import {
  getSessionChatEnabled,
  gmCreateSessionRoom,
  gmSetSessionChatEnabled,
  gmSetSessionRoomArchived,
  gmSetSessionRoomMembers,
  gmUpdateSessionRoom,
  listSessionRooms,
  type SessionRoom,
} from "@/lib/session-chat-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

function displayName(u: GmUserRow): string {
  const n = `${u.family_name ?? ""} ${u.given_name ?? ""}`.trim();
  return n || u.email || "(이름 없음)";
}

type MemberPickerProps = {
  users:    GmUserRow[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  idPrefix: string;
};

/** 참가 유저 체크 목록. 컴포넌트 밖에 두어 리렌더 시 포커스가 끊기지 않게 한다. */
function MemberPicker({ users, selected, onChange, idPrefix }: MemberPickerProps) {
  if (users.length === 0) {
    return <div style={emptyStyle}>선택할 수 있는 유저가 없습니다.</div>;
  }
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>참가 유저 ({selected.size}명 선택)</legend>
      <div style={pickerGridStyle}>
        {users.map((u) => {
          const id = `${idPrefix}-${u.id}`;
          const checked = selected.has(u.id);
          return (
            <label key={u.id} htmlFor={id} style={{ ...pickStyle, ...(checked ? pickActiveStyle : null) }}>
              <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(u.id); else next.delete(u.id);
                  onChange(next);
                }}
              />
              <span>{displayName(u)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function GmSessionTab() {
  const [enabled, setEnabled] = useState(false);
  const [enabledBusy, setEnabledBusy] = useState(false);

  const [users, setUsers] = useState<GmUserRow[]>([]);
  const [rooms, setRooms] = useState<SessionRoom[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editMembers, setEditMembers] = useState<Set<string>>(new Set());
  const [editName, setEditName] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const eligibleUsers = useMemo(
    () => users.filter((u) => !u.is_gm && u.is_registered && !u.deactivated_at),
    [users]
  );

  const refresh = useCallback(async () => {
    const [on, us, rs] = await Promise.all([
      getSessionChatEnabled(),
      listGmUsers(false),
      listSessionRooms(true),
    ]);
    setEnabled(on);
    setUsers(us);
    setRooms(rs);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function report(kind: "ok" | "err", text: string) {
    setStatus({ kind, text });
  }

  /* ── 토글 ── */
  async function toggleEnabled() {
    if (enabledBusy) return;
    const next = !enabled;
    if (!next) {
      const ok = window.confirm("세션 채팅 노출을 끄시겠습니까?\n\n유저 화면에서 입장 버튼이 사라지고, 유저의 발언·주사위가 막힙니다. (기록은 유지)");
      if (!ok) return;
    }
    setEnabledBusy(true);
    const res = await gmSetSessionChatEnabled(next);
    setEnabledBusy(false);
    if (!res.ok) { report("err", res.message); return; }
    setEnabled(res.data);
    report("ok", res.data ? "세션 채팅을 유저에게 노출합니다." : "세션 채팅 노출을 껐습니다.");
  }

  /* ── 방 생성 ── */
  async function createRoom() {
    const name = newName.trim();
    if (!name) { report("err", "방 이름을 입력해주십시오."); return; }
    if (newMembers.size === 0) {
      const ok = window.confirm("참가 유저가 없는 방입니다. 그래도 만드시겠습니까? (나중에 멤버 편집 가능)");
      if (!ok) return;
    }
    setCreating(true);
    const res = await gmCreateSessionRoom(name, Array.from(newMembers));
    setCreating(false);
    if (!res.ok) { report("err", res.message); return; }
    setNewName("");
    setNewMembers(new Set());
    report("ok", `방 "${name}" 을(를) 만들었습니다.`);
    await refresh();
  }

  /* ── 멤버 편집 ── */
  function startEdit(r: SessionRoom) {
    setEditingRoomId(r.id);
    setEditName(r.name);
    setEditMembers(new Set(r.members.map((m) => m.profile_id)));
  }
  function cancelEdit() {
    setEditingRoomId(null);
    setEditMembers(new Set());
    setEditName("");
  }
  async function saveEdit(r: SessionRoom) {
    const name = editName.trim();
    if (!name) { report("err", "방 이름을 입력해주십시오."); return; }
    setRowBusy(r.id);
    let failed: string | null = null;
    if (name !== r.name) {
      const res = await gmUpdateSessionRoom(r.id, { name });
      if (!res.ok) failed = res.message;
    }
    if (!failed) {
      const res = await gmSetSessionRoomMembers(r.id, Array.from(editMembers));
      if (!res.ok) failed = res.message;
    }
    setRowBusy(null);
    if (failed) { report("err", failed); return; }
    report("ok", `"${name}" 방 설정을 저장했습니다.`);
    cancelEdit();
    await refresh();
  }

  /* ── 열기/닫기 · 보관 ── */
  async function toggleOpen(r: SessionRoom) {
    setRowBusy(r.id);
    const res = await gmUpdateSessionRoom(r.id, { isOpen: !r.is_open });
    setRowBusy(null);
    if (!res.ok) { report("err", res.message); return; }
    report("ok", `"${r.name}" 방을 ${r.is_open ? "닫았" : "열었"}습니다.`);
    await refresh();
  }
  async function toggleArchive(r: SessionRoom) {
    if (!r.is_archived) {
      const ok = window.confirm(`"${r.name}" 방을 보관하시겠습니까?\n\n유저 목록에서 사라지고 입장할 수 없게 됩니다. 기록은 남고 여기서 복구할 수 있습니다.`);
      if (!ok) return;
    }
    setRowBusy(r.id);
    const res = await gmSetSessionRoomArchived(r.id, !r.is_archived);
    setRowBusy(null);
    if (!res.ok) { report("err", res.message); return; }
    report("ok", `"${r.name}" 방을 ${r.is_archived ? "복구" : "보관"}했습니다.`);
    if (editingRoomId === r.id) cancelEdit();
    await refresh();
  }

  /* ── 렌더 ── */

  return (
    <div style={containerStyle}>
      {/* 토글 */}
      <section style={cardStyle} aria-labelledby="gm-session-toggle-h">
        <div style={rowStyle}>
          <div>
            <h2 id="gm-session-toggle-h" style={headerStyle}>세션 채팅 노출</h2>
            <div style={subStyle}>
              켜면 홈 화면 좌하단에 입장 버튼이 나타나고 유저가 발언·주사위를 쓸 수 있습니다.
              GM 은 꺼져 있어도 <a href="/session" style={linkStyle}>/session</a> 에서 준비할 수 있습니다.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="세션 채팅 노출"
            onClick={() => void toggleEnabled()}
            disabled={enabledBusy || loading}
            style={{ ...switchStyle, ...(enabled ? switchOnStyle : null) }}
          >
            <span style={{ ...knobStyle, ...(enabled ? knobOnStyle : null) }} aria-hidden="true" />
            <span style={{ ...switchTextStyle, color: enabled ? "#fff" : "#1a335e" }}>
              {enabledBusy ? "…" : enabled ? "켜짐" : "꺼짐"}
            </span>
          </button>
        </div>
      </section>

      {status ? (
        <div role={status.kind === "err" ? "alert" : "status"} style={{ ...noticeStyle, ...(status.kind === "err" ? noticeErrStyle : null) }}>
          {status.text}
        </div>
      ) : null}

      {/* 방 만들기 */}
      <section style={cardStyle} aria-labelledby="gm-session-create-h">
        <h2 id="gm-session-create-h" style={headerStyle}>방 만들기</h2>
        <label style={fieldLabelStyle}>
          방 이름
          <input
            type="text"
            value={newName}
            maxLength={60}
            onChange={(e) => setNewName(e.target.value)}
            style={inputStyle}
            placeholder="예) 1조 · 옥상 장면"
          />
        </label>
        <MemberPicker users={eligibleUsers} selected={newMembers} onChange={setNewMembers} idPrefix="new" />
        <button
          type="button"
          onClick={() => void createRoom()}
          disabled={creating || loading}
          style={primaryBtnStyle}
        >
          {creating ? "만드는 중…" : "방 만들기"}
        </button>
      </section>

      {/* 방 목록 */}
      <section style={cardStyle} aria-labelledby="gm-session-list-h" aria-busy={loading}>
        <div style={rowStyle}>
          <h2 id="gm-session-list-h" style={headerStyle}>방 목록</h2>
          <a href="/session" style={secondaryLinkStyle}>세션 화면 열기 →</a>
        </div>
        {loading ? <div style={emptyStyle}>불러오는 중…</div> : null}
        {!loading && rooms.length === 0 ? <div style={emptyStyle}>아직 만든 방이 없습니다.</div> : null}
        <ul style={listStyle}>
          {rooms.map((r) => {
            const editing = editingRoomId === r.id;
            const busy = rowBusy === r.id;
            return (
              <li key={r.id} style={{ ...itemStyle, ...(r.is_archived ? itemArchivedStyle : null) }}>
                <div style={itemHeadStyle}>
                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <div style={itemNameStyle}>
                      {r.name}
                      <span style={tagStyle}>{r.is_open ? "열림" : "닫힘"}</span>
                      {r.is_archived ? <span style={tagStyle}>보관됨</span> : null}
                    </div>
                    <div style={itemMetaStyle}>
                      {r.member_count}명
                      {r.members.length ? ` · ${r.members.map((m) => m.name).join(", ")}` : ""}
                    </div>
                  </div>
                  <div style={btnRowStyle}>
                    {!r.is_archived ? (
                      <>
                        <button type="button" onClick={() => void toggleOpen(r)} disabled={busy} style={smallBtnStyle}>
                          {r.is_open ? "닫기" : "열기"}
                        </button>
                        <button type="button" onClick={() => (editing ? cancelEdit() : startEdit(r))} disabled={busy} style={smallBtnStyle} aria-expanded={editing}>
                          {editing ? "편집 취소" : "이름·멤버 편집"}
                        </button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => void toggleArchive(r)} disabled={busy} style={{ ...smallBtnStyle, ...(r.is_archived ? null : dangerBtnStyle) }}>
                      {r.is_archived ? "복구" : "보관"}
                    </button>
                  </div>
                </div>

                {editing ? (
                  <div style={editBoxStyle}>
                    <label style={fieldLabelStyle}>
                      방 이름
                      <input
                        type="text"
                        value={editName}
                        maxLength={60}
                        onChange={(e) => setEditName(e.target.value)}
                        style={inputStyle}
                      />
                    </label>
                    <MemberPicker users={eligibleUsers} selected={editMembers} onChange={setEditMembers} idPrefix={`edit-${r.id}`} />
                    <div style={btnRowStyle}>
                      <button type="button" onClick={() => void saveEdit(r)} disabled={busy} style={primaryBtnStyle}>
                        {busy ? "저장 중…" : "저장"}
                      </button>
                      <button type="button" onClick={cancelEdit} disabled={busy} style={smallBtnStyle}>취소</button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* ── 스타일 ── */

const containerStyle: CSSProperties = { fontFamily: BODY, color: "#1a335e", display: "flex", flexDirection: "column", gap: 20 };
const cardStyle: CSSProperties = {
  background: "#fff",
  border: "1.5px solid rgba(0,0,0,0.1)",
  borderRadius: 14,
  padding: "18px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "space-between" };
const headerStyle: CSSProperties = { fontFamily: JUA, fontSize: 18, color: "#1a335e", margin: 0 };
const subStyle: CSSProperties = { fontSize: 13, color: "#4a6b8a", marginTop: 4, lineHeight: 1.5 };
const linkStyle: CSSProperties = { color: "#1f5fc4", textDecoration: "underline" };
const secondaryLinkStyle: CSSProperties = {
  fontFamily: JUA, fontSize: 13, color: "#0d6fa8", textDecoration: "none",
  border: "1.5px solid #bfe4f7", borderRadius: 999, padding: "6px 12px", background: "#fff",
};
const fieldLabelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#4a6b8a" };
const inputStyle: CSSProperties = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.25)", fontSize: 14, fontFamily: BODY, maxWidth: 360, color: "#1a335e",
};
const fieldsetStyle: CSSProperties = { border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: "10px 12px", margin: 0 };
const legendStyle: CSSProperties = { fontSize: 13, color: "#4a6b8a", padding: "0 6px" };
const pickerGridStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const pickStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999,
  border: "1.5px solid rgba(0,0,0,0.15)", background: "#fff", color: "#4a6b8a", fontSize: 13, cursor: "pointer",
};
const pickActiveStyle: CSSProperties = { border: "1.5px solid #3f88f9", background: "#eef4ff", color: "#1a335e", fontWeight: 600 };
const primaryBtnStyle: CSSProperties = {
  alignSelf: "flex-start", padding: "10px 22px", borderRadius: 10, border: 0, background: "#3f88f9", color: "#fff", fontSize: 14, fontFamily: JUA, cursor: "pointer",
};
const smallBtnStyle: CSSProperties = {
  padding: "6px 12px", borderRadius: 999, border: "1.5px solid #bfe4f7", background: "#fff", color: "#0d6fa8", fontSize: 12, fontFamily: JUA, cursor: "pointer",
};
const dangerBtnStyle: CSSProperties = { border: "1.5px solid #f3b9b3", color: "#b8443a" };
const noticeStyle: CSSProperties = { padding: "8px 12px", borderRadius: 8, background: "#e6f7f1", color: "#135c4b", fontSize: 13, border: "1px solid #8fd5bf" };
const noticeErrStyle: CSSProperties = { background: "#fdecea", color: "#8f2f27", border: "1px solid #f3b9b3" };
const emptyStyle: CSSProperties = { fontSize: 13, color: "#6c8196", padding: "6px 0" };
const listStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 };
const itemStyle: CSSProperties = { border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 };
const itemArchivedStyle: CSSProperties = { opacity: 0.7, background: "#f7f8fa" };
const itemHeadStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" };
const itemNameStyle: CSSProperties = { fontFamily: JUA, fontSize: 16, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const itemMetaStyle: CSSProperties = { fontSize: 12, color: "#4a6b8a", marginTop: 2 };
const tagStyle: CSSProperties = { fontFamily: BODY, fontSize: 11, padding: "1px 7px", borderRadius: 999, border: "1px solid #97beeb", color: "#2f5a86" };
const btnRowStyle: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" };
const editBoxStyle: CSSProperties = { borderTop: "1px dashed rgba(0,0,0,0.15)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 10 };

const switchStyle: CSSProperties = {
  position: "relative", width: 96, height: 36, borderRadius: 999, border: "2px solid #c9d3dd", background: "#e9eef4",
  cursor: "pointer", display: "flex", alignItems: "center", padding: "0 6px", gap: 8, fontFamily: JUA, flex: "0 0 auto",
};
const switchOnStyle: CSSProperties = { background: "#3f88f9", border: "2px solid #3f88f9" };
const knobStyle: CSSProperties = { width: 18, height: 18, borderRadius: "50%", background: "#c9d3dd", flex: "0 0 auto" };
const knobOnStyle: CSSProperties = { background: "#fff", boxShadow: "0 0 0 3px rgba(255,255,255,0.35)" };
const switchTextStyle: CSSProperties = { fontSize: 14, marginLeft: "auto", marginRight: 6 };