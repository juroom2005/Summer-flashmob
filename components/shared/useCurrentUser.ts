// components/shared/useCurrentUser.ts
//
// 현재 로그인 유저의 auth + profile 상태를 관리하는 훅.
//
// 반환:
//   - user:        Supabase User | null (auth.users)
//   - displayName: string | null (family_name + " " + given_name, 또는 null)
//   - isGm:        boolean
//   - mobil:       number (profiles.mobil, 재화. 로그인 안 됐거나 shell 미연결이면 0)
//   - loading:     초기 조회 or 세션 변경 중 재조회 상태
//
// 특징:
//   1) supabase.auth.onAuthStateChange 구독으로 세션 변화 자동 반영
//   2) profile 조회 재시도 로직 (신규 가입 직후 race 대응)
//      - profile row 없거나 이름 미채움 (GM 아닌 경우) → 500ms × 최대 5회
//   3) unmount·세션 변경 시 cancelled 플래그로 stale 콜백 안전 취소
//
// 사용처:
//   - NoticeBoard 헤더 (displayName·isGm·mobil 표시, MyPanel 트리거)
//
// 주의:
//   각 컴포넌트에서 이 훅을 호출하면 그 컴포넌트별로 독립 구독 발생.
//   앱 전체에서 하나만 유지하고 싶어지면 나중에 Context로 감싸기.
//
//   mobil은 헤더 표시용 캐시. MyPanel은 열릴 때마다 getMyPanelProfile로 별도 fetch
//   하므로 헤더 mobil과 MyPanel mobil이 잠시 불일치할 수 있음. 실서비스 진입 후
//   재화 CRUD가 붙으면 이 훅을 Context로 승격 + refetch 트리거 붙일 예정.

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type CurrentUserState = {
  user:        User | null;
  displayName: string | null;
  isGm:        boolean;
  mobil:       number;
  loading:     boolean;
};

const RETRY_MAX      = 5;
const RETRY_INTERVAL = 500;

export function useCurrentUser(): CurrentUserState {
  const [user,        setUser]        = useState<User | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isGm,        setIsGm]        = useState(false);
  const [mobil,       setMobil]       = useState(0);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(userId: string, attempt = 1) {
      const { data } = await supabase
        .from("profiles")
        .select("family_name, given_name, is_gm, mobil")
        .eq("user_id", userId)
        .maybeSingle();

      if (cancelled) return;

      // 재시도 조건:
      //   - profile row 자체 없음 (register-user 진행 중일 가능성)
      //   - GM 아닌데 이름 미채움 (매우 드문 상태, register 중간 실패 케이스)
      // GM은 family_name/given_name null이 정상이라 재시도 대상 제외.
      const shouldRetry =
        data === null ||
        (!data.is_gm && (!data.family_name || !data.given_name));

      if (shouldRetry && attempt < RETRY_MAX) {
        setTimeout(() => {
          if (!cancelled) loadProfile(userId, attempt + 1);
        }, RETRY_INTERVAL);
        return;
      }

      // 최종 결과 반영
      const fullName = data && data.family_name && data.given_name
        ? `${data.family_name} ${data.given_name}`
        : null;

      setDisplayName(fullName);
      setIsGm(data?.is_gm === true);
      setMobil(typeof data?.mobil === "number" ? data.mobil : 0);
      setLoading(false);
    }

    // 초기 세션 조회
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const u = data.user ?? null;
      setUser(u);
      if (u) {
        loadProfile(u.id);
      } else {
        setDisplayName(null);
        setIsGm(false);
        setMobil(0);
        setLoading(false);
      }
    });

    // 세션 변경 구독
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        setLoading(true);
        loadProfile(u.id);
      } else {
        setDisplayName(null);
        setIsGm(false);
        setMobil(0);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, displayName, isGm, mobil, loading };
}