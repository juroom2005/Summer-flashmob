// supabase/functions/gm-reset-user-password/index.ts
//
// GM 전용 · 유저 비밀번호 재설정 EF.
//
// 흐름:
//   1) JWT → auth.getUser()
//   2) GM 검증
//   3) body 파싱: { target_profile_id: uuid }
//   4) 대상 조회 · 안전장치 검사
//   5) 12자리 랜덤 임시 비번 생성
//   6) auth.admin.updateUserById 로 비번 교체
//   7) profiles.password_reset_required = true
//   8) 임시 비번 반환 (한 번만, 서버에 별도 저장 없음)
//
// 안전장치:
//   · shell 유저(auth 계정 없음) 재설정 거부
//   · GM 대상 재설정 거부 (자기 자신 포함)
//   · 자기 자신 재설정 거부 (다른 GM이 해줘야 함)
//
// 응답 코드:
//   200 - 성공 (temp_password 포함)
//   400 - 잘못된 body / shell 대상 / GM 대상 / 자기 자신
//   401 - 인증 실패
//   403 - GM 아님
//   404 - 대상 없음
//   500 - 기타 오류

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * 12자리 임시 비밀번호 생성.
 *
 * 사용 문자셋 (혼동 문자 제외):
 *   · 알파벳 소문자: l, o 제외
 *   · 알파벳 대문자: I, O 제외
 *   · 숫자:         0, 1 제외
 *   · 특수문자는 사용 안 함 (전달 시 오타·이스케이프 사고 방지)
 *
 * crypto.getRandomValues 사용 (Deno 표준 지원).
 * 12자리 × 58 문자 pool = 약 58^12 ≈ 1.5×10^21 조합.
 */
function generateTempPassword(length = 12): string {
  const CHARS =
    "abcdefghijkmnpqrstuvwxyz" +   // 소문자 (l, o 제외)
    "ABCDEFGHJKLMNPQRSTUVWXYZ" +   // 대문자 (I, O 제외)
    "23456789";                     // 숫자 (0, 1 제외)

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let out = "";
  for (let i = 0; i < length; i++) {
    out += CHARS[bytes[i] % CHARS.length];
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl    = Deno.env.get("SUPABASE_URL");
    const anonKey        = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "환경 변수가 누락되었습니다." }, 500);
    }

    /* ── 1) 인증 ── */
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return json({ error: "인증 토큰이 필요합니다." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "인증에 실패하였습니다." }, 401);
    }
    const requesterUserId = userData.user.id;

    /* ── 2) GM 검증 ── */
    const { data: gmProfile, error: gmErr } = await adminClient
      .from("profiles")
      .select("id, is_gm")
      .eq("user_id", requesterUserId)
      .maybeSingle();

    if (gmErr) {
      return json({ error: "프로필 조회에 실패하였습니다." }, 500);
    }
    if (!gmProfile?.is_gm) {
      return json({ error: "GM 권한이 필요합니다." }, 403);
    }

    /* ── 3) body 파싱 ── */
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
    }

    const targetProfileId = (body as Record<string, unknown>).target_profile_id;
    if (typeof targetProfileId !== "string" || !targetProfileId) {
      return json({ error: "target_profile_id가 필요합니다." }, 400);
    }

    /* ── 4) 대상 조회 · 안전장치 ── */
    const { data: target, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, user_id, family_name, given_name, is_gm")
      .eq("id", targetProfileId)
      .maybeSingle();

    if (targetErr) {
      return json({ error: "대상 프로필 조회에 실패하였습니다." }, 500);
    }
    if (!target) {
      return json({ error: "존재하지 않는 유저입니다." }, 404);
    }

    // 자기 자신 재설정 차단
    if (target.id === gmProfile.id) {
      return json(
        { error: "본인의 비밀번호는 마이패널에서 직접 변경해주십시오." },
        400
      );
    }
    // GM 계정은 다른 GM만 재설정 가능하도록 제한 (안전상 GM 대상 자체 차단)
    if (target.is_gm) {
      return json({ error: "GM 계정의 비밀번호는 재설정할 수 없습니다." }, 400);
    }
    // shell 유저(auth 계정 없음) 재설정 불가
    if (!target.user_id) {
      return json(
        { error: "아직 가입하지 않은 유저는 비밀번호 재설정 대상이 아닙니다." },
        400
      );
    }

    /* ── 5) 임시 비번 생성 ── */
    const tempPassword = generateTempPassword(12);

    /* ── 6) auth 비번 교체 ── */
    const { error: updErr } = await adminClient.auth.admin.updateUserById(
      target.user_id,
      { password: tempPassword }
    );

    if (updErr) {
      return json(
        { error: "비밀번호 재설정에 실패하였습니다.", detail: updErr.message },
        500
      );
    }

    /* ── 7) profiles 플래그 세팅 ── */
    const { error: flagErr } = await adminClient
      .from("profiles")
      .update({ password_reset_required: true })
      .eq("id", targetProfileId);

    if (flagErr) {
      // auth 비번은 이미 바뀌었으나 플래그 세팅 실패.
      // 최소한 GM 에게 알려서 수동 대응 여지를 남김.
      return json(
        {
          error: "비밀번호는 변경되었으나 플래그 세팅에 실패하였습니다. Supabase 대시보드에서 확인해주십시오.",
          detail: flagErr.message,
          temp_password: tempPassword,
        },
        500
      );
    }

    /* ── 8) 응답 ── */
    const displayName =
      [target.family_name, target.given_name].filter(Boolean).join(" ") ||
      "(이름 미등록)";

    return json({
      success:       true,
      target: {
        profile_id:   target.id,
        display_name: displayName,
      },
      temp_password: tempPassword,
    });
  } catch (e) {
    return json(
      { error: "처리 중 오류가 발생하였습니다.", detail: String(e) },
      500
    );
  }
});