// supabase/functions/report-invite-mismatch/index.ts
//
// 초대코드 mismatch 문의 접수 EF (비인증).
//
// 목적:
//   유저가 preview-invite로 캐릭터 정보를 봤는데 자기랑 다를 때,
//   가입 전 상태에서 GM에게 문의를 남기는 창구.
//
// 흐름:
//   1) body 파싱: { invite_code: string, message: string }
//   2) 코드 재검증 (존재·미사용·유효) — preview-invite와 동일 로직
//   3) rate limit: 같은 code로 최근 24h 내 3건 초과 시 거부
//   4) shell profile 조회 → snapshot 만듦
//   5) invite_mismatch_reports INSERT
//   6) 성공 응답 (id 등 내부 식별자 노출 안 함)
//
// 인증 없음 (--no-verify-jwt로 배포). RLS 우회 위해 service_role만 사용.
// 스팸 방어:
//   - rate limit 3/24h per code (가볍고 실효성 있음)
//   - message 길이 CHECK (DB 레벨에서도 방어: 1~2000자)
//
// 응답 코드:
//   200 - 접수 완료
//   400 - 잘못된 body / 이미 사용 / 만료 / 메시지 길이 위반
//   404 - 코드 없음
//   429 - rate limit 초과
//   500 - 조회/저장 실패

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

// 같은 코드로 24h 내 허용 최대 문의 수
const RATE_LIMIT_PER_CODE_24H = 3;
// 메시지 길이 제한 (DB CHECK와 반드시 일치)
const MESSAGE_MAX_LEN = 2000;

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
    if (!body || typeof body !== "object") {
      return json({ error: "요청 형식이 잘못됐습니다." }, 400);
    }

    const rawCode = (body as Record<string, unknown>).invite_code;
    if (typeof rawCode !== "string" || rawCode.trim() === "") {
      return json({ error: "invite_code가 필요합니다." }, 400);
    }
    const inviteCode = rawCode.trim().toUpperCase();

    const rawMessage = (body as Record<string, unknown>).message;
    if (typeof rawMessage !== "string") {
      return json({ error: "메시지를 입력하세요." }, 400);
    }
    const message = rawMessage.trim();
    if (message.length === 0) {
      return json({ error: "메시지를 입력하세요." }, 400);
    }
    if (message.length > MESSAGE_MAX_LEN) {
      return json({ error: `메시지는 ${MESSAGE_MAX_LEN}자 이하여야 합니다.` }, 400);
    }

    // 2) 코드 재검증 (preview-invite와 동일 로직)
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
      return json({ error: "만료된 초대코드입니다." }, 400);
    }

    // 3) rate limit — 같은 코드로 최근 24h 내 문의 수
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount, error: rateErr } = await adminClient
      .from("invite_mismatch_reports")
      .select("id", { count: "exact", head: true })
      .eq("invite_code", inviteCode)
      .gte("created_at", since);

    if (rateErr) {
      // rate limit 조회 실패는 사고 여지가 있으므로 로그만 남기고 통과.
      // (안정성: 완전히 못 접수받는 것보단 낫다는 판단)
      console.error("[report-invite-mismatch] rate check failed:", rateErr);
    } else if ((recentCount ?? 0) >= RATE_LIMIT_PER_CODE_24H) {
      return json(
        {
          error: "잠시 후 다시 시도해주세요. 문의가 이미 접수되어 있습니다.",
        },
        429
      );
    }

    // 4) shell profile 조회 → snapshot
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("family_name, given_name, age, gender, school_name, grade, rhythm_stat, physical_stat, expression_stat")
      .eq("id", invite.profile_id)
      .maybeSingle();

    if (profileErr) {
      return json({ error: "캐릭터 정보 조회 실패", detail: profileErr.message }, 500);
    }
    if (!profile) {
      return json({ error: "캐릭터 정보를 찾을 수 없습니다. GM에게 문의해주세요." }, 500);
    }

    const snapshot = {
      family_name:     profile.family_name,
      given_name:      profile.given_name,
      age:             profile.age,
      gender:          profile.gender,
      school_name:     profile.school_name,
      grade:           profile.grade,
      rhythm_stat:     profile.rhythm_stat,
      physical_stat:   profile.physical_stat,
      expression_stat: profile.expression_stat,
    };

    // 5) INSERT
    const { error: insErr } = await adminClient
      .from("invite_mismatch_reports")
      .insert({
        invite_code_id: invite.id,
        invite_code:    inviteCode,
        snapshot,
        message,
      });

    if (insErr) {
      // CHECK 위반 (길이)
      if (insErr.code === "23514") {
        return json({ error: "메시지 형식이 올바르지 않습니다." }, 400);
      }
      return json({ error: "접수 실패", detail: insErr.message }, 500);
    }

    // 6) 성공 응답 (id 등 내부 식별자 노출 안 함)
    return json({ success: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});