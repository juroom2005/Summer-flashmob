// components/noticeboard/Header.tsx
//
// NoticeBoard 상단 헤더 = 폴더 우상단 유틸 바.
//
// 구성 (좌 → 우):
//   [로그인]    닉네임 버튼(→MyPanel) · (GM이면) GM 관리 · 로그아웃 · X · 마스토돈
//   [비로그인]  로그인 버튼 · X · 마스토돈
//
// ── 2026-08 리뉴얼 (Anima 시안) ──
//   · 재화(코인) 뱃지 제거 — 시안에 없음.
//   · [메인홈] 로고 제거.
//   · X(트위터) / 마스토돈 외부 링크 버튼 신설 (원형 아이콘).
//   · 위치: 폴더 프레임 우상단 위쪽 (utilBar).
//
// 외부 링크:
//   · X        : https://x.com/AYA_mushiba
//   · 마스토돈 : https://project-summer-mas.cloud/explore (사설 인스턴스)
//
// 자체 관리:
//   - useCurrentUser 훅 직접 호출
//   - 로그아웃도 내부 처리 (supabase.auth.signOut, onAuthStateChange가 상태 자동 리셋)
//   - GM 미처리 문의 카운트 조회 + focus/visibility 재조회

"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import { getPendingReportCount } from "@/lib/auth-helpers";
import styles from "./Header.module.css";

// ── 외부 링크 ──────────────────────────────────────────────
const X_URL = "https://x.com/AYA_mushiba";
const MASTODON_URL = "https://project-summer-mas.cloud/explore";
// 마스토돈 링크 임시 비활성화(준비 중). 되살리려면 true 로.
const MASTODON_ENABLED = true;

type Props = {
  onLoginClick:   () => void;
  onMyPanelClick: () => void;
};

export default function Header({ onLoginClick, onMyPanelClick }: Props) {
  const { user, displayName, isGm } = useCurrentUser();
  const [pendingCount, setPendingCount] = useState(0);

  // GM 미처리 문의 카운트 조회.
  // - GM 아닌 유저는 RLS로 SELECT 자체가 막혀서 count=0 반환 → 뱃지 안 뜸.
  // - 다른 탭에서 GM 페이지 방문해 read 마킹된 경우도 반영되도록,
  //   focus/visibility 이벤트에서도 재조회.
  useEffect(() => {
    if (!isGm) {
      setPendingCount(0);
      return;
    }
    let cancelled = false;

    async function refresh() {
      const n = await getPendingReportCount();
      if (!cancelled) setPendingCount(n);
    }

    void refresh();

    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isGm]);

  async function handleLogout() {
    await supabase.auth.signOut();
    // useCurrentUser의 onAuthStateChange가 상태 자동 리셋
  }

  const showGmBadge = isGm && pendingCount > 0;

  return (
    <div className={styles.utilBar}>
      {user ? (
        <>
          <button
            type="button"
            onClick={onMyPanelClick}
            className={styles.nameBadge}
            title="마이 패널 열기"
          >
            {isGm ? "👑 " : ""}
            {displayName ?? "익명"} 님
          </button>

          {isGm ? (
            <a href="/gm" className={styles.gmLink}>
              GM 관리
              {showGmBadge ? (
                <span className={styles.gmBadge}>
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              ) : null}
            </a>
          ) : null}

          <button onClick={handleLogout} className={styles.logoutButton}>
            로그아웃
          </button>
        </>
      ) : (
        <button onClick={onLoginClick} className={styles.loginButton}>
          로그인
        </button>
      )}

      {/* ── 외부 링크 (X · 마스토돈) ── */}
      <a
        href={X_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.iconButton}
        title="X (트위터)"
        aria-label="X (트위터)"
      >
          <svg width="11" height="11" viewBox="0 0 23 22" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0.0551989 0L8.9159 11.8501L0 21.485H2.00719L9.81382 13.0499L16.1208 21.485H22.9501L13.5913 8.96835L21.8906 0L19.8834 0L12.6947 7.76852L6.88583 0L0.05653 0L0.0551989 0ZM3.00607 1.47856L6.14272 1.47856L19.9965 20.0064H16.8598L3.00607 1.47856Z" fill="#383D38"/>
        </svg>
      </a>

      <a
        href={MASTODON_ENABLED ? MASTODON_URL : undefined}
        target={MASTODON_ENABLED ? "_blank" : undefined}
        rel={MASTODON_ENABLED ? "noopener noreferrer" : undefined}
        className={`${styles.iconButton} ${
          MASTODON_ENABLED ? "" : styles.iconButtonDisabled
        }`}
        title={MASTODON_ENABLED ? "마스토돈" : "마스토돈 (준비 중)"}
        aria-label={MASTODON_ENABLED ? "마스토돈" : "마스토돈 (준비 중)"}
        aria-disabled={MASTODON_ENABLED ? undefined : true}
        onClick={MASTODON_ENABLED ? undefined : (e) => e.preventDefault()}
      >
        <svg width="26" height="26" viewBox="0 0 37 37" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M29.5566 20.957C29.1953 22.6914 26.4492 24.5703 23.4141 25.0039C17.1992 25.7988 13.5137 24.5703 13.5137 24.5703C13.7305 25.5098 13.2246 28.4727 18.5723 28.3281C20.8125 28.3281 22.7637 27.8223 22.7637 27.8223L22.9082 29.7734C19.2227 31.5078 15.1758 30.8574 12.791 30.207C7.94922 28.9785 7.08203 23.7031 6.9375 18.5V14.2363C6.9375 8.88868 10.4785 7.29884 10.4785 7.29884C14.0918 5.56446 23.4863 5.70899 26.5215 7.29884C26.5215 7.29884 30.0625 8.88868 30.0625 14.2363C30.0625 14.2363 30.1348 18.2109 29.5566 20.957Z" fill="black"/>
          <path d="M25.8711 14.5977V21.1738H23.3418V14.8145C23.3418 13.5137 22.7637 12.8633 21.6797 12.8633C20.3789 12.8633 19.7285 13.6582 19.7285 15.248V18.6445H17.2715V15.248C17.2715 13.6582 16.6211 12.8633 15.3203 12.8633C14.2363 12.8633 13.6582 13.5137 13.6582 14.8145V21.1738H11.1289V14.5977C11.1289 13.2969 11.4902 10.2617 14.8867 10.2617C17.7051 10.2617 18.5 12.9355 18.5 12.9355C18.5 12.9355 19.2227 10.2617 22.1133 10.2617C25.3652 10.2617 25.8711 13.2969 25.8711 14.5977Z" fill="#CCE3F8"/>
        </svg>
      </a>
    </div>
  );
}