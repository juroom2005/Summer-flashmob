// components/password-reset/PasswordResetProvider.tsx
//
// password_reset_required 플래그의 전역 상태 관리.
//
// 여러 컴포넌트가 이 플래그를 봄:
//   · GmPasswordResetGate  — 강제 팝업 표시 여부
//   · PasswordResetBanner  — 홈 배너 표시 여부
//   · AccountInfoCard      — 자발 팝업 성공 시 refresh 호출
//
// 각자 조회하면 성공 후 sync 가 안 되므로 Context 로 단일 상태 유지.
//
// auth 변화 대응:
//   · SIGNED_IN / SIGNED_OUT / USER_UPDATED 이벤트마다 재조회
//   · 로그아웃 후 다른 유저 로그인 시 정확히 반영됨

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { getMyPasswordResetRequired } from "@/lib/password-helpers";

type Ctx = {
  /** password_reset_required 플래그 값. 미로그인·오류 시 false. */
  required: boolean;
  /** 초기 로드 중이면 true. UI 는 로드 완료 전엔 아무 것도 표시하지 않는 편이 안전. */
  loading:  boolean;
  /** 강제 재조회. 팝업 성공 시 호출. */
  refresh:  () => Promise<void>;
};

const PasswordResetCtx = createContext<Ctx | null>(null);

export function PasswordResetProvider({ children }: { children: ReactNode }) {
  const [required, setRequired] = useState(false);
  const [loading,  setLoading]  = useState(true);

  const refresh = useCallback(async () => {
    const v = await getMyPasswordResetRequired();
    setRequired(v);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // 초기 조회
    (async () => {
      const v = await getMyPasswordResetRequired();
      if (cancelled) return;
      setRequired(v);
      setLoading(false);
    })();

    // auth 변화 시 재조회
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "USER_UPDATED"
      ) {
        void refresh();
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [refresh]);

  return (
    <PasswordResetCtx.Provider value={{ required, loading, refresh }}>
      {children}
    </PasswordResetCtx.Provider>
  );
}

/**
 * 자식 컴포넌트에서 password_reset 상태 소비.
 * Provider 밖에서 호출하면 예외 (개발 시 실수 방지).
 */
export function usePasswordResetContext(): Ctx {
  const ctx = useContext(PasswordResetCtx);
  if (!ctx) {
    throw new Error("usePasswordResetContext must be used within PasswordResetProvider");
  }
  return ctx;
}