// components/NoticeBoard.tsx
// 폰트: Jua · Gowun Dodum · Gaegu (app/layout.tsx 에서 next/font 로 로드)
//
// 변경점 (v7 후속):
//   - 출석 커맨드 실기능화 (AttendanceCard 분리, 하루 1회 500 모빌)
//     · 카드 실기능은 AttendanceCard가 담당
//     · 커맨드 카드의 닉네임 입력과 시안 attend 로직 제거
//     · 참여명단 위젯은 시안 유지 (추후 다른 요소로 교체 예정)
//
// 변경점 (v5):
//   - 뷰포트 딱 맞춤 레이아웃 (position: fixed; inset: 0)
//   - 스케일 = min(뷰포트_w / 1366, 뷰포트_h / 768) — 가로/세로 둘 다 봐서 항상 뷰포트 안에 들어감
//   - 스테이지 바깥 여백은 그라디언트로 채움 (스테이지 배경과 이어지는 톤)
//   - 좁은 뷰포트(< 640px)에서는 "PC 접속 권장" 안내 오버레이 (모바일 전용 UI는 §추후)
//   - 페이지 스크롤 발생하지 않음 → 관리자호출·NOW PLAYING 등 하단 UI 항상 보임
//
// 기존 시안 로직(미션·상점 시각 인터랙션만)은 그대로 유지.

"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import AdminChatOverlay from "./admin-chat/AdminChatOverlay";
import ShopPanel from "./noticeboard/panels/ShopPanel";
import { useAdminChatBadge } from "./admin-chat/useAdminChatBadge";
import AuthModal from "./auth/AuthModal";
import { useCurrentUser } from "./shared/useCurrentUser";
import Header from "./noticeboard/Header";
import NavRail, { type Tab } from "./noticeboard/NavRail";
import MyPanel from "./noticeboard/panels/MyPanel";
import AttendanceCard from "./noticeboard/panels/AttendanceCard";
import NoticeBoardList from "./noticeboard/panels/NoticeBoardList";

// ── 폰트 상수 ──────────────────────────────────────────────
const JUA = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY = "'Gowun Dodum', sans-serif";

// ── 스테이지 원본 크기 ─────────────────────────────────────
const STAGE_W = 1366;
const STAGE_H = 768;

// 이 폭 미만은 모바일로 간주 → 안내 오버레이 (모바일 전용 UI 나오기 전 임시)
const MIN_SUPPORTED_VIEWPORT_W = 640;

// ── 통합문서 URL (구글 문서) ───────────────────────────────
// TODO: 실제 URL 로 교체할 것. 하드코딩 방식이며 코드 배포로 갱신한다.
const INTEGRATED_DOC_URL = "#";

// ── 타입 ──────────────────────────────────────────────────
type Overlay = null | "login" | "register" | "admin" | "mypanel";

type Mission = { t: string; r: number; done: boolean };
type Member = {
  name: string;
  emoji: string;
  role: string;
  rc: string;
  border: string;
  back: string;
};

// ── 정적 데이터 ────────────────────────────────────────────

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

  // 관리자호출: 로그인 여부 판정 + 미읽음 뱃지
  const { user: currentUser } = useCurrentUser();
  const { count: adminChatUnread } = useAdminChatBadge({
    chatOpen: overlay === "admin",
  });

  const [panelVisible, setPanelVisible] = useState(false);
  const [panelClosing, setPanelClosing] = useState(false);
  const panelExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 시안 상태 — 미션·상점은 실 재화 연동 전까지 시각적 인터랙션만 유지.
  const [missions, setMissions] = useState<Mission[]>(INITIAL_MISSIONS);
  const [flipped, setFlipped] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);

  // 참여명단 위젯 시안 데이터. 이 위젯은 추후 다른 요소로 교체 예정이며,
  // 그 전까지는 하드코딩된 표시만 유지한다.
  const [attendees] = useState<string[]>(["새벽", "라임", "도토"]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 참조 ─────────────────────────────────────────────────
  const flipRef = useRef<HTMLDivElement>(null);
  const PANEL_ANIM_MS = 300;

  // ── 뷰포트에 맞춰 스케일 계산 (window 크기 관찰) ────────
  //
  // 가로·세로 둘 다 봐서 min 을 취함:
  //   - 가로 스케일이 병목이면 세로에 여백
  //   - 세로 스케일이 병목이면 가로에 여백
  // 어느 쪽이든 스테이지 전체가 뷰포트에 들어감 → 스크롤 없음.
  //
  // viewportW 를 함께 저장해 좁은 뷰포트에서 모바일 안내 분기.
  const [scale, setScale] = useState(1);
  const [viewportW, setViewportW] = useState(0);
  useLayoutEffect(() => {
    function recompute() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setViewportW(vw);
      const s = Math.min(vw / STAGE_W, vh / STAGE_H);
      setScale(s > 0 ? s : 1);
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);


  // ── 토스트 정리 ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);


  useEffect(() => {
  if (open) {
    if (panelExitTimerRef.current) {
      clearTimeout(panelExitTimerRef.current);
      panelExitTimerRef.current = null;
    }
    setPanelVisible(true);
    setPanelClosing(false);
  } else if (panelVisible) {
    setPanelClosing(true);
    panelExitTimerRef.current = setTimeout(() => {
      setPanelVisible(false);
      setPanelClosing(false);
      panelExitTimerRef.current = null;
    }, PANEL_ANIM_MS);
  }
  return () => {
    if (panelExitTimerRef.current) {
      clearTimeout(panelExitTimerRef.current);
      panelExitTimerRef.current = null;
    }
  };
  }, [open, panelVisible]);


  const showToast = (t: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 1900);
  };

  // ── 애니메이션 헬퍼 ──────────────────────────────────────
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
    // 시안: 체크 상태만 토글, 실 재화 변경 없음
    setMissions((prev) => prev.map((m, j) => (j === i ? { ...m, done: !m.done } : m)));
  };

  // ── 파생값 ───────────────────────────────────────────────
  const doneCount = missions.filter((m) => m.done).length;
  const progressPct = Math.round((doneCount / missions.length) * 100);
  const allDone = missions.every((m) => m.done);

  // ── 스테이지 실제 렌더 크기 (스케일 적용 후) ───────────
  const stageRenderedW = STAGE_W * scale;
  const stageRenderedH = STAGE_H * scale;

  const tooNarrow = viewportW > 0 && viewportW < MIN_SUPPORTED_VIEWPORT_W;

  // ═══════════════════════════════════════════════════════════
  // 렌더
  // ═══════════════════════════════════════════════════════════
  return (
    <div style={viewportShellStyle}>
      {/* ── 뷰포트 배경 (이미지를 화면에 늘려 채움) ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: backgroundSrc ? `url(${backgroundSrc})` : undefined,
          backgroundSize: "100% 100%",   // 종횡비 무시하고 화면 꽉 채움 (뭉개짐 감수)
          backgroundColor: "#7cc9f2",     // 이미지 없을 때 fallback
          zIndex: 0,
          // 패널 열렸을 때 블러 (transition으로 자연스러운 적용)
          filter: open ? "blur(8px)" : "none",
          transition: "filter 0.35s ease",
        }}
      />

      {/* 좁은 뷰포트 안내 (임시, 모바일 전용 UI 나오기 전까지) */}
      {tooNarrow ? (
        <div style={narrowNoticeStyle}>
          <div style={narrowNoticeCardStyle}>
            <div style={{ fontFamily: JUA, fontSize: 22, color: "#fff", marginBottom: 8 }}>
              🖥️ PC 접속 권장
            </div>
            <div style={{ fontFamily: BODY, fontSize: 14, color: "rgba(255,255,255,.85)", lineHeight: 1.6 }}>
              현재 화면이 좁아 UI가 정상적으로 보이지 않을 수 있습니다.
              PC나 태블릿 가로 모드에서 접속 바랍니다.
              <br />
              모바일 전용 화면은 추후 지원 예정입니다.
            </div>
          </div>
        </div>
      ) : null}

      {/* ── 스테이지 (1366×768 원본 → scale 적용, 중앙 정렬) ── */}
      <div
        style={{
          position: "absolute",
          left: `calc(50% - ${stageRenderedW / 2}px)`,
          top:  `calc(50% - ${stageRenderedH / 2}px)`,
          width: stageRenderedW,
          height: stageRenderedH,
          overflow: "hidden",
          // 프레임감 제거: 그림자·모서리 없음
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: STAGE_W,
            height: STAGE_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            fontFamily: BODY,
            color: "#14406f",
          }}
        >

          {/* ── 상단 헤더 ── */}
            <Header
              onLoginClick={() => setOverlay("login")}
              onMyPanelClick={() =>
                setOverlay((prev) => (prev === "mypanel" ? null : "mypanel"))
              }
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

          {/* ── 관리자호출 버튼 (좌하단 · 참여명단 겹침 감수, z-index 우선) ── */}
          {/* 미로그인 시: 오버레이 대신 로그인 모달을 열어 진입 통제 */}
          {/* 뱃지: 유저=미읽음 메시지 수 / GM=미읽음 방 수 */}
          <button
            onClick={() => {
              if (!currentUser) {
                setOverlay("login");
                return;
              }
              setOverlay((prev) => (prev === "admin" ? null : "admin"));
            }}
            style={{
              position: "absolute",
              left: 24,
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
              zIndex: 20,
              cursor: "pointer",
              transition: "transform .15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            📞 관리자호출
            {adminChatUnread > 0 ? (
              <span
                style={{
                  minWidth: 19,
                  height: 19,
                  padding: "0 6px",
                  borderRadius: 999,
                  background: "#e5484d",
                  color: "#fff",
                  fontFamily: JUA,
                  fontSize: 11,
                  lineHeight: "19px",
                  textAlign: "center",
                  boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                }}
              >
                {adminChatUnread > 99 ? "99+" : adminChatUnread}
              </span>
            ) : null}
          </button>


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
          {panelVisible ? (
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
                animation: panelClosing
                ? "nb-bookClose .3s cubic-bezier(.5,.15,.85,.3) both"
                : "nb-bookOpen .3s cubic-bezier(.2,.85,.2,1) both",
                backgroundImage:
                  "repeating-linear-gradient(180deg,transparent,transparent 31px,rgba(46,163,221,.1) 31px,rgba(46,163,221,.1) 32px)",
                willChange: "clip-path, opacity",
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
                    onOpenLogin={() => setOverlay("login")}
                    onToast={showToast}
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
                  <ShopPanel />
                ) : null}
              </div>
            </div>
          ) : null}

          
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
         {/* ── 마이 패널 (뷰포트 우측 서랍, 스테이지 밖) ── */}
      <MyPanel
        open={overlay === "mypanel"}
        onClose={() => setOverlay(null)}
      />

      {/* ── 로그인·가입 모달 ── */}
            <AuthModal
              open={overlay === "login" || overlay === "register"}
              initialTab={overlay === "register" ? "register" : "login"}
              onClose={() => setOverlay(null)}
            />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 뷰포트 셸 & 배경 스타일
// ═══════════════════════════════════════════════════════════

// 뷰포트 전체를 덮는 최상위 컨테이너 (fixed로 body 스크롤과 무관)
const viewportShellStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  overflow: "hidden",
};

// 모바일 안내 오버레이 (스테이지 위, 뷰포트 전체 덮음)
const narrowNoticeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(20, 40, 90, 0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 24,
};

const narrowNoticeCardStyle: CSSProperties = {
  maxWidth: 360,
  padding: "24px 28px",
  background: "rgba(20, 64, 111, 0.92)",
  border: "2px solid rgba(255,255,255,.35)",
  borderRadius: 16,
  textAlign: "center",
  boxShadow: "0 20px 40px rgba(0,0,0,.35)",
};

// ═══════════════════════════════════════════════════════════
// 서브 패널
// ═══════════════════════════════════════════════════════════

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
  onOpenLogin,
  onToast,
}: {
  onOpenLogin: () => void;
  onToast: (msg: string) => void;
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
        <span style={{ fontFamily: JUA, fontSize: 26, color: "#0d6fa8" }}>📌 보드</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 288px", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <NoticeBoardList />

          <AttendanceCard onOpenLogin={onOpenLogin} onToast={onToast} />
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

          <a
            href={INTEGRATED_DOC_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              background: "#c9f2e6",
              border: "2px solid #8fdcc7",
              borderRadius: "4px 4px 14px 14px",
              padding: "14px 16px",
              textAlign: "center",
              textDecoration: "none",
              color: "#1e7d6a",
              transform: "rotate(1deg)",
              boxShadow: "0 3px 0 rgba(79,167,140,.35)",
            }}
          >
            <div
              style={{
                fontFamily: GAEGU,
                fontWeight: 700,
                fontSize: 17,
                lineHeight: 1.3,
              }}
            >
              통합문서 확인하기 ↗
            </div>
            <div
              style={{
                fontFamily: BODY,
                fontSize: 11,
                color: "#4e9c85",
                marginTop: 4,
              }}
            >
              공지 · 세계관 · 시스템
            </div>
          </a>
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
          체크는 시각적 표시만 (실 재화 연동 예정)
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