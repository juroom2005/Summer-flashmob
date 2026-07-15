// components/NoticeBoard.tsx
// 폰트: Jua · Gowun Dodum · Gaegu (app/layout.tsx 에서 next/font 로 로드)

"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ChangeEvent,
} from "react";

import { supabase } from "@/lib/supabase";
import AdminChatOverlay from "./admin-chat/AdminChatOverlay";
import AuthModal from "./auth/AuthModal";
import Header from "./noticeboard/Header";
import NavRail, { type Tab } from "./noticeboard/NavRail";

// ── 폰트 상수 ──────────────────────────────────────────────
const JUA = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY = "'Gowun Dodum', sans-serif";

// ── 타입 ──────────────────────────────────────────────────
type Overlay = null | "login" | "register" | "admin";

type Mission = { t: string; r: number; done: boolean };
type ShopItem = {
  key: string;
  emoji: string;
  name: string;
  price: number;
  border: string;
  rot: string;
};
type Member = {
  name: string;
  emoji: string;
  role: string;
  rc: string;
  border: string;
  back: string;
};

// ── 정적 데이터 ────────────────────────────────────────────

const SHOP: ShopItem[] = [
  { key: "pen", emoji: "🖊️", name: "사인펜", price: 12, border: "#cdeeff", rot: "-1.5deg" },
  { key: "hl",  emoji: "🖍️", name: "형광펜", price: 8,  border: "#c9f2e6", rot: "1deg" },
  { key: "st",  emoji: "✨", name: "스티커", price: 15, border: "#d8e5fc", rot: "-1deg" },
];

const MEMBERS: Member[] = [
  { name: "하루", emoji: "🌻", role: "안무 리더", rc: "#2ea3dd", border: "#cdeeff", back: "파도 위를 달리는 리더 유령 🌊" },
  { name: "소이", emoji: "🍑", role: "안무",     rc: "#4db6a0", border: "#c9f2e6", back: "모래성 짓기 담당 · 낮잠 요정" },
  { name: "진",   emoji: "🐚", role: "안무",     rc: "#b09a20", border: "#fff3a6", back: "소라껍데기로 노래를 모으는 중" },
  { name: "유나", emoji: "🎤", role: "보컬",     rc: "#4a7fe0", border: "#d8e5fc", back: "등대 위 하이노트 담당" },
  { name: "물결", emoji: "🌊", role: "보컬",     rc: "#4a90d9", border: "#cfe6ff", back: "6월에 합류한 신입 파도" },
  { name: "케이", emoji: "📼", role: "영상",     rc: "#2ea3dd", border: "#cdeeff", back: "해변의 순간을 필름에 담는 중" },
];

const INITIAL_MISSIONS: Mission[] = [
  { t: "연습실 출석하기",           r: 5,  done: true  },
  { t: "안무 클립 1개 인증",        r: 10, done: false },
  { t: "마스토돈에 오늘 연습 후기", r: 5,  done: false },
];

// ═══════════════════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════════════════
export default function NoticeBoard({
  backgroundSrc,
}: {
  backgroundSrc?: string;
}) {
  // ── 상태 ─────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("notice");
  const [overlay, setOverlay] = useState<Overlay>(null);

  const [coins, setCoins] = useState(5);
  const [missions, setMissions] = useState<Mission[]>(INITIAL_MISSIONS);
  const [owned, setOwned] = useState<Record<string, boolean>>({});
  const [flipped, setFlipped] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);

  const [attendees, setAttendees] = useState<string[]>(["새벽", "라임", "도토"]);
  const [attendName, setAttendName] = useState("");

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 참조 ─────────────────────────────────────────────────
  const flipRef = useRef<HTMLDivElement>(null);
  const coinRef = useRef<HTMLDivElement>(null);

  // ── 부모 폭에 맞춰 1366×768 스테이지 자동 스케일 ────────
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


  // ── 토스트 정리 ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);


  const showToast = (t: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 1900);
  };

  // ── 애니메이션 헬퍼 ──────────────────────────────────────
  const popCoin = () => {
    coinRef.current?.animate?.(
      [{ transform: "scale(1)" }, { transform: "scale(1.28)" }, { transform: "scale(1)" }],
      { duration: 320, easing: "ease-out" }
    );
  };
  const shakeCoin = () => {
    coinRef.current?.animate?.(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-6px)" },
        { transform: "translateX(6px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 320 }
    );
  };
  const doFlip = () => {
    flipRef.current?.animate?.(
      [
        { transform: "perspective(1700px) rotateY(-80deg)", opacity: 0, filter: "brightness(1.14)" },
        { transform: "perspective(1700px) rotateY(0deg)",   opacity: 1, filter: "brightness(1)" },
      ],
      { duration: 470, easing: "cubic-bezier(.22,.78,.2,1)" }
    );
  };

  // ── 액션 ─────────────────────────────────────────────────
  const openTab = (key: Tab) => {
    const wasOpen = open;
    const changed = tab !== key;
    setOpen(true);
    setTab(key);
    if (wasOpen && changed) {
      requestAnimationFrame(() => requestAnimationFrame(doFlip));
    }
  };

  const toggleMission = (i: number) => {
    setMissions((prev) => {
      const next = prev.map((m, j) => (j === i ? { ...m, done: !m.done } : m));
      const delta = next[i].done ? next[i].r : -next[i].r;
      setCoins((c) => c + delta);
      return next;
    });
    popCoin();
  };

  const buy = (key: string) => {
    const item = SHOP.find((x) => x.key === key);
    if (!item || owned[key]) return;
    if (coins < item.price) {
      shakeCoin();
      showToast("🪙 코인이 부족해요! 일일 미션으로 모아보세요");
      return;
    }
    setCoins((c) => c - item.price);
    setOwned((o) => ({ ...o, [key]: true }));
    popCoin();
    showToast(`${item.emoji} ${item.name} 구매 완료!`);
  };

  const attend = () => {
    const n = attendName.trim();
    if (!n) return;
    setAttendees((a) => [...a, n]);
    setAttendName("");
    showToast(`☀️ ${n} 님 출석 완료! 참여 명단에 올라갔어요`);
  };


  // ── 파생값 ───────────────────────────────────────────────
  const doneCount = missions.filter((m) => m.done).length;
  const progressPct = Math.round((doneCount / missions.length) * 100);
  const allDone = missions.every((m) => m.done);

  // ═══════════════════════════════════════════════════════════
  // 렌더
  // ═══════════════════════════════════════════════════════════
  return (
    <div
      ref={hostRef}
      style={{ width: "100%", height: 768 * scale, position: "relative", overflow: "hidden" }}
    >
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
          background: "linear-gradient(180deg,#7cc9f2 0%,#b8e6fb 38%,#e6f9ff 55%,#9adcf5 78%,#5fb4e0 100%)",
          fontFamily: BODY,
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
              filter: "grayscale(1) contrast(1.12) brightness(1.1)",
            }}
          />
        ) : null}
        <div style={{ position: "absolute", inset: 0, background: "#17a0e6", mixBlendMode: "multiply", opacity: 0.42, pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, background: "#e2fbff", mixBlendMode: "screen",   opacity: 0.34, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: -90, right: 110, width: 460, height: 460, background: "radial-gradient(circle,rgba(255,255,255,.85),rgba(255,255,255,0) 62%)", pointerEvents: "none" }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "radial-gradient(circle,rgba(8,105,170,.35) 1px,transparent 1.5px)",
            backgroundSize: "5px 5px",
            mixBlendMode: "multiply",
            opacity: 0.32,
            pointerEvents: "none",
          }}
        />

        {/* ── 상단 헤더 ── */}
          <Header
            coins={coins}
            coinRef={coinRef}
            onLoginClick={() => setOverlay("login")}
            onAdminClick={() => setOverlay((prev) => (prev === "admin" ? null : "admin"))}
          />
        

        {/* ── 좌측 nav rail (스티커 탭) ── */}
          <NavRail
            activeTab={open ? tab : null}
            onTabClick={openTab}
          />

        {/* ── 위젯: 참여 명단 스티키 ── */}
        <div
          style={{
            position: "absolute",
            left: 24,
            bottom: 34,
            width: 150,
            background: "#dff4ff",
            border: "2px solid #a8dcf5",
            borderRadius: "4px 4px 12px 12px",
            padding: "14px 13px",
            boxShadow: "3px 5px 12px rgba(20,58,99,.22)",
            animation: "nb-floaty 6s ease-in-out infinite",
            zIndex: 8,
            transform: "rotate(-1.5deg)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -9,
              left: 38,
              width: 64,
              height: 18,
              background: "rgba(255,239,62,.8)",
              border: "1px solid rgba(216,207,106,.6)",
              transform: "rotate(-3deg)",
            }}
          />
          <div style={{ fontFamily: JUA, fontSize: 13, color: "#0d6fa8", marginBottom: 6 }}>〈 참여 명단 〉</div>
          <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 16, lineHeight: 1.3, color: "#2a5878" }}>
            안무 · 하루, 소이, 진<br />보컬 · 유나, 물결<br />영상 · 케이
          </div>
          <div
            style={{
              marginTop: 7,
              paddingTop: 6,
              borderTop: "1.5px dashed #a8dcf5",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {attendees.map((nm, i) => (
              <div
                key={`${nm}-${i}`}
                style={{
                  fontFamily: GAEGU,
                  fontWeight: 700,
                  fontSize: 15,
                  color: "#2ea3dd",
                  animation: "nb-pixelPop .35s both",
                }}
              >
                ☀️ {nm} 출석!
              </div>
            ))}
          </div>
        </div>

        {/* ── NOW PLAYING (재생 토글) ── */}
        <button
          onClick={() => setPlaying((p) => !p)}
          style={{
            position: "absolute",
            right: 26,
            bottom: 26,
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "#1a9edb",
            border: "2px solid #fff",
            color: "#fff",
            fontFamily: JUA,
            fontSize: 15,
            padding: "9px 18px",
            borderRadius: 999,
            boxShadow: "2px 3px 0 rgba(20,40,90,.25)",
            zIndex: 15,
            cursor: "pointer",
            transition: "transform .15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          <span style={{ animation: playing ? "nb-blink 1.4s infinite" : "none" }}>
            {playing ? "♪" : "▶"}
          </span>{" "}
          {playing ? "NOW PLAYING — 여름날 (2025 ver.)" : "PAUSED — 눌러서 재생"}
        </button>

        {/* ── 힌트 (닫힘 상태) ── */}
        {!open ? (
          <div
            style={{
              position: "absolute",
              left: 198,
              top: 300,
              fontFamily: GAEGU,
              fontWeight: 700,
              fontSize: 27,
              color: "#0d6fa8",
              textShadow: "1px 1px 0 #fff",
              zIndex: 5,
            }}
          >
        
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
              background: "#fffdf4",
              border: "2.5px solid #2ea3dd",
              borderRadius: 22,
              boxShadow: "0 18px 44px rgba(20,58,99,.28)",
              zIndex: 10,
              animation: "nb-bookOpen .58s cubic-bezier(.2,.85,.2,1) both",
              backgroundImage:
                "repeating-linear-gradient(180deg,transparent,transparent 31px,rgba(46,163,221,.1) 31px,rgba(46,163,221,.1) 32px)",
            }}
          >
            {/* 상단 마스킹테이프 데코 */}
            <div
              style={{
                position: "absolute",
                top: -11,
                left: 120,
                width: 96,
                height: 24,
                background: "repeating-linear-gradient(45deg,#cdeeff 0 8px,#e9f8ff 8px 16px)",
                opacity: 0.92,
                transform: "rotate(-3deg)",
                borderRadius: 2,
                boxShadow: "0 2px 5px rgba(20,58,99,.15)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: -11,
                right: 150,
                width: 96,
                height: 24,
                background: "repeating-linear-gradient(45deg,#c9f2e6 0 8px,#e9fbf5 8px 16px)",
                opacity: 0.92,
                transform: "rotate(2deg)",
                borderRadius: 2,
                boxShadow: "0 2px 5px rgba(20,58,99,.15)",
              }}
            />

            <button
              onClick={() => setOpen(false)}
              style={{
                position: "absolute",
                top: 14,
                right: 16,
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "2px solid #2ea3dd",
                background: "#fff",
                color: "#0d6fa8",
                fontFamily: JUA,
                fontSize: 16,
                cursor: "pointer",
                zIndex: 5,
              }}
            >
              ✕
            </button>

            <div
              ref={flipRef}
              style={{
                position: "absolute",
                inset: 0,
                padding: "26px 36px",
                overflow: "auto",
                transformOrigin: "left center",
              }}
            >
              {tab === "notice" ? (
                <NoticePanel
                  attendName={attendName}
                  onAttendNameChange={(v) => setAttendName(v)}
                  onAttend={attend}
                />
              ) : null}
              {tab === "member" ? (
                <MemberPanel flipped={flipped} onFlip={(name) => setFlipped((f) => (f === name ? null : name))} />
              ) : null}
              {tab === "daily" ? (
                <DailyPanel
                  missions={missions}
                  onToggle={toggleMission}
                  doneCount={doneCount}
                  progressPct={progressPct}
                  allDone={allDone}
                />
              ) : null}
              {tab === "shop" ? (
                <ShopPanel coins={coins} owned={owned} onBuy={buy} />
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ── 로그인·가입 모달 ── */}
          <AuthModal
            open={overlay === "login" || overlay === "register"}
            initialTab={overlay === "register" ? "register" : "login"}
            onClose={() => setOverlay(null)}
          />
        {/* ── 관리자 호출 채팅 ── */}
          <AdminChatOverlay
            open={overlay === "admin"}
            onClose={() => setOverlay(null)}
          />

        {/* ── 토스트 ── */}
        {toast ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 100,
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 60,
            }}
          >
            <div
              style={{
                background: "#14406f",
                color: "#fff",
                fontFamily: JUA,
                fontSize: 16,
                padding: "11px 24px",
                borderRadius: 999,
                border: "2px solid #fff",
                boxShadow: "0 10px 26px rgba(8,50,90,.4)",
                animation: "nb-pixelPop .3s both",
                whiteSpace: "nowrap",
              }}
            >
              {toast}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 서브 패널
// ═══════════════════════════════════════════════════════════

const loginInputStyle: CSSProperties = {
  height: 44,
  border: "2px solid #bfe4f7",
  borderRadius: 12,
  padding: "0 14px",
  fontFamily: BODY,
  fontSize: 15,
  color: "#1e4b6e",
  outline: "none",
  background: "#f4fbff",
};

const chip = (bg: string, color: string): CSSProperties => ({
  fontFamily: JUA,
  fontSize: 13,
  background: bg,
  color,
  borderRadius: 999,
  padding: "3px 12px",
  whiteSpace: "nowrap",
});

function NoticePanel({
  attendName,
  onAttendNameChange,
  onAttend,
}: {
  attendName: string;
  onAttendNameChange: (v: string) => void;
  onAttend: () => void;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          borderBottom: "2.5px dashed #a8dcf5",
          paddingBottom: 10,
          marginBottom: 16,
        }}
      >
        <span style={{ fontFamily: JUA, fontSize: 26, color: "#0d6fa8" }}>📌 공지사항</span>
        <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 21, color: "#2ea3dd" }}>
          — 총공지 · 세계관 · 캐릭터 가이드 한번에!
        </span>
        <span
          style={{
            marginLeft: 52,
            fontFamily: JUA,
            fontSize: 13,
            background: "#cdeeff",
            color: "#0d6fa8",
            borderRadius: 999,
            padding: "4px 12px",
          }}
        >
          📌 상단고정
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 288px", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#fff", border: "2px solid #cdeeff", borderRadius: 16, padding: "16px 18px" }}>
            <div style={{ fontFamily: JUA, fontSize: 21, color: "#1656b8", marginBottom: 3 }}>
              SUMMER Flash Mob! 여름 정기 플래시몹 안내
            </div>
            <div style={{ fontSize: 13, color: "#a4b6cc", marginBottom: 12 }}>2026.07.02 · 운영진</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={chip("#cdeeff", "#0d6fa8")}>일정</span>
                <span style={{ fontSize: 15, lineHeight: 1.5 }}>
                  8/03(일) 오후 9시 · 디스코드 <b>〈연습실〉</b> 채널에서 모여요.
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={chip("#c9f2e6", "#1e7d6a")}>세계관</span>
                <span style={{ fontSize: 15, lineHeight: 1.5 }}>
                   🌊 캐릭터 시트 · 세계관 문서는 #가이드 채널에서.
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={chip("#fff3a6", "#8a7410")}>파트</span>
                <span style={{ fontSize: 15, lineHeight: 1.5 }}>
                  A조 안무 / B조 보컬 / C조 영상 — 지원 폼 마감 <b>7/28(금)</b>.
                </span>
              </div>
            </div>
          </div>

          <div style={{ background: "#e8f7ff", border: "2px solid #a8dcf5", borderRadius: 14, padding: "13px 16px" }}>
            <div style={{ fontFamily: JUA, fontSize: 15, color: "#0d6fa8", marginBottom: 9 }}>
              ⌨️ 커맨드 체험 — 닉네임 쓰고{" "}
              <code style={{ background: "#fff2a8", padding: "1px 6px", borderRadius: 4 }}>!출석</code> 을 눌러보세요
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={attendName}
                onChange={(e) => onAttendNameChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onAttend(); }}
                placeholder="닉네임"
                style={{
                  flex: 1,
                  height: 40,
                  border: "2px solid #bfe4f7",
                  borderRadius: 10,
                  padding: "0 13px",
                  fontFamily: BODY,
                  fontSize: 15,
                  color: "#1e4b6e",
                  outline: "none",
                  background: "#fff",
                }}
              />
              <button
                onClick={onAttend}
                style={{
                  height: 40,
                  padding: "0 18px",
                  border: 0,
                  borderRadius: 10,
                  background: "#1a9edb",
                  color: "#fff",
                  fontFamily: JUA,
                  fontSize: 15,
                  cursor: "pointer",
                  boxShadow: "0 3px 0 #0d6fa8",
                }}
              >
                !출석
              </button>
            </div>
            <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 16, color: "#2ea3dd", marginTop: 8 }}>
              → 왼쪽 아래 〈참여 명단〉 위젯에 바로 올라가요!
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              background: "#ffef3e",
              border: "2px solid #e2d15a",
              borderRadius: 16,
              padding: "14px 16px",
              textAlign: "center",
              transform: "rotate(1deg)",
            }}
          >
            <div style={{ fontFamily: JUA, fontSize: 36, color: "#14406f", lineHeight: 1 }}>D-27</div>
            <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 18, color: "#7a6a12", marginTop: 4 }}>
              8/03(일) 밤 9시 · 플래시몹!
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              borderRadius: 4,
              padding: "10px 10px 8px",
              boxShadow: "0 6px 16px rgba(20,58,99,.18)",
              transform: "rotate(-2deg)",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -10,
                left: "50%",
                width: 70,
                height: 20,
                marginLeft: -35,
                background: "repeating-linear-gradient(45deg,#cfe6ff 0 8px,#eaf4ff 8px 16px)",
                opacity: 0.92,
                transform: "rotate(-2deg)",
              }}
            />
            <div
              style={{
                width: "100%",
                height: 126,
                background: "#eaf5fd",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#7fb3d4",
                fontFamily: GAEGU,
                fontWeight: 700,
              }}
            >
              컨셉 무드 사진
            </div>
            <div
              style={{
                fontFamily: GAEGU,
                fontWeight: 700,
                fontSize: 18,
                color: "#14406f",
                textAlign: "center",
                paddingTop: 6,
              }}
            >
              🌊폴라로이드 틀
            </div>
          </div>

          <div
            style={{
              background: "#c9f2e6",
              border: "2px solid #8fdcc7",
              borderRadius: "4px 4px 14px 14px",
              padding: "12px 14px",
              fontFamily: GAEGU,
              fontWeight: 700,
              fontSize: 18,
              color: "#1e7d6a",
              transform: "rotate(1deg)",
            }}
          >
            🎧 아무거나
          </div>
        </div>
      </div>
    </div>
  );
}

function MemberPanel({
  flipped,
  onFlip,
}: {
  flipped: string | null;
  onFlip: (name: string) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <span style={{ fontFamily: JUA, fontSize: 24, color: "#0d6fa8" }}>👥 멤버</span>
        <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 18, color: "#2ea3dd" }}>
          카드를 누르면 캐릭터 시트가 홱- 뒤집혀요!
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,208px)", gap: 12 }}>
        {MEMBERS.map((mb) => {
          const isFlipped = flipped === mb.name;
          return (
            <div
              key={mb.name}
              onClick={() => onFlip(mb.name)}
              style={{ position: "relative", height: 92, cursor: "pointer", perspective: 900 }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  transition: "transform .55s cubic-bezier(.3,.8,.3,1)",
                  transformStyle: "preserve-3d",
                  transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backfaceVisibility: "hidden",
                    background: "#fff",
                    border: `2px solid ${mb.border}`,
                    borderRadius: 16,
                    padding: "12px 14px",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 26 }}>{mb.emoji}</span>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontFamily: JUA, color: "#1656b8" }}>{mb.name}</span>
                    <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 15, color: mb.rc }}>{mb.role}</span>
                  </span>
                  <span style={{ marginLeft: "auto", fontFamily: JUA, fontSize: 12, color: "#a4b6cc" }}>↻ 시트</span>
                </div>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                    background: "#14406f",
                    border: `2px solid ${mb.border}`,
                    borderRadius: 16,
                    padding: "11px 14px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 3,
                  }}
                >
                  <span style={{ fontFamily: JUA, fontSize: 12, color: "#7fd0f0" }}>{mb.name} · 캐릭터 시트</span>
                  <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 16, lineHeight: 1.25, color: "#fff" }}>
                    {mb.back}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DailyPanel({
  missions,
  onToggle,
  doneCount,
  progressPct,
  allDone,
}: {
  missions: Mission[];
  onToggle: (i: number) => void;
  doneCount: number;
  progressPct: number;
  allDone: boolean;
}) {
  const borders = ["#cdeeff", "#c9f2e6", "#fff3a6"];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <span style={{ fontFamily: JUA, fontSize: 24, color: "#0d6fa8" }}>✅ 일일 미션</span>
        <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 18, color: "#2ea3dd" }}>
          눌러서 체크하면 코인이 짤랑- 들어와요
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 540 }}>
        {missions.map((m, i) => (
          <div
            key={i}
            onClick={() => onToggle(i)}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              background: "#fff",
              border: `2px solid ${borders[i % 3]}`,
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 15,
              cursor: "pointer",
              opacity: m.done ? 0.6 : 1,
              transition: "opacity .25s, transform .15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "translateX(4px)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "translateX(0)")}
          >
            <span style={{ fontSize: 16 }}>{m.done ? "✅" : "⬜"}</span>
            <span style={{ textDecoration: m.done ? "line-through" : "none" }}>{m.t}</span>
            <span style={{ marginLeft: "auto", fontFamily: JUA, color: "#e0a500" }}>+{m.r}🪙</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, maxWidth: 540 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: JUA, fontSize: 14, color: "#0d6fa8", marginBottom: 5 }}>
          <span>오늘의 달성률</span>
          <span>{doneCount} / {missions.length}</span>
        </div>
        <div style={{ height: 12, borderRadius: 999, background: "#dff4ff", border: "1.5px solid #a8dcf5", overflow: "hidden" }}>
          <div
            style={{
              width: `${progressPct}%`,
              height: "100%",
              background: "linear-gradient(90deg,#1a9edb,#7fd0f0)",
              transition: "width .45s cubic-bezier(.3,.8,.3,1)",
            }}
          />
        </div>
      </div>
      {allDone ? (
        <div
          style={{
            marginTop: 18,
            display: "inline-block",
            background: "#ffef3e",
            border: "2px solid #e2d15a",
            borderRadius: 14,
            padding: "10px 20px",
            fontFamily: JUA,
            fontSize: 19,
            color: "#7a6a12",
            transform: "rotate(-2deg)",
            animation: "nb-pixelPop .45s both",
          }}
        >
          ⛱️ 오늘 미션 올클리어!
        </div>
      ) : null}
    </div>
  );
}

function ShopPanel({
  coins,
  owned,
  onBuy,
}: {
  coins: number;
  owned: Record<string, boolean>;
  onBuy: (key: string) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <span style={{ fontFamily: JUA, fontSize: 24, color: "#0d6fa8" }}>🛒 상점</span>
        <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 18, color: "#2ea3dd" }}>
          보유 코인 {coins}🪙 — 모자라면 일일 미션으로!
        </span>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {SHOP.map((it) => {
          const isOwned = !!owned[it.key];
          return (
            <div
              key={it.key}
              style={{
                width: 150,
                background: "#fff",
                border: `2px solid ${it.border}`,
                borderRadius: 16,
                padding: "16px 14px",
                textAlign: "center",
                transform: `rotate(${it.rot})`,
                transition: "transform .18s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "rotate(0deg) scale(1.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = `rotate(${it.rot})`)}
            >
              <div style={{ fontSize: 34 }}>{it.emoji}</div>
              <div style={{ fontFamily: JUA, color: "#1656b8", margin: "6px 0 10px" }}>{it.name}</div>
              <button
                onClick={() => onBuy(it.key)}
                style={{
                  width: "100%",
                  height: 36,
                  border: 0,
                  borderRadius: 999,
                  background: isOwned ? "#c9f2e6" : "#1a9edb",
                  color: isOwned ? "#1e7d6a" : "#fff",
                  fontFamily: JUA,
                  fontSize: 14,
                  cursor: isOwned ? "default" : "pointer",
                }}
              >
                {isOwned ? "보유중 ✓" : `${it.price}🪙 구매`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
