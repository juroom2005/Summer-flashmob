// supabase/functions/preview-invite/index.ts
//
// 초대코드 캐릭터 정보 미리보기 EF (비인증).
//
// 회원가입 전에 코드로 저장된 캐릭터 정보를 유저에게 보여줘서
// "이 사람 맞아요?" 확인 절차 위한 조회 API.
//
// 변경점 (v2 → v3 · 스탯 레벨제 개편):
//   - shell profile 조회 select : rhythm_stat → rhythm_level (등)
//     · exp 대신 level 만 조회. exp 는 발급 시점의 각 레벨 최소값이라
//       유저에게 굳이 노출할 이유 없음.
//     · level 은 DB GENERATED STORED 라 정합 보장.
//   - 응답 필드 : rhythm_stat → rhythm_level (등)
//
// 흐름:
//   1) body 파싱: { invite_code: string }
//   2) 코드 검증 (존재·미사용·유효)
//   3) 대응 shell profile 조회
//   4) 캐릭터 정보 반환 (레벨 포함)
//
// 인증 없음 (--no-verify-jwt로 배포). RLS 우회하려 service_role만 사용.
// 봇 시도 우려는 지금 규모(25명)에선 무시. XXXX-XXXX-XXXX 검색공간도 큼.
//
// 응답 코드:
//   200 - 정보 반환
//   400 - 잘못된 body / 이미 사용 / 만료
//   404 - 코드 없음
//   500 - 조회 실패

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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "환경 변수 누락" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // 1) body 파싱
    const body = await req.json().catch(() => null);
    const rawCode = body?.invite_code;
    if (typeof rawCode !== "string" || rawCode.trim() === "") {
      return json({ error: "invite_code가 필요합니다." }, 400);
    }
    const inviteCode = rawCode.trim().toUpperCase();

    // 2) 코드 조회
    const { data: invite, error: inviteErr } = await adminClient
      .from("invite_codes")
      .select("id, used, expires_at, profile_id")
      .eq("code", inviteCode)
      .maybeSingle();

    if (inviteErr) {
      return json({ error: "초대코드 조회 실패", detail: inviteErr.message }, 500);
    }
    if (!invite) {
      return json({ error: "유효하지 않은 초대코드입니다." }, 404);
    }
    if (invite.used) {
      return json({ error: "이미 사용된 초대코드입니다." }, 400);
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return json({ error: "만료된 초대코드입니다. GM에게 문의해주십시오." }, 400);
    }

    // 3) shell profile 조회 (레벨 포함)
    //    exp 는 조회 대상 아님 — 유저에게 보여줄 정보가 아니고,
    //    발급 시점 exp 는 각 레벨의 최소값이라 새로운 정보가 없다.
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select(
        "family_name, given_name, age, gender, school_name, grade, " +
        "rhythm_level, physical_level, expression_level"
      )
      .eq("id", invite.profile_id)
      .maybeSingle();

    if (profileErr) {
      return json({ error: "캐릭터 정보 조회 실패", detail: profileErr.message }, 500);
    }
    if (!profile) {
      // 매우 드문 케이스 — shell이 사라졌는데 code가 남은 데이터 불일치
      return json({ error: "캐릭터 정보를 찾을 수 없습니다. GM에게 문의해주십시오." }, 500);
    }

    // 4) 캐릭터 정보 반환 (id 등 내부 식별자 노출 안 함, 레벨 포함)
    return json({
      family_name:      profile.family_name,
      given_name:       profile.given_name,
      age:              profile.age,
      gender:           profile.gender,
      school_name:      profile.school_name,
      grade:            profile.grade,
      rhythm_level:     profile.rhythm_level,
      physical_level:   profile.physical_level,
      expression_level: profile.expression_level,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});