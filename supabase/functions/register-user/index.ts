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

    // 1) Authorization 헤더에서 JWT 추출 + 검증
    //    body의 user_id는 신뢰하지 않음
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return json({ error: "인증 토큰이 필요합니다." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "인증 실패" }, 401);
    }
    const userId = userData.user.id;

    // 2) body에서 invite_code만 파싱
    const body = await req.json().catch(() => null);
    const rawCode = body?.invite_code;
    if (typeof rawCode !== "string" || rawCode.trim() === "") {
      return json({ error: "invite_code가 필요합니다." }, 400);
    }
    const inviteCode = rawCode.trim().toUpperCase();

    // 3) service_role로 사전 검증 (사용자에게 친절한 오류 메시지용)
    //    실제 원자적 처리는 아래 RPC가 담당
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: invite, error: inviteErr } = await adminClient
      .from("invite_codes")
      .select("id, used, expires_at")
      .eq("code", inviteCode)
      .maybeSingle();

    if (inviteErr) {
      return json({ error: "초대코드 조회 실패" }, 500);
    }
    if (!invite) {
      return json({ error: "유효하지 않은 초대코드입니다." }, 400);
    }
    if (invite.used) {
      return json({ error: "이미 사용된 초대코드입니다." }, 400);
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return json({ error: "만료된 초대코드입니다." }, 400);
    }

    // 4) 트랜잭션 원자 처리 (RPC)
    const { error: rpcErr } = await adminClient.rpc(
      "register_user_with_invite",
      {
        p_user_id:     userId,
        p_invite_code: inviteCode,
      }
    );

    if (rpcErr) {
      // profiles.user_id UNIQUE 위반: 이미 가입된 계정
      if (rpcErr.code === "23505") {
        return json({ error: "이미 가입 처리된 계정입니다." }, 409);
      }
      // 함수 내 커스텀 예외
      const msg = rpcErr.message ?? "";
      if (msg.includes("invite_unavailable")) {
        return json({ error: "초대코드를 사용할 수 없습니다." }, 400);
      }
      if (msg.includes("shell_not_available")) {
        // shell이 없거나 이미 다른 계정과 연결됨 — GM 쪽 이상
        return json(
          { error: "가입 처리 실패. 관리자에게 문의해주세요." },
          500
        );
      }
      return json({ error: "가입 처리 실패", detail: msg }, 500);
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});