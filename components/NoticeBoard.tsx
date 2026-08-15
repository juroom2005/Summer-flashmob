// components/NoticeBoard.tsx
// 폰트: Jua · Gowun Dodum · Gaegu (app/layout.tsx 에서 next/font 로 로드)
//
// 변경점 (v8 후속 · 2026-08 리뉴얼):
//   - 시안(Anima) 폴더 구조 도입 → FolderStage 3층(프레임/내지/덮개)으로 교체
//   - 탭 7개 체계: board(대시보드) + 정적 3(notice/system/world) + 동적 3(member/store/daily)
//   - board = 폴더 덮개 + 대시보드, 그 외 = 내지 + 문서
//   - 폴더가 상시 표시되므로 열림/닫힘 개념 제거:
//     · open state, panelVisible/panelClosing/panelExitTimerRef 삭제
//     · ✕ 닫기 버튼, 닫힘 힌트, nb-bookOpen/Close 애니메이션 삭제
//   - 탭 전환 애니메이션: 3D 플립 → 슬라이드(우측에서 슥) 로 교체 (doSlide)
//   - 배경 블러: 폴더 상시 표시이므로 항상 blur
//
// 변경점 (v7):
//   - 출석 커맨드 실기능화 (AttendanceCard 분리, 하루 1회 500 모빌)
//
// 변경점 (v5):
//   - 뷰포트 딱 맞춤 레이아웃 (position: fixed; inset: 0)
//   - 스케일 = min(뷰포트_w / 1366, 뷰포트_h / 768)
//   - 좁은 뷰포트(< 640px)에서는 "PC 접속 권장" 안내 오버레이

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
import DailyPanel from "./noticeboard/panels/DailyPanel";
import StaticDocPanel from "./noticeboard/panels/StaticDocPanel";
import FolderStage from "./noticeboard/FolderStage";
import BoardCover from "./noticeboard/cover/BoardCover";

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

// ═══════════════════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════════════════
export default function NoticeBoard({
  backgroundSrc,
}: {
  backgroundSrc?: string;
}) {
  // ── 상태 ─────────────────────────────────────────────────
  // 폴더는 상시 표시. 기본 탭 = board(대시보드).
  const [tab, setTab] = useState<Tab>("board");
  const [overlay, setOverlay] = useState<Overlay>(null);

  // 관리자호출: 로그인 여부 판정 + 미읽음 뱃지
  const { user: currentUser } = useCurrentUser();
  const { count: adminChatUnread } = useAdminChatBadge({
    chatOpen: overlay === "admin",
  });

  // 시안 상태 — 상점은 실 재화 연동 전까지 시각적 인터랙션만 유지.
  const [flipped, setFlipped] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);

  // 참여명단 위젯 시안 데이터. 이 위젯은 추후 다른 요소로 교체 예정이며,
  // 그 전까지는 하드코딩된 표시만 유지한다.
  const [attendees] = useState<string[]>(["새벽", "라임", "도토"]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 참조 ─────────────────────────────────────────────────
  // 탭 전환 슬라이드 애니메이션 대상 (콘텐츠 래퍼)
  const slideRef = useRef<HTMLDivElement>(null);

  // ── 뷰포트에 맞춰 스케일 계산 (window 크기 관찰) ────────
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

  const showToast = (t: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 1900);
  };

  // ── 애니메이션 헬퍼 ──────────────────────────────────────
  // 탭 전환 시 콘텐츠가 우측에서 슬라이드 인 (+ 페이드). 간결·깔끔.
  const doSlide = () => {
    slideRef.current?.animate?.(
      [
        { transform: "translateX(24px)", opacity: 0 },
        { transform: "translateX(0)",    opacity: 1 },
      ],
      { duration: 260, easing: "cubic-bezier(.25,.8,.3,1)", fill: "backwards" }
    );
  };
  // ── 액션 ─────────────────────────────────────────────────
  const openTab = (key: Tab) => {
    if (tab === key) return;
    setTab(key);
    requestAnimationFrame(doSlide);
  };

  // ── 스테이지 실제 렌더 크기 (스케일 적용 후) ───────────
  const stageRenderedW = STAGE_W * scale;
  const stageRenderedH = STAGE_H * scale;

  const tooNarrow = viewportW > 0 && viewportW < MIN_SUPPORTED_VIEWPORT_W;

  const isBoard = tab === "board";

  // ═══════════════════════════════════════════════════════════
  // 렌더
  // ═══════════════════════════════════════════════════════════
  return (
    <div style={viewportShellStyle}>
      {/* ── 뷰포트 배경 ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: backgroundSrc ? `url(${backgroundSrc})` : undefined,
          backgroundSize: "cover",        
          backgroundPosition: "center",
          backgroundColor: "#f4f8fc",   
          zIndex: 0,
        }}
      />

      {/* 좁은 뷰포트 안내 (임시, 모바일 전용 UI 나오기 전까지) */}
      {tooNarrow ? (
        <div style={narrowNoticeStyle}>
          <div style={narrowNoticeCardStyle}>
            <div style={{ fontFamily: JUA, fontSize: 22, color: "#fff", marginBottom: 8 }}>
              PC 접속 권장
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
          <NavRail activeTab={tab} onTabClick={openTab} />

          {/* ── 폴더 (프레임 + 덮개/내지 + 콘텐츠) ── */}
          <FolderStage isBoard={isBoard}>
            <div ref={slideRef} style={{ height: "100%" }}>
              {tab === "board" ? (
                <BoardCover
                  onOpenLogin={() => setOverlay("login")}
                  onToast={showToast}
                />
              ) : null}
              {tab === "notice" ? <StaticDocPanel docKey="notice" /> : null}
              {tab === "system" ? <StaticDocPanel docKey="system" /> : null}
              {tab === "world"  ? <StaticDocPanel docKey="world"  /> : null}
              {tab === "member" ? (
                <MemberPanel
                  flipped={flipped}
                  onFlip={(name) => setFlipped((f) => (f === name ? null : name))}
                />
              ) : null}
              {tab === "daily" ? (
                <DailyPanel
                  isLoggedIn={!!currentUser}
                  onOpenLogin={() => setOverlay("login")}
                />
              ) : null}
              {tab === "store" ? <ShopPanel /> : null}
            </div>
          </FolderStage>

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
                  {nm} 출석!
                </div>
              ))}
            </div>
          </div>

          {/* ── 관리자호출 버튼 (좌하단) ── */}
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
            관리자호출
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
      <MyPanel open={overlay === "mypanel"} onClose={() => setOverlay(null)} />

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
        <span style={{ fontFamily: JUA, fontSize: 24, color: "#0d6fa8" }}>멤버</span>
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