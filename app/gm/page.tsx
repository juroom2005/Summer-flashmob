// app/gm/page.tsx
//
// GM 관리 페이지 컨테이너 (v2 — 편의성 개편).
//
// 변경점 (v1 → v2):
//   - 탭 3개 → 2개
//   - [초대] 탭 = 발급 폼 + 코드 이력 (세로 배치, 연속 발급 최적화)
//   - [유저] 탭 = UserList
//   - 코드 이력이 폼 바로 아래에 있어 발급 즉시 확인·복사 가능
//
// refreshKey:
//   - InviteGenerateForm에서 발급 성공 시 setInviteRefreshKey(k => k+1)
//   - InviteCodeList가 refreshKey 변경 감지 → 재조회
//
// UserList는 자체적으로 재조회 관리 (삭제·GM 토글 후 자기 상태 재조회).
//
// 인증 가드는 app/gm/layout.tsx에서 처리 → 여기선 GM 확정 상태 전제.

"use client";

import { useState, type CSSProperties } from "react";
import InviteGenerateForm from "@/components/gm/InviteGenerateForm";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

type TabKey = "invite" | "users";

const TABS: { key: TabKey; label: string; emoji: string }[] = [
  { key: "invite", label: "초대", emoji: "📮" },
  { key: "users",  label: "유저", emoji: "👥" },
];

export default function GmPage() {
  const [tab, setTab] = useState<TabKey>("invite");
  const [inviteRefreshKey, setInviteRefreshKey] = useState(0);

  return (
    <div style={pageStyle}>
      {/* 헤더 */}
      <header style={headerStyle}>
        <div>
          <div style={titleStyle}>🔑 GM 관리</div>
          <div style={subtitleStyle}>Summer FlashMob 운영 페이지</div>
        </div>
        <a href="/" style={backLinkStyle}>← 홈으로</a>
      </header>

      {/* 탭 */}
      <nav style={tabBarStyle}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...tabButtonStyle,
                background:  active ? "#1a9edb" : "#fff",
                color:       active ? "#fff"    : "#0d6fa8",
                borderColor: active ? "#0d6fa8" : "#bfe4f7",
                boxShadow:   active ? "0 3px 0 #0d6fa8" : "0 2px 0 rgba(46,163,221,.2)",
              }}
            >
              <span style={{ marginRight: 6 }}>{t.emoji}</span>
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* 탭 내용 */}
      <main style={mainStyle}>
        {tab === "invite" && (
          <div style={sectionStackStyle}>
            <InviteGenerateForm
              onGenerated={() => setInviteRefreshKey((k) => k + 1)}
            />
            <ListPlaceholder
              title="발급 이력"
              note={`InviteCodeList 컴포넌트 추가 예정 (refreshKey=${inviteRefreshKey})`}
            />
          </div>
        )}

        {tab === "users" && (
          <ListPlaceholder
            title="유저 목록"
            note="UserList + DeleteConfirmDialog 컴포넌트 추가 예정"
          />
        )}
      </main>
    </div>
  );
}

/* ── 임시 placeholder ── */

function ListPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div style={placeholderCardStyle}>
      <div style={placeholderTitleStyle}>{title}</div>
      <div style={placeholderNoteStyle}>🚧 {note}</div>
    </div>
  );
}

/* ── 스타일 ── */

const pageStyle: CSSProperties = {
  minHeight:  "100vh",
  background: "linear-gradient(180deg, #eaf7fe 0%, #f4fbff 240px, #f4fbff 100%)",
  padding:    "24px 24px 48px",
};

const headerStyle: CSSProperties = {
  maxWidth:       1080,
  margin:         "0 auto 20px",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            16,
  flexWrap:       "wrap",
};

const titleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   28,
  color:      "#0d6fa8",
  lineHeight: 1.2,
};

const subtitleStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   15,
  color:      "#2ea3dd",
  marginTop:  2,
};

const backLinkStyle: CSSProperties = {
  height:         36,
  display:        "inline-flex",
  alignItems:     "center",
  padding:        "0 16px",
  border:         "2px solid #bfe4f7",
  borderRadius:   999,
  background:     "#fff",
  color:          "#0d6fa8",
  fontFamily:     JUA,
  fontSize:       14,
  textDecoration: "none",
  boxShadow:      "0 2px 0 rgba(46,163,221,.2)",
};

const tabBarStyle: CSSProperties = {
  maxWidth:  1080,
  margin:    "0 auto 16px",
  display:   "flex",
  gap:       8,
  flexWrap:  "wrap",
};

const tabButtonStyle: CSSProperties = {
  height:       40,
  padding:      "0 22px",
  border:       "2px solid",
  borderRadius: 12,
  fontFamily:   JUA,
  fontSize:     15,
  cursor:       "pointer",
  transition:   "background 120ms, color 120ms",
};

const mainStyle: CSSProperties = {
  maxWidth: 1080,
  margin:   "0 auto",
};

const sectionStackStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           20,
};

const placeholderCardStyle: CSSProperties = {
  padding:      "32px 32px",
  background:   "#fff",
  border:       "2px dashed #a8dcf5",
  borderRadius: 18,
  textAlign:    "center",
};

const placeholderTitleStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     18,
  color:        "#14406f",
  marginBottom: 6,
};

const placeholderNoteStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   13,
  color:      "#7fb3d4",
};