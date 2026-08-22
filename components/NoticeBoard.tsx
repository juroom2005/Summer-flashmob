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
import { type Tab } from "./noticeboard/NavRail";
import AdminCallButton from "./noticeboard/AdminCallButton";
import MyPanel from "./noticeboard/panels/MyPanel";
import DailyPanel from "./noticeboard/panels/DailyPanel";
import NoticeDocPanel from "./noticeboard/panels/NoticeDocPanel";
import NoticeNavRail from "./noticeboard/panels/NoticeNavRail";
import WorldDocPanel from "./noticeboard/panels/WorldDocPanel";
import WorldNavRail from "./noticeboard/panels/WorldNavRail";
import SystemPanel from "./noticeboard/panels/SystemPanel";
import MemberPanel from "./noticeboard/panels/MemberPanel";
import FolderStage from "./noticeboard/FolderStage";
import BoardCover from "./noticeboard/cover/BoardCover";
import SideWidgets from "./noticeboard/widgets/SideWidgets";
import NowPlayingDock from "./noticeboard/widgets/NowPlayingDock";
import DailyBoardOverlay from "./noticeboard/daily-board/DailyBoardOverlay";

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
type Overlay = null | "login" | "register" | "admin" | "mypanel" | "dailyboard";

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

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 참조 ─────────────────────────────────────────────────
  // 탭 전환 슬라이드 애니메이션 대상 (콘텐츠 래퍼)
  const slideRef = useRef<HTMLDivElement>(null);

  // ── 뷰포트에 맞춰 스케일 계산 (window 크기 관찰) ────────
  const [scale, setScale] = useState(1);
  const [viewportW, setViewportW] = useState(0);
  // 좁은 폭 안내 배너 닫힘 여부 (완전 차단이 아니라 안내만)
  const [narrowNoticeDismissed, setNarrowNoticeDismissed] = useState(false);
  useLayoutEffect(() => {
    function recompute() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setViewportW(vw);
      // 좁은 폭(모바일): 폭에만 꽉 맞추고 세로는 스크롤로 흐르게 한다.
      //   → 글자가 최대한 크게 유지되고, 스테이지가 세로로 길어짐.
      // 넓은 폭(데스크톱/태블릿 가로): 기존대로 폭·높이 중 작은 쪽에 맞춰
      //   화면 안에 통째로 들어오게 한다.
      const s =
        vw < MIN_SUPPORTED_VIEWPORT_W
          ? vw / STAGE_W
          : Math.min(vw / STAGE_W, vh / STAGE_H);
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
  // 탭 전환 시 콘텐츠 전환 효과.
  //   · board 로 갈 때  : 페이드만(opacity). board 는 덮개 영역이 내지보다
  //     넓어(left/width 가 다름) 가로 슬라이드를 걸면 그 좌우 점프와 겹쳐
  //     "아래-오른쪽 대각선으로 쑥 몰렸다 퍼지는" 덜컹거림이 났음. 페이드로 회피.
  //   · 그 외 탭        : 우측에서 슬라이드 인(+페이드). 문서 전환에 자연스러움.
  const runTransition = (toBoard: boolean) => {
    // OS "동작 줄이기"가 켜져 있으면 전환 애니메이션을 생략한다.
    // element.animate() 는 CSS @media (prefers-reduced-motion) 로 못 막으므로
    // 여기서 matchMedia 로 직접 확인한다. (globals.css 의 CSS 애니메이션 차단과 짝)
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const keyframes = toBoard
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: "translateX(24px)", opacity: 0 },
          { transform: "translateX(0)",    opacity: 1 },
        ];
    slideRef.current?.animate?.(keyframes, {
      // 모션 최소화 시 1ms(사실상 즉시). fill:backwards 로 최종 상태는 그대로 적용됨.
      duration: reduceMotion ? 1 : 260,
      easing: "cubic-bezier(.25,.8,.3,1)",
      fill: "backwards",
    });
  };
  // ── 액션 ─────────────────────────────────────────────────
  const openTab = (key: Tab) => {
    if (tab === key) return;
    setTab(key);
    requestAnimationFrame(() => runTransition(key === "board"));
  };

  // ── 스테이지 실제 렌더 크기 (스케일 적용 후) ───────────
  const stageRenderedW = STAGE_W * scale;
  const stageRenderedH = STAGE_H * scale;

  // 좁은 폭: 완전 차단하지 않고 폭에 맞춰 세로 스크롤로 사용 가능하게 한다.
  const isNarrow = viewportW > 0 && viewportW < MIN_SUPPORTED_VIEWPORT_W;
  // 안내 배너 노출 = 좁은 폭 && 아직 닫지 않음.
  const showNarrowNotice = isNarrow && !narrowNoticeDismissed;

  // 셸: 좁은 폭에서는 세로 스크롤 허용(스테이지가 세로로 길어짐).
  const shellStyle: CSSProperties = isNarrow
    ? { ...viewportShellStyle, overflowY: "auto", overflowX: "hidden" }
    : viewportShellStyle;

  // 스테이지 바깥 래퍼: 넓은 폭=중앙 고정, 좁은 폭=상단 정렬 문서 흐름.
  const stageWrapStyle: CSSProperties = isNarrow
    ? {
        position: "relative",
        width: stageRenderedW,
        height: stageRenderedH,
        margin: "0 auto",
        overflow: "hidden",
      }
    : {
        position: "absolute",
        left: `calc(50% - ${stageRenderedW / 2}px)`,
        top: `calc(50% - ${stageRenderedH / 2}px)`,
        width: stageRenderedW,
        height: stageRenderedH,
        overflow: "hidden",
      };

  const isBoard = tab === "board";

  // ═══════════════════════════════════════════════════════════
  // 렌더
  // ═══════════════════════════════════════════════════════════
  return (
    <div style={shellStyle}>
      {/* ── 뷰포트 배경 ── */}
      <div
        style={{
          // 좁은 폭에선 셸이 스크롤되므로 배경은 fixed 로 뷰포트에 고정.
          position: isNarrow ? "fixed" : "absolute",
          inset: 0,
          backgroundImage: backgroundSrc ? `url(${backgroundSrc})` : undefined,
          backgroundSize: "cover",        
          backgroundPosition: "center",
          backgroundColor: "#f4f8fc",   
          zIndex: 0,
        }}
      />

      {/* 좁은 뷰포트 안내 배너 (완전 차단 아님 — 닫고 그대로 사용 가능) */}
      {showNarrowNotice ? (
        <div style={narrowNoticeStyle} role="status">
          <div style={{ fontFamily: BODY, fontSize: 13, lineHeight: 1.5, flex: 1 }}>
            모바일은 임시 지원 중입니다. 가로 모드나 PC에서 더 편하게 이용할 수 있어요.
          </div>
          <button
            type="button"
            onClick={() => setNarrowNoticeDismissed(true)}
            aria-label="안내 닫기"
            style={narrowNoticeCloseStyle}
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* ── 스테이지 (1366×768 원본 → scale 적용) ──
          넓은 폭: 화면 중앙 고정 · 좁은 폭: 상단 정렬 + 세로 스크롤 ── */}
      <div style={stageWrapStyle}>
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

          {/* ── 폴더 (프레임 + 북마크 + 덮개/내지 + 콘텐츠) ──
              좌측 북마크(NavRail)는 FolderStage 안으로 이동:
              프레임 앞·내지 뒤(시안 겹침)에 껴야 하므로 같은 쌓임 맥락 필요. */}
          <FolderStage isBoard={isBoard} activeTab={tab} onTabClick={openTab}>
            <div ref={slideRef} style={{ height: "100%" }}>
              {tab === "board" ? (
                <BoardCover
                  onOpenLogin={() => setOverlay("login")}
                  onToast={showToast}
                />
              ) : null}
              {tab === "notice" ? <NoticeDocPanel /> : null}
              {tab === "system" ? <SystemPanel /> : null}
              {tab === "world"  ? <WorldDocPanel /> : null}
              {tab === "member" ? <MemberPanel /> : null}
              {tab === "daily" ? (
                <DailyPanel
                  isLoggedIn={!!currentUser}
                  onOpenLogin={() => setOverlay("login")}
                />
              ) : null}
              {tab === "store" ? <ShopPanel /> : null}
            </div>
          </FolderStage>

          {/* ── NOTICE 탭 내비게이터 (폴더 오른쪽 바깥) ──
              폴더는 left:365 + width:780 = 오른쪽 끝 1145.
              그 바깥 여유(1145~1366)에 세로 바를 띄운다.
              본문(폴더 안)과 DOM 분리되어 있어 NoticeNavRail 이
              섹션 id 로 직접 스크롤·관찰한다. */}
          {tab === "notice" ? (
            <NoticeNavRail style={{ left: 1160, top: 300 }} />
          ) : null}
          {tab === "world" ? (
            <WorldNavRail style={{ left: 1160, top: 280 }} />
          ) : null}

          {/* ── 좌측 사이드 위젯 (연습일지·날씨) ── */}
          <SideWidgets onPracticeLog={() => setOverlay("dailyboard")} />
          {/* ── 관리자호출(채팅 문의) 버튼 (좌하단) ── */}
          <AdminCallButton
            unread={adminChatUnread}
            onClick={() => {
              if (!currentUser) {
                setOverlay("login");
                return;
              }
              setOverlay((prev) => (prev === "admin" ? null : "admin"));
            }}
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

      {/* ── 마이 패널 (뷰포트 우측 서랍, 스테이지 밖) ── */}
      <MyPanel open={overlay === "mypanel"} onClose={() => setOverlay(null)} />

      {/* ── 연습일지 (공용 데일리 보드) 오버레이 ── */}
      <DailyBoardOverlay
        open={overlay === "dailyboard"}
        onClose={() => setOverlay(null)}
        onOpenLogin={() => setOverlay("login")}
        isLoggedIn={!!currentUser}
      />

      {/* ── Now Playing 도크 (뷰포트 오른쪽 아래 고정, hover 슬라이드) ──
          스테이지 밖 = 스케일 영향 안 받고 항상 화면 오른쪽 아래에 붙음.
          파묻힌 부분은 화면 바닥 밖으로 나감. */}
      <NowPlayingDock />

      {/* ── 로그인·가입 모달 ── */}
      <AuthModal
        open={overlay === "login" || overlay === "register"}
        initialTab={overlay === "register" ? "register" : "login"}
        onClose={() => setOverlay(null)}
      />

      {/* ── 전역 푸터 (스테이지 밖, 뷰포트 하단 중앙 고정) ──
          스케일 영향 안 받음. 개인정보 처리 안내 상시 노출용.
          컨테이너는 클릭 통과(pointerEvents:none), 링크만 클릭 가능. */}
      <footer style={globalFooterStyle}>
        <a href="/privacy" style={globalFooterLinkStyle}>개인정보 처리 안내</a>
      </footer>
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
  // overflow(shorthand) 대신 축별로 분리 — 좁은 폭에서 overflowY 만 덮어쓸 때
  // shorthand/non-shorthand 혼용 경고를 피하기 위함.
  overflowX: "hidden",
  overflowY: "hidden",
};

// 전역 푸터: 뷰포트 하단 중앙 고정. 스테이지 스케일 밖.
// 컨테이너는 클릭 통과, 링크만 클릭되게 pointerEvents 를 나눠 지정.
const globalFooterStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 8,
  display: "flex",
  justifyContent: "center",
  pointerEvents: "none",
  zIndex: 40,
};

const globalFooterLinkStyle: CSSProperties = {
  pointerEvents: "auto",
  fontFamily: BODY,
  fontSize: 11,
  color: "#14406f",
  opacity: 0.55,
  textDecoration: "none",
  padding: "4px 10px",
};

// 모바일 안내 배너 (상단 고정 · 화면을 덮지 않음 · 닫기 가능)
const narrowNoticeStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  background: "rgba(20, 64, 111, 0.94)",
  color: "rgba(255,255,255,.92)",
  boxShadow: "0 2px 10px rgba(0,0,0,.25)",
  zIndex: 1000,
};

const narrowNoticeCloseStyle: CSSProperties = {
  flex: "0 0 auto",
  width: 28,
  height: 28,
  border: "none",
  borderRadius: 8,
  background: "rgba(255,255,255,.15)",
  color: "#fff",
  fontSize: 14,
  cursor: "pointer",
  lineHeight: 1,
};