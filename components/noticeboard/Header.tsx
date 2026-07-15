// components/noticeboard/Header.tsx
//
// NoticeBoard 상단 헤더 = 좌측 로고 + 우측 유틸 바.
//
// 구성:
//   - 좌측: [메인홍] 로고 (스티커 스타일)
//   - 우측 유틸 바:
//     · 코인 뱃지
//     · [비로그인]  로그인 버튼
//       [로그인]    닉네임 뱃지 + (GM이면) GM 관리 링크 + 로그아웃 버튼
//     · 관리자호출 버튼 (토글)
//
// 자체 관리:
//   - useCurrentUser 훅 직접 호출 (부모는 auth 상태 신경 안 씀)
//   - 로그아웃도 내부 처리 (supabase.auth.signOut, onAuthStateChange가 상태 자동 리셋)
//
// Props:
//   - coins:        표시할 코인 수 (부모 관리)
//   - coinRef:      부모의 popCoin/shakeCoin 애니메이션용 ref
//   - onLoginClick: 로그인 버튼 클릭 시 (부모가 AuthModal 오픈)
//   - onAdminClick: 관리자호출 버튼 클릭 시 (부모가 AdminChatOverlay 토글)

"use client";

import type { RefObject } from "react";
import { supabase } from "@/lib/supabase";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import styles from "./Header.module.css";

type Props = {
  coins:        number;
  coinRef:      RefObject<HTMLDivElement | null>;
  onLoginClick: () => void;
  onAdminClick: () => void;
};

export default function Header({ coins, coinRef, onLoginClick, onAdminClick }: Props) {
  const { user, displayName, isGm } = useCurrentUser();

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
        <div ref={coinRef} className={styles.coinBadge}>
          🪙 {coins}
        </div>

        {user ? (
          <>
            <div className={styles.nameBadge}>
              {isGm ? "👑 " : ""}
              {displayName ?? "익명"}
            </div>

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

        <button onClick={onAdminClick} className={styles.adminCallButton}>
          📞 관리자호출
        </button>
      </div>
    </>
  );
}