// supabase/functions/generate-invite/index.ts
//
// GM이 초대코드 발급하는 EF (v2 — 이름 스키마 분리 반영).
//
// 변경점 (v1 → v2):
//   - 요청 body: character_name → family_name, given_name
//   - 검증: 성·이름 각각 필수, 각각 빈 문자열 방지
//   - RPC 파라미터: p_character_name → p_family_name, p_given_name
//   - character_name UNIQUE 위반 처리 제거 (동명이인 허용 정책)
//   - 프로필 조회 실패 시 detail 노출 patch 원복 (디버깅 완료)
//
// 흐름:
//   1) Authorization 헤더에서 JWT → auth.getUser()로 user_id 확보
//   2) GM 검증 + issued_by에 쓸 profile.id 확보 (service_role)
//   3) body 파싱 및 검증
//   4) 코드 생성 (XXXX-XXXX-XXXX)
//   5) RPC generate_invite_with_shell 호출 (원자적 shell + invite 생성)

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl    = Deno.env.get("SUPABASE_URL");
    const anonKey        = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "환경 변수 누락" }, 500);
    }

    // 1) Authorization 헤더에서 JWT 추출
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return json({ error: "인증 토큰이 필요합니다." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // 2) 유저 확인
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "인증 실패" }, 401);
    }
    const userId = userData.user.id;

    // 3) GM 검증 + GM의 profile.id 확보 (issued_by에 사용)
    const { data: gmProfile, error: gmErr } = await adminClient
      .from("profiles")
      .select("id, is_gm")
      .eq("user_id", userId)
      .maybeSingle();

    if (gmErr) {
      return json({ error: "프로필 조회 실패" }, 500);
    }
    if (!gmProfile || !gmProfile.is_gm) {
      return json({ error: "GM 권한이 필요합니다." }, 403);
    }
    const gmProfileId = gmProfile.id;

    // 4) body 파싱
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "요청 형식이 잘못됐습니다." }, 400);
    }

    const {
      family_name,
      given_name,
      age,
      gender,
      school_name,
      grade,
      expires_in_days = 7,
      invitee_note,
    } = body as Record<string, unknown>;

    // 5) 이름 필드 검증 (성·이름 각각)
    if (typeof family_name !== "string" || !family_name.trim()) {
      return json({ error: "성을 입력하세요." }, 400);
    }
    const familyTrim = family_name.trim();

    if (typeof given_name !== "string" || !given_name.trim()) {
      return json({ error: "이름을 입력하세요." }, 400);
    }
    const givenTrim = given_name.trim();

    // 6) 나이·성별·학교·학년 검증
    if (typeof age !== "number" || !Number.isInteger(age) || age < 1 || age > 150) {
      return json({ error: "나이는 1~150 정수여야 합니다." }, 400);
    }

    if (gender !== "male" && gender !== "female" && gender !== "other") {
      return json({ error: "성별은 male/female/other 중 하나여야 합니다." }, 400);
    }

    if (typeof school_name !== "string" || !school_name.trim()) {
      return json({ error: "학교명을 입력하세요." }, 400);
    }
    const schoolTrim = school_name.trim();

    if (typeof grade !== "number" || !Number.isInteger(grade) || grade < 1 || grade > 3) {
      return json({ error: "학년은 1~3 정수여야 합니다." }, 400);
    }

    // 7) expires_in_days 검증 (7~30)
    if (
      typeof expires_in_days !== "number" ||
      !Number.isInteger(expires_in_days) ||
      expires_in_days < 7 ||
      expires_in_days > 30
    ) {
      return json({ error: "유효기간은 7~30일 사이여야 합니다." }, 400);
    }

    // 8) invitee_note (선택)
    let noteVal: string | null = null;
    if (invitee_note !== undefined && invitee_note !== null) {
      if (typeof invitee_note !== "string") {
        return json({ error: "invitee_note는 문자열이어야 합니다." }, 400);
      }
      const t = invitee_note.trim();
      noteVal = t === "" ? null : t;
    }

    // 9) 코드 생성 (XXXX-XXXX-XXXX, 대문자+숫자)
    const segment = () =>
      Math.random().toString(36).substring(2, 6).toUpperCase().padEnd(4, "X");
    const code = `${segment()}-${segment()}-${segment()}`;

    // 10) 만료 시각 계산 (setDate 함정 회피: ms 단위 덧셈)
    const expiresAt = new Date(
      Date.now() + expires_in_days * 24 * 60 * 60 * 1000
    );

    // 11) RPC 호출 (원자적 shell + invite_codes 생성)
    const { data: rpcData, error: rpcErr } = await adminClient
      .rpc("generate_invite_with_shell", {
        p_code:          code,
        p_gm_profile_id: gmProfileId,
        p_expires_at:    expiresAt.toISOString(),
        p_invitee_note:  noteVal,
        p_family_name:   familyTrim,
        p_given_name:    givenTrim,
        p_age:           age,
        p_gender:        gender,
        p_school_name:   schoolTrim,
        p_grade:         grade,
      });

    if (rpcErr) {
      const msg = rpcErr.message ?? "";

      // UNIQUE 위반 세분화 (동명이인 UNIQUE 없어졌으므로 invite_codes.code만 처리)
      if (rpcErr.code === "23505") {
        if (msg.includes("invite_codes_code_key")) {
          return json(
            { error: "코드 생성 충돌. 다시 시도해주세요." },
            500
          );
        }
        return json({ error: "중복된 값이 있습니다.", detail: msg }, 409);
      }

      // CHECK 위반
      if (rpcErr.code === "23514") {
        return json(
          { error: "입력값이 제약 조건을 벗어났습니다.", detail: msg },
          400
        );
      }

      return json({ error: "발급 실패", detail: msg }, 500);
    }

    // rpcData는 TABLE 반환이므로 배열
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    return json({
      code:       row?.code,
      expires_at: row?.expires_at,
      profile_id: row?.profile_id,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});