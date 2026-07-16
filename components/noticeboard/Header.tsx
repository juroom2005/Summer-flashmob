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
//     (MyPanel 서랍이 우측에서 열릴 때 가리지 않도록)
//
// 자체 관리:
//   - useCurrentUser 훅 직접 호출 (부모는 auth 상태 신경 안 씀)
//   - 로그아웃도 내부 처리 (supabase.auth.signOut, onAuthStateChange가 상태 자동 리셋)
//
// Props:
//   - onLoginClick:   로그인 버튼 클릭 시 (부모가 AuthModal 오픈)
//   - onMyPanelClick: 닉네임 버튼 클릭 시 (부모가 MyPanel 토글)

"use client";

import { supabase } from "@/lib/supabase";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import styles from "./Header.module.css";

type Props = {
  onLoginClick:   () => void;
  onMyPanelClick: () => void;
};

export default function Header({ onLoginClick, onMyPanelClick }: Props) {
  const { user, displayName, isGm, mobil } = useCurrentUser();

  async function handleLogout() {
    await supabase.auth.signOut();
    // useCurrentUser의 onAuthStateChange가 상태 자동 리셋
  }

  return (
    <>
      {/* 좌측 로고 */}
      <div className={styles.logo}>[메인홍]</div>

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