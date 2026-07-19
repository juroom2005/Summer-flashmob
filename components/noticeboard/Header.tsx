// components/noticeboard/Header.tsx
//
// NoticeBoard 상단 헤더 = 좌측 로고 + 우측 유틸 바.
//
// 구성:
//   - 좌측: [메인홍] 로고 (스티커 스타일)
//   - 우측 유틸 바:
//     · [로그인]    코인 뱃지 (mobil) + 닉네임 버튼 (클릭 시 MyPanel 열림)
//                  + (GM이면) GM 관리 링크 + 로그아웃 버튼
//     · [비로그인]  로그인 버튼
//   ※ 관리자호출 버튼은 이 헤더에서 제거됨 → NoticeBoard 좌하단으로 이동
//
// 변경점 (v4 → v5):
//   - GM일 때 GM 관리 링크에 미처리 mismatch 문의 개수 뱃지 오버레이
//   - 마운트 시 + focus/visibility 이벤트 시 카운트 재조회 (탭 전환 대응)
//   - 자체 조회이므로 부모/다른 컴포넌트에 파급 없음
//
// 자체 관리:
//   - useCurrentUser 훅 직접 호출
//   - 로그아웃도 내부 처리 (supabase.auth.signOut, onAuthStateChange가 상태 자동 리셋)

"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import { getPendingReportCount } from "@/lib/auth-helpers";
import styles from "./Header.module.css";

type Props = {
  onLoginClick:   () => void;
  onMyPanelClick: () => void;
};

export default function Header({ onLoginClick, onMyPanelClick }: Props) {
  const { user, displayName, isGm, mobil } = useCurrentUser();
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
    <>
      {/* 좌측 로고 */}
      <div className={styles.logo}>[메인홈]</div>

      {/* 우측 유틸 바 */}
      <div className={styles.utilBar}>
        {user ? (
          <>
            <div className={styles.coinBadge}>
              🪙 {mobil}
            </div>

            <button
              type="button"
              onClick={onMyPanelClick}
              className={styles.nameBadge}
              title="마이 패널 열기"
            >
              {isGm ? "👑 " : ""}
              {displayName ?? "익명"}
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
      </div>
    </>
  );
}