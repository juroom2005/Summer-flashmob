// components/gm/users/UserList.tsx
//
// GM 유저 관리 탭의 컨테이너 (v2 — 좌 목록 / 우 상세 2단 구조).
//
// v1 → v2 변경:
//   · UserItem 접힘/펼침 방식 폐기 (세로가 너무 길어 가독성 저하)
//   · 좌측: UserListItem 목록 (요약만)
//   · 우측: 선택된 유저의 UserDetail (헤더 + 4개 패널)
//   · 선택 상태 관리 (selectedId)
//
// 책임:
//   · gm_list_users RPC로 목록 조회
//   · 검색 (이름 · 학교 · 이메일)
//   · 필터 (전체 / 가입 / 미가입 / 비활성)
//   · 좌/우 pane 조립 + 선택 상태 관리
//
// 갱신 전략:
//   · patchUser()  — 기본 정보·스탯·재화 수정 시. 해당 행만 교체 (선택 유지)
//   · refreshAll() — 비활성화·삭제 시. 목록 재조회
//
// 선택 상태 안전장치:
//   필터/검색으로 선택 유저가 목록에서 사라지거나, 삭제되면 자동 해제.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import { listGmUsers, type GmUserRow } from "@/lib/gm-user-helpers";
import UserListItem from "./UserListItem";
import UserDetail   from "./UserDetail";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

type FilterKey = "all" | "registered" | "shell" | "inactive";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",        label: "전체" },
  { key: "registered", label: "가입" },
  { key: "shell",      label: "미가입" },
  { key: "inactive",   label: "비활성" },
];

export default function UserList() {
  const [users,      setUsers]      = useState<GmUserRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState<FilterKey>("all");
  const [query,      setQuery]      = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const includeInactive = filter === "all" || filter === "inactive";

  /* ── 목록 조회 ── */
  const refreshAll = useCallback(async () => {
    setLoading(true);
    const rows = await listGmUsers(includeInactive);
    setUsers(rows);
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await listGmUsers(includeInactive);
      if (cancelled) return;
      setUsers(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [includeInactive]);

  /* ── 개별 행 부분 갱신 (선택 유지) ── */
  const patchUser = useCallback(
    (profileId: string, patch: Partial<GmUserRow>) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === profileId ? { ...u, ...patch } : u))
      );
    },
    []
  );

  /* ── 필터 + 검색 적용 ── */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    return users.filter((u) => {
      if (filter === "registered" && !u.is_registered) return false;
      if (filter === "shell"      &&  u.is_registered) return false;
      if (filter === "inactive"   &&  u.deactivated_at === null) return false;
      if ((filter === "registered" || filter === "shell") && u.deactivated_at !== null) {
        return false;
      }

      if (q === "") return true;
      const haystack = [
        u.family_name,
        u.given_name,
        [u.family_name, u.given_name].filter(Boolean).join(" "),
        u.school_name,
        u.email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [users, filter, query]);

  /* ── 선택 유저가 목록에서 사라지면 자동 해제 ── */
  useEffect(() => {
    if (selectedId && !visible.find((u) => u.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible, selectedId]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId]
  );

  /* ── 카운트 요약 ── */
  const counts = useMemo(() => {
    const registered = users.filter((u) => u.is_registered && u.deactivated_at === null).length;
    const shell      = users.filter((u) => !u.is_registered && u.deactivated_at === null).length;
    const inactive   = users.filter((u) => u.deactivated_at !== null).length;
    return { registered, shell, inactive };
  }, [users]);

  return (
    <div style={splitStyle}>
      {/* ═════ 좌측 목록 pane ═════ */}
      <div style={listPaneStyle}>
        <input
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder="이름 · 학교 · 이메일"
          style={searchInputStyle}
        />

        <div style={filterRowStyle}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{
                  ...filterButtonStyle,
                  background:  active ? "#1a9edb" : "#fff",
                  color:       active ? "#fff"    : "#0d6fa8",
                  borderColor: active ? "#0d6fa8" : "#bfe4f7",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div style={summaryBarStyle}>
          <span>가입 {counts.registered}</span>
          <span style={dotStyle}>·</span>
          <span>미가입 {counts.shell}</span>
          {counts.inactive > 0 ? (
            <>
              <span style={dotStyle}>·</span>
              <span>비활성 {counts.inactive}</span>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={loading}
            title="새로고침"
            style={{
              ...refreshButtonStyle,
              opacity: loading ? 0.4 : 1,
              cursor:  loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "…" : "↻"}
          </button>
        </div>

        <div style={listScrollStyle}>
          {loading ? (
            <div style={listNoticeStyle}>불러오는 중입니다…</div>
          ) : visible.length === 0 ? (
            <div style={listNoticeStyle}>
              {query.trim() !== ""
                ? "검색 결과가 없습니다."
                : "표시할 유저가 없습니다."}
            </div>
          ) : (
            visible.map((u) => (
              <UserListItem
                key={u.id}
                user={u}
                isActive={u.id === selectedId}
                onClick={() => setSelectedId(u.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* ═════ 우측 상세 pane ═════ */}
      <div style={detailPaneStyle}>
        {selectedUser ? (
          <UserDetail
            user={selectedUser}
            onPatch={patchUser}
            onRefresh={() => void refreshAll()}
          />
        ) : (
          <div style={emptyNoticeStyle}>
            <div style={emptyEmojiStyle}>👥</div>
            <div style={emptyTitleStyle}>유저를 선택해주십시오</div>
            <div style={emptyDescStyle}>
              좌측 목록에서 유저를 선택하시면 상세 정보와 관리 옵션이 표시됩니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 스타일 ── */

/** 좌우 pane 공통 높이. 페이지 상단(헤더+탭바) 감안. */
const PANE_HEIGHT     = "calc(100vh - 240px)";
const PANE_MIN_HEIGHT = 480;

const splitStyle: CSSProperties = {
  display:    "flex",
  gap:        12,
  alignItems: "stretch",
};

const listPaneStyle: CSSProperties = {
  width:         260,
  flexShrink:    0,
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  height:        PANE_HEIGHT,
  minHeight:     PANE_MIN_HEIGHT,
};

const detailPaneStyle: CSSProperties = {
  flex:      1,
  minWidth:  0,
  height:    PANE_HEIGHT,
  minHeight: PANE_MIN_HEIGHT,
  overflow:  "auto",
  padding:   "2px 4px 20px",
};

const searchInputStyle: CSSProperties = {
  height:       32,
  border:       "1.5px solid #cfe4f2",
  borderRadius: 999,
  padding:      "0 14px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#2c4a60",
  outline:      "none",
  background:   "#fff",
  flexShrink:   0,
};

const filterRowStyle: CSSProperties = {
  display:    "flex",
  gap:        4,
  flexShrink: 0,
};

const filterButtonStyle: CSSProperties = {
  flex:         1,
  height:       28,
  padding:      "0 8px",
  border:       "1.5px solid #bfe4f7",
  borderRadius: 999,
  fontFamily:   JUA,
  fontSize:     11,
  cursor:       "pointer",
};

const summaryBarStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        4,
  fontFamily: BODY,
  fontSize:   11,
  color:      "#5a7488",
  flexShrink: 0,
  padding:    "0 4px",
};

const dotStyle: CSSProperties = {
  color: "#b8c6d0",
};

const refreshButtonStyle: CSSProperties = {
  marginLeft:   "auto",
  width:        26,
  height:       26,
  border:       "1.5px solid #cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     12,
  padding:      0,
};

const listScrollStyle: CSSProperties = {
  flex:          1,
  minHeight:     0,
  overflowY:     "auto",
  display:       "flex",
  flexDirection: "column",
  gap:           6,
  padding:       "4px 2px",
};

const listNoticeStyle: CSSProperties = {
  padding:    "32px 12px",
  textAlign:  "center",
  fontFamily: BODY,
  fontSize:   12,
  color:      "#7a94a8",
};

const emptyNoticeStyle: CSSProperties = {
  display:        "flex",
  flexDirection:  "column",
  alignItems:     "center",
  justifyContent: "center",
  height:         "100%",
  padding:        "40px 20px",
  textAlign:      "center",
  background:     "#fff",
  border:         "1.5px dashed #dce8f0",
  borderRadius:   12,
};

const emptyEmojiStyle: CSSProperties = {
  fontSize:     36,
  marginBottom: 12,
  opacity:      0.6,
};

const emptyTitleStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     15,
  color:        "#5a7488",
  marginBottom: 6,
};

const emptyDescStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#8ca5b8",
  lineHeight: 1.6,
  maxWidth:   320,
};