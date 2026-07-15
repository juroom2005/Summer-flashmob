"use client";
// app/mypanel-demo/page.tsx — MyPanel 실데이터 확인용 데모 라우트
//
// 현재 로그인 유저의 profile을 getMyPanelProfile()로 읽어 MyPanel에 주입.
// 스탯 3개(리듬감/체력/표현력)는 profiles의 rhythm/physical/expression_stat에서 매핑.
// 인벤토리·공용 일정은 아직 스키마 없어 MyPanel 내부 DEFAULT 더미가 표시됨.
//
// 이 라우트는 NoticeBoard 헤더에 통합하기 전 검증용이며, 통합 후 삭제해도 됨.

import { useEffect, useState } from "react";
import MyPanel, { type MyPanelStat } from "@/components/noticeboard/panels/MyPanel";
import { getMyPanelProfile, type MyPanelProfileRow } from "@/lib/auth-helpers";
import { JUA, GAEGU } from "@/components/auth/fonts";

// 배경 (원본 시안 톤 유지 — 로딩·안내 화면에서도 동일 배경 사용)
function DemoBackground() {
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#7cc9f2 0%,#b8e6fb 38%,#e6f9ff 55%,#9adcf5 78%,#5fb4e0 100%)" }} />
      <div style={{ position: "absolute", inset: 0, background: "#17a0e6", mixBlendMode: "multiply", opacity: .42, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, background: "#e2fbff", mixBlendMode: "screen", opacity: .34, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle,rgba(8,105,170,.35) 1px,transparent 1.5px)", backgroundSize: "5px 5px", mixBlendMode: "multiply", opacity: .32, pointerEvents: "none" }} />
    </>
  );
}

export default function MyPanelDemo() {
  const [profile, setProfile] = useState<MyPanelProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getMyPanelProfile();
      if (cancelled) return;
      setProfile(p);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 로딩 중 ──
  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
        <DemoBackground />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: GAEGU, fontWeight: 700, fontSize: 22, color: "#0d6fa8" }}>
          불러오는 중...
        </div>
      </div>
    );
  }

  // ── 로그인 안 됐거나 profile 조회 실패 ──
  if (!profile) {
    return (
      <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
        <DemoBackground />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, textAlign: "center", padding: 20 }}>
          <div style={{ fontFamily: JUA, fontSize: 22, color: "#0d6fa8" }}>로그인이 필요해요</div>
          <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 17, color: "#2a5878" }}>
            메인 페이지에서 로그인 후 다시 방문해주세요
          </div>
        </div>
      </div>
    );
  }

  // ── profile 로드 완료 → MyPanel props로 매핑 ──
  const stats: MyPanelStat[] = [
    { label: "리듬감", value: profile.rhythm_stat,     color: "#1a9edb" },
    { label: "체력",   value: profile.physical_stat,   color: "#e0a500" },
    { label: "표현력", value: profile.expression_stat, color: "#ef8f6a" },
  ];

  const displayName =
    [profile.family_name, profile.given_name].filter(Boolean).join(" ") || "이름 미등록";

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <DemoBackground />

      {/* 로그인 후의 닉네임 버튼 — NoticeBoard 우상단 로그인 버튼 자리에 들어갈 형태 */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "absolute", top: 16, right: 26, height: 36,
          display: "flex", alignItems: "center", gap: 7,
          padding: "0 14px 0 5px",
          border: "2px solid #2ea3dd", borderRadius: 999,
          background: "rgba(255,255,255,.92)",
          color: "#0d6fa8", fontFamily: JUA, fontSize: 15,
          boxShadow: "2px 3px 0 rgba(46,163,221,.4)", zIndex: 30,
          cursor: "pointer",
        }}
      >
        <span style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "#cdeeff", border: "1.5px solid #2ea3dd",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
        }}>🌻</span>
        {displayName}
        <span style={{ fontSize: 11, color: "#7fb3d4" }}>▾</span>
      </button>

      <MyPanel
        open={open}
        onClose={() => setOpen(false)}
        profile={{
          familyName: profile.family_name,
          givenName:  profile.given_name,
          schoolName: profile.school_name,
          grade:      profile.grade,
          gender:     profile.gender,
        }}
        stats={stats}
        storageKey={`mypanel:${profile.id}`}
      />
    </div>
  );
}