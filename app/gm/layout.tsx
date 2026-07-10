// app/gm/layout.tsx
//
// GM 관리 페이지 인증 가드 (클라이언트 사이드).
//
// 흐름:
//   1) 마운트 시 세션·GM 여부 확인
//   2) 세션 없음 or is_gm=false → 홈("/")으로 replace
//   3) GM 확정 → children 렌더
//   4) 확인 도중엔 로딩 화면 (빈 껍데기 + 스피너 텍스트)
//
// onAuthStateChange 리스너로 세션 도중 로그아웃/GM 회수 상황도 감지 → 즉시 홈으로.
//
// 주의:
//   - 클라이언트 가드라 초기 렌더가 잠깐 노출됨. 지금 규모(25명)엔 문제 없음.
//     실제 데이터 접근은 어차피 RLS + EF가 잡음.
//   - 프론트 리뉴얼 시 이 가드는 그대로 재사용 가능 (로직만 유지).

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isCurrentUserGm } from "@/lib/auth-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

type CheckState = "checking" | "allowed" | "denied";

export default function GmLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<CheckState>("checking");

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        const ok = await isCurrentUserGm();
        if (cancelled) return;

        if (ok) {
          setState("allowed");
        } else {
          setState("denied");
          router.replace("/");
        }
      } catch (e) {
        // 안정성: 확인 실패 시 안전한 쪽(홈으로)으로.
        console.error("[gm/layout] isCurrentUserGm failed:", e);
        if (cancelled) return;
        setState("denied");
        router.replace("/");
      }
    }

    verify();

    // 세션 변경 감지 → GM 여부 재확인.
    // (GM이 다른 탭에서 로그아웃 or 다른 GM이 권한 회수한 경우 등)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;

      if (!session) {
        setState("denied");
        router.replace("/");
        return;
      }
      // 세션은 있는데 GM 여부는 profile 조회 필요 → verify 다시
      verify();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // router는 안정 참조지만 규정상 의존성에 넣지 않음(무한 재실행 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "allowed") {
    return <>{children}</>;
  }

  // checking / denied 공통: 로딩 화면
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={titleStyle}>
          {state === "checking" ? "🔐 확인 중..." : "🚫 접근 불가"}
        </div>
        <div style={bodyStyle}>
          {state === "checking"
            ? "GM 권한을 확인하고 있어요."
            : "홈으로 이동합니다..."}
        </div>
      </div>
    </div>
  );
}

/* ── 스타일 ── */

const containerStyle: CSSProperties = {
  minHeight:       "100vh",
  display:         "flex",
  alignItems:      "center",
  justifyContent:  "center",
  background:      "linear-gradient(180deg, #eaf7fe 0%, #cdeeff 100%)",
  padding:         24,
};

const cardStyle: CSSProperties = {
  maxWidth:     360,
  width:        "100%",
  padding:      "28px 32px",
  background:   "#fff",
  border:       "2px solid #bfe4f7",
  borderRadius: 18,
  boxShadow:    "0 6px 0 rgba(46,163,221,.25)",
  textAlign:    "center",
};

const titleStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     22,
  color:        "#0d6fa8",
  marginBottom: 8,
};

const bodyStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   14,
  color:      "#4a7a99",
};