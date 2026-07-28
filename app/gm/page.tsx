// app/gm/page.tsx
//
// GM 관리 페이지 컨테이너 (세션 I — 상점 탭 추가).
//
// 변경점:
//   - 상점 탭 신규 추가 (GmShopTab). CRUD 는 RLS 로 GM 만 허용.
//   - 탭 순서: 초대 · 유저 · 공지 · 상점 · 문의

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import InviteGenerateForm from "@/components/gm/InviteGenerateForm";
import InviteCodeList     from "@/components/gm/InviteCodeList";
import ReportList         from "@/components/gm/reports/ReportList";
import UserList           from "@/components/gm/users/UserList";
import GmNoticesTab       from "@/components/gm/notices/GmNoticesTab";
import GmShopTab          from "@/components/gm/shop/GmShopTab";
import { getPendingReportCount } from "@/lib/auth-helpers";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

type TabKey = "invite" | "users" | "notices" | "shop" | "reports";

const TABS: { key: TabKey; label: string; emoji: string }[] = [
  { key: "invite",  label: "초대", emoji: "📮" },
  { key: "users",   label: "유저", emoji: "👥" },
  { key: "notices", label: "공지", emoji: "📢" },
  { key: "shop",    label: "매점", emoji: "🛒" },
  { key: "reports", label: "문의", emoji: "🙋" },
];

export default function GmPage() {
  const [tab, setTab] = useState<TabKey>("invite");
  const [inviteRefreshKey, setInviteRefreshKey] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  // 탭 전환 시 미완료 카운트 재조회.
  // 완료 처리는 문의 탭 내 ReportList에서 발생하므로,
  // 탭에서 나올 때 뱃지가 최신 상태로 반영됨.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = await getPendingReportCount();
      if (!cancelled) setPendingCount(n);
    })();
    return () => { cancelled = true; };
  }, [tab]);

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
          const showBadge = t.key === "reports" && pendingCount > 0;
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
                position:    "relative",
              }}
            >
              <span style={{ marginRight: 6 }}>{t.emoji}</span>
              {t.label}
              {showBadge ? (
                <span style={tabBadgeStyle}>{pendingCount > 99 ? "99+" : pendingCount}</span>
              ) : null}
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
            <InviteCodeList refreshKey={inviteRefreshKey} />
          </div>
        )}

        {tab === "users" && <UserList />}

        {tab === "notices" && <GmNoticesTab />}

        {tab === "shop" && <GmShopTab />}

        {tab === "reports" && <ReportList />}
      </main>
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
  maxWidth: 1080,
  margin:   "0 auto 16px",
  display:  "flex",
  gap:      8,
  flexWrap: "wrap",
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

// 탭 라벨 옆 빨간 뱃지 (문의 미완료 카운트)
const tabBadgeStyle: CSSProperties = {
  position:       "absolute",
  top:            -6,
  right:          -6,
  minWidth:       20,
  height:         20,
  padding:        "0 6px",
  borderRadius:   999,
  background:     "#e2695f",
  color:          "#fff",
  fontFamily:     JUA,
  fontSize:       11,
  lineHeight:     "20px",
  textAlign:      "center",
  border:         "2px solid #fff",
  boxSizing:      "content-box",
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