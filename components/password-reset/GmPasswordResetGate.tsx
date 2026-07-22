// components/password-reset/GmPasswordResetGate.tsx
//
// 강제 팝업 컨트롤러 (layout 마운트).
//
// 표시 조건:
//   · password_reset_required === true
//   · 아직 이번 세션에서 dismiss 하지 않음
//   · 로딩 중 아님
//
// dismiss 관리:
//   · sessionStorage 사용 (탭 닫으면 사라짐 = 다음 로그인 시 다시 뜸)
//   · key 는 유저별로 분리 (다른 유저 로그인 시 이전 dismiss 무효)
//
// 팝업 자체는 forced=true 로 PasswordChangePopup 재사용.
// 성공 시 refresh() 호출 → Context 의 required=false → 자연 언마운트.

"use client";

import { useCallback, useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth-helpers";
import { usePasswordResetContext } from "./PasswordResetProvider";
import PasswordChangePopup from "@/components/noticeboard/panels/PasswordChangePopup";

const DISMISS_KEY_PREFIX = "pw-reset-dismissed";

export default function GmPasswordResetGate() {
  const { required, loading, refresh } = usePasswordResetContext();

  const [dismissed, setDismissed] = useState(false);
  const [userId,    setUserId]    = useState<string | null>(null);

  // 유저 id 파악 + 해당 유저의 dismiss 상태 로드.
  // required 가 바뀔 때마다 재실행 (auth 변화 대응)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (cancelled) return;

      if (!user) {
        setUserId(null);
        setDismissed(false);
        return;
      }

      setUserId(user.id);

      // sessionStorage 접근은 브라우저 한정
      if (typeof window !== "undefined") {
        const stored = window.sessionStorage.getItem(
          `${DISMISS_KEY_PREFIX}:${user.id}`
        );
        setDismissed(stored === "1");
      }
    })();
    return () => { cancelled = true; };
  }, [required]);

  const handleClose = useCallback(() => {
    setDismissed(true);
    if (userId && typeof window !== "undefined") {
      window.sessionStorage.setItem(`${DISMISS_KEY_PREFIX}:${userId}`, "1");
    }
  }, [userId]);

  const handleSuccess = useCallback(() => {
    // 성공 시엔 sessionStorage 도 정리 (다음 로그인 시에도 흔적 없이)
    if (userId && typeof window !== "undefined") {
      window.sessionStorage.removeItem(`${DISMISS_KEY_PREFIX}:${userId}`);
    }
    void refresh();
  }, [userId, refresh]);

  if (loading)   return null;
  if (!required) return null;
  if (dismissed) return null;

  return (
    <PasswordChangePopup
      forced={true}
      onClose={handleClose}
      onSuccess={handleSuccess}
    />
  );
}