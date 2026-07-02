// app/components/NoticeBoard.tsx
// 공지사항 컴포넌트 — 시안 1a (종이질감 · 책 펼침 · 참여명단 위젯)
// 메인 화면에서 "공지사항"을 누르면 종이가 가운데서 양옆으로 펼쳐지고,
// 이후 다른 탭으로 넘기면 책장을 넘기듯 회전하며 전환됩니다.
//
// 사용법:
//   <NoticeBoard backgroundSrc="/summer-bg.jpg" />
//   - backgroundSrc 를 넣으면 자동으로 여름 하프톤(파란 듀오톤)이 입혀집니다.
//   - 넣지 않으면 연한 하늘색 배경으로 폴백됩니다.
//   - 디자인 기준 크기는 1366×768 이며, 부모 폭에 맞춰 자동 스케일됩니다.
//
// 폰트: 'Jua', 'Nanum Pen Script' (Google Fonts) — README 참고.

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type Tab = "notice" | "member" | "daily" | "shop";

const JUA = "'Jua', sans-serif";
const PEN = "'Nanum Pen Script', cursive";

const NAV: { key: Tab; label: string }[] = [
  { key: "notice", label: "공지사항" },
  { key: "member", label: "멤버" },
  { key: "daily", label: "일일" },
  { key: "shop", label: "상점" },
];

export default function NoticeBoard({ backgroundSrc }: { backgroundSrc?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("notice");
  const flipRef = useRef<HTMLDivElement>(null);

  // ── 부모 폭에 맞춰 1366×768 스테이지 자동 스케일 ──
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1366));
    ro.observe(el);
    setScale(el.clientWidth / 1366);
    return () => ro.disconnect();
  }, []);

  const openTab = (key: Tab) => {
    const wasOpen = open;
    const changed = tab !== key;
    setOpen(true);
    setTab(key);
    // 첫 열림 = 종이 펼침 / 이미 열린 상태에서 탭 전환 = 책장 넘김
    if (wasOpen && changed) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          flipRef.current?.animate(
            [
              { transform: "perspective(1700px) rotateY(-80deg)", opacity: 0, filter: "brightness(1.1)" },
              { transform: "perspective(1700px) rotateY(0deg)", opacity: 1, filter: "brightness(1)" },
            ],
            { duration: 470, easing: "cubic-bezier(.22,.78,.2,1)" }
          );
        })
      );
    }
  };

  return (
    <div ref={hostRef} style={{ width: "100%", height: 768 * scale, position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1366,
          height: 768,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 22px 60px rgba(20,58,99,.28)",
          background: "#cfe7fb",
          fontFamily: "'Gowun Dodum', sans-serif",
          color: "#14406f",
        }}
      >
        {/* ── 배경 (교체 가능) ── */}
        {backgroundSrc ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url(${backgroundSrc})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "grayscale(1) contrast(1.16) brightness(1.06)",
            }}
          />
        ) : null}
        <div style={{ position: "absolute", inset: 0, background: "#2f8fe6", mixBlendMode: "multiply", opacity: 0.5, pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, background: "#eef7ff", mixBlendMode: "screen", opacity: 0.28, pointerEvents: "none" }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "radial-gradient(circle,rgba(18,64,140,.4) 1px,transparent 1.5px)",
            backgroundSize: "5px 5px",
            mixBlendMode: "multiply",
            opacity: 0.35,
            pointerEvents: "none",
          }}
        />

        {/* ── 상단 로고/유틸 ── */}
        <div style={{ position: "absolute", top: 16, left: 22, fontFamily: JUA, fontSize: 21, letterSpacing: 1, textShadow: "1px 1px 0 #fff" }}>[메인홍]</div>
        <div style={{ position: "absolute", top: 20, right: 26, fontFamily: JUA, fontSize: 16, textShadow: "1px 1px 0 #fff" }}>✕&nbsp;&nbsp;로그인&nbsp;&nbsp;관리자호출</div>

        {/* ── 좌측 네비 = 탭 ── */}
        <div style={{ position: "absolute", left: 40, top: 158, display: "flex", flexDirection: "column", gap: 15, zIndex: 20 }}>
          {NAV.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => openTab(key)}
              style={{
                position: "relative",
                width: 138,
                height: 48,
                border: "2.5px solid #1a5db8",
                borderRadius: 999,
                background: "#fff",
                color: "#14406f",
                fontFamily: JUA,
                fontSize: 19,
                cursor: "pointer",
                boxShadow: "2px 3px 0 rgba(26,93,184,.45)",
                overflow: "hidden",
              }}
            >
              {open && tab === key ? <span style={{ position: "absolute", inset: 0, background: "#ffef3e" }} /> : null}
              <span style={{ position: "relative", zIndex: 1 }}>{label}</span>
            </button>
          ))}
        </div>

        {/* ── 위젯: 참여 명단 스티키 ── */}
        <div
          style={{
            position: "absolute",
            left: 24,
            bottom: 34,
            width: 140,
            background: "#f6f0a8",
            border: "2px solid #d8cf6a",
            borderRadius: "6px 6px 10px 10px",
            padding: "11px 13px 14px",
            boxShadow: "3px 5px 12px rgba(20,58,99,.25)",
            animation: "nb-floaty 6s ease-in-out infinite",
            zIndex: 8,
          }}
        >
          <div style={{ fontFamily: JUA, fontSize: 13, color: "#7a6a12", marginBottom: 6 }}>〈 참여 명단 〉</div>
          <div style={{ fontFamily: PEN, fontSize: 18, lineHeight: 1.3, color: "#4a4210" }}>
            안무·하루,소이,진<br />보컬·유나,물결<br />영상·케이<br />
            <span style={{ color: "#9a8b1e" }}>+ 실시간 3명</span>
          </div>
        </div>

        {/* ── NOW PLAYING ── */}
        <div
          style={{
            position: "absolute",
            right: 26,
            bottom: 26,
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "#1656b8",
            color: "#eaf5ff",
            fontFamily: JUA,
            fontSize: 15,
            padding: "9px 16px",
            borderRadius: 999,
            boxShadow: "2px 3px 0 rgba(20,40,90,.4)",
            zIndex: 15,
          }}
        >
          <span style={{ animation: "nb-blink 1.4s infinite" }}>♪</span> NOW PLAYING — 여름날 (2025 ver.)
        </div>

        {/* ── 힌트 (닫힘 상태) ── */}
        {!open ? (
          <div style={{ position: "absolute", left: 198, top: 196, fontFamily: PEN, fontSize: 26, color: "#14406f", textShadow: "1px 1px 0 #fff", zIndex: 5 }}>
            ← 공지사항을 누르면 종이가 양옆으로 펼쳐져요
          </div>
        ) : null}

        {/* ── 패널 ── */}
        {open ? (
          <div
            style={{
              position: "absolute",
              left: 172,
              top: 118,
              right: 34,
              bottom: 96,
              background: "#fcfbf4",
              border: "2.5px solid #1a5db8",
              borderRadius: 22,
              boxShadow: "0 18px 44px rgba(20,58,99,.3)",
              zIndex: 10,
              animation: "nb-bookOpen .58s cubic-bezier(.2,.85,.2,1) both",
              backgroundImage:
                "repeating-linear-gradient(180deg,transparent,transparent 33px,rgba(120,150,190,.09) 33px,rgba(120,150,190,.09) 34px)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 64,
                bottom: 64,
                width: 2,
                background: "repeating-linear-gradient(180deg,#e7a0a0,#e7a0a0 6px,transparent 6px,transparent 12px)",
                opacity: 0.6,
              }}
            />
            <button
              onClick={() => setOpen(false)}
              style={{
                position: "absolute",
                top: 16,
                right: 18,
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "2px solid #1a5db8",
                background: "#fff",
                color: "#14406f",
                fontFamily: JUA,
                fontSize: 16,
                cursor: "pointer",
                zIndex: 5,
              }}
            >
              ✕
            </button>

            <div ref={flipRef} style={{ position: "absolute", inset: 0, padding: "34px 44px 34px 62px", overflow: "auto", transformOrigin: "left center" }}>
              {tab === "notice" ? <NoticePanel /> : null}
              {tab === "member" ? <MemberPanel /> : null}
              {tab === "daily" ? <DailyPanel /> : null}
              {tab === "shop" ? <ShopPanel /> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* keyframes (컴포넌트 로컬) */}
      <style>{`
        @keyframes nb-bookOpen{0%{clip-path:inset(0 50% 0 50% round 22px);opacity:.55}55%{opacity:1}100%{clip-path:inset(0 0 0 0 round 22px);opacity:1}}
        @keyframes nb-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes nb-blink{0%,100%{opacity:1}50%{opacity:.25}}
      `}</style>
    </div>
  );
}

const label: CSSProperties = { fontFamily: JUA, color: "#1a5db8", minWidth: 66 };
const row: CSSProperties = { display: "flex", gap: 12 };
const rowText: CSSProperties = { fontSize: 16, lineHeight: 1.5 };

function NoticePanel() {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, borderBottom: "2.5px dashed #b9cbe6", paddingBottom: 12, marginBottom: 20 }}>
        <span style={{ fontFamily: JUA, fontSize: 27, color: "#14406f" }}>📌 공지사항</span>
        <span style={{ fontFamily: PEN, fontSize: 22, color: "#c56" }}>— 총공지 · 세계관 · 캐릭터 가이드 한번에</span>
      </div>
      <div style={{ fontFamily: JUA, fontSize: 22, color: "#1656b8", marginBottom: 6 }}>SUMMER Flash Mob! 여름 정기 플래시몹 안내</div>
      <div style={{ fontSize: 14, color: "#8aa", marginBottom: 18 }}>2026.07.02 · 운영진 · 📌 상단고정</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <div style={row}><span style={label}>일정</span><span style={rowText}>8/03(일) 오후 9시 · 디스코드 <b>〈연습실〉</b> 채널에서 모여요.</span></div>
        <div style={row}><span style={label}>세계관</span><span style={rowText}>올여름 컨셉은 <b>‘해변의 유령’</b> 🩵 캐릭터 시트 · 세계관 문서는 #가이드 채널에서.</span></div>
        <div style={row}><span style={label}>파트</span><span style={rowText}>A조 안무 / B조 보컬 / C조 영상 — 지원 폼 마감 <b>7/28(금)</b>.</span></div>
        <div style={row}><span style={label}>상점</span><span style={rowText}>사인펜 · 형광펜 · 스티커 상점 오픈! 일일 미션으로 코인을 모아보세요.</span></div>
        <div style={row}><span style={label}>커맨드</span><span style={rowText}>마스토돈에 <code style={{ background: "#fff2a8", padding: "1px 6px", borderRadius: 4 }}>!출석</code> 을 치면 오늘의 참여 명단에 등록돼요.</span></div>
      </div>
      <div style={{ marginTop: 22, display: "inline-block", background: "#fff2a8", border: "1.5px solid #e2d15a", borderRadius: 8, padding: "10px 16px", fontFamily: PEN, fontSize: 22, color: "#7a6a12", transform: "rotate(-1deg)" }}>
        🎧 탭을 옮겨다녀도 노래는 계속 흘러나와요 ♪
      </div>
    </div>
  );
}

function MemberPanel() {
  const chip: CSSProperties = { background: "#eaf3ff", border: "2px solid #bcd4f2", borderRadius: 999, padding: "8px 16px", fontFamily: JUA, color: "#1656b8" };
  return (
    <div>
      <div style={{ fontFamily: JUA, fontSize: 25, color: "#14406f", marginBottom: 14 }}>👥 멤버</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {["하루", "소이", "진", "유나", "물결", "케이"].map((n) => (
          <span key={n} style={chip}>{n}</span>
        ))}
      </div>
      <div style={{ fontFamily: PEN, fontSize: 22, color: "#c56", marginTop: 14 }}>오늘 8명 참여중 · 프로필 누르면 캐릭터 시트로!</div>
    </div>
  );
}

function DailyPanel() {
  const item: CSSProperties = { display: "flex", gap: 10, alignItems: "center", background: "#f4faff", border: "2px solid #cfe2f7", borderRadius: 10, padding: "12px 16px", fontSize: 16 };
  const coin: CSSProperties = { marginLeft: "auto", fontFamily: JUA, color: "#e0a500" };
  return (
    <div>
      <div style={{ fontFamily: JUA, fontSize: 25, color: "#14406f", marginBottom: 14 }}>🗓 일일 미션</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
        <label style={item}>✅ 연습실 출석하기 <span style={coin}>+5🪙</span></label>
        <label style={item}>⬜ 안무 클립 1개 인증 <span style={coin}>+10🪙</span></label>
        <label style={item}>⬜ 마스토돈에 오늘 연습 후기 </label>
      </div>
    </div>
  );
}

function ShopPanel() {
  const card: CSSProperties = { width: 130, background: "#fff", border: "2px solid #cfe2f7", borderRadius: 12, padding: 16, textAlign: "center" };
  const items = [
    { emoji: "🖊️", name: "사인펜", coin: "12🪙" },
    { emoji: "🖍️", name: "형광펜", coin: "8🪙" },
    { emoji: "✨", name: "스티커", coin: "15🪙" },
  ];
  return (
    <div>
      <div style={{ fontFamily: JUA, fontSize: 25, color: "#14406f", marginBottom: 14 }}>🛍 상점</div>
      <div style={{ display: "flex", gap: 16 }}>
        {items.map((it) => (
          <div key={it.name} style={card}>
            <div style={{ fontSize: 34 }}>{it.emoji}</div>
            <div style={{ fontFamily: JUA, color: "#1656b8", margin: "6px 0" }}>{it.name}</div>
            <div style={{ fontFamily: JUA, color: "#e0a500" }}>{it.coin}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
