// supabase/functions/grant-gm-role/index.ts
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

    // 1) 인증
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
      return json({ error: "인증 실패" }, 401);
    }
    const requesterId = userData.user.id;

    // 2) 요청자 GM 검증
    const { data: requesterProfile, error: reqProfileErr } = await adminClient
      .from("profiles")
      .select("is_gm")
      .eq("user_id", requesterId)
      .maybeSingle();

    if (reqProfileErr) {
      return json({ error: "프로필 조회 실패" }, 500);
    }
    if (!requesterProfile?.is_gm) {
      return json({ error: "GM 권한이 필요합니다." }, 403);
    }

    // 3) body 파싱
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "요청 형식이 잘못됐습니다." }, 400);
    }

    const targetUserId = (body as Record<string, unknown>).target_user_id;
    const grant        = (body as Record<string, unknown>).grant;

    if (typeof targetUserId !== "string" || !targetUserId) {
      return json({ error: "target_user_id가 필요합니다." }, 400);
    }
    if (typeof grant !== "boolean") {
      return json({ error: "grant는 boolean이어야 합니다." }, 400);
    }

    // 4) 자기 자신 방지
    if (targetUserId === requesterId) {
      return json({ error: "자기 자신의 권한은 변경할 수 없습니다." }, 400);
    }

    // 5) 대상 profile 조회
    const { data: targetProfile, error: targetErr } = await adminClient
      .from("profiles")
      .select("id, character_name, is_gm")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetErr) {
      return json({ error: "대상 프로필 조회 실패" }, 500);
    }
    if (!targetProfile) {
      return json({ error: "존재하지 않는 유저입니다." }, 404);
    }

    // 6) 이미 원하는 상태면 no-op으로 성공 반환 (idempotent)
    if (targetProfile.is_gm === grant) {
      return json({
        success:   true,
        no_change: true,
        target: {
          user_id:        targetUserId,
          profile_id:     targetProfile.id,
          character_name: targetProfile.character_name,
          is_gm:          targetProfile.is_gm,
        },
      });
    }

    // 7) grant=false(회수) 시: 마지막 GM 회수 방지
    if (!grant) {
      const { count, error: countErr } = await adminClient
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("is_gm", true);

      if (countErr) {
        return json({ error: "GM 수 조회 실패" }, 500);
      }
      if ((count ?? 0) <= 1) {
        return json(
          {
            error:
              "마지막 GM은 권한을 회수할 수 없습니다. 다른 유저에게 먼저 GM 권한을 부여하세요.",
          },
          400
        );
      }
    }

    // 8) is_gm 변경 (트리거는 service_role이라 통과)
    const { error: updateErr } = await adminClient
      .from("profiles")
      .update({ is_gm: grant })
      .eq("id", targetProfile.id);

    if (updateErr) {
      return json({ error: "권한 변경 실패", detail: updateErr.message }, 500);
    }

    return json({
      success:   true,
      no_change: false,
      target: {
        user_id:        targetUserId,
        profile_id:     targetProfile.id,
        character_name: targetProfile.character_name,
        is_gm:          grant,
      },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});