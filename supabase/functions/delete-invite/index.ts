// supabase/functions/delete-invite/index.ts
//
// GM이 발급한 초대코드 삭제 EF.
//
// 흐름:
//   1) Authorization 헤더에서 JWT → auth.getUser()
//   2) GM 검증 (profiles.is_gm)
//   3) body 파싱: { code_id: uuid }
//   4) RPC delete_invite_and_shell 호출
//      - used=true: invite_codes만 삭제 (실유저 profile 보존)
//      - used=false: shell profile 삭제 → CASCADE로 invite_codes 자동 삭제
//   5) 성공 응답
//
// 응답 코드:
//   200 - 삭제 성공
//   400 - 잘못된 body
//   401 - 인증 실패
//   403 - GM 아님
//   404 - 코드 없음
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

    // 1) JWT 추출
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

    // 3) GM 검증
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

    // 4) body 파싱
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "요청 형식이 잘못됐습니다." }, 400);
    }

    const { code_id } = body as Record<string, unknown>;

    if (typeof code_id !== "string" || !code_id.trim()) {
      return json({ error: "code_id가 필요합니다." }, 400);
    }

    // UUID 형식 간단 검증 (36자, 하이픈 위치)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(code_id)) {
      return json({ error: "code_id 형식이 올바르지 않습니다." }, 400);
    }

    // 5) RPC 호출
    const { error: rpcErr } = await adminClient.rpc("delete_invite_and_shell", {
      p_code_id: code_id,
    });

    if (rpcErr) {
      const msg = rpcErr.message ?? "";

      // RPC에서 RAISE EXCEPTION 'invite_code_not_found' 처리
      if (msg.includes("invite_code_not_found")) {
        return json({ error: "코드를 찾을 수 없습니다." }, 404);
      }

      return json({ error: "삭제 실패", detail: msg }, 500);
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});