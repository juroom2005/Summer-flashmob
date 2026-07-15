// supabase/functions/extend-invite/index.ts
//
// GM이 발급한 초대코드 유효기간 연장 EF (v2 — 계산 방식 개선).
//
// 변경점 (v1 → v2):
//   - 새 만료 시각 계산: max(now, 기존 expires_at) + N일
//     · 유효한 코드: 기존 만료 시각에서 자연스럽게 이어붙임
//     · 만료된 코드: 오늘부터 다시 N일 (되살아남)
//   - 기존 v1은 항상 now() + N일이라 유효한 코드 연장 효과가 부자연스러움
//   - 계산에 필요한 기존 expires_at을 SELECT로 먼저 조회 (used도 함께 확인)
//
// 흐름:
//   1) Authorization 헤더에서 JWT → auth.getUser()
//   2) GM 검증
//   3) body 파싱: { code_id: uuid, extend_days: number }
//   4) SELECT로 기존 expires_at + used 조회
//      · 없으면 404, used=true면 400
//   5) 새 만료 시각 계산 (max 방식)
//   6) UPDATE (used=false 안전 여벌 조건)
//   7) 새 expires_at 반환

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

    const { code_id, extend_days } = body as Record<string, unknown>;

    if (typeof code_id !== "string" || !code_id.trim()) {
      return json({ error: "code_id가 필요합니다." }, 400);
    }

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(code_id)) {
      return json({ error: "code_id 형식이 올바르지 않습니다." }, 400);
    }

    if (
      typeof extend_days !== "number" ||
      !Number.isInteger(extend_days) ||
      extend_days < 7 ||
      extend_days > 30
    ) {
      return json({ error: "extend_days는 7~30 정수여야 합니다." }, 400);
    }

    // 5) 기존 상태 조회
    const { data: existing, error: selErr } = await adminClient
      .from("invite_codes")
      .select("expires_at, used")
      .eq("id", code_id)
      .maybeSingle();

    if (selErr) {
      return json({ error: "조회 실패", detail: selErr.message }, 500);
    }
    if (!existing) {
      return json({ error: "코드를 찾을 수 없습니다." }, 404);
    }
    if (existing.used) {
      return json({ error: "이미 사용된 코드는 연장할 수 없습니다." }, 400);
    }

    // 6) 새 만료 시각 계산: max(now, 기존 expires_at) + N일
    const nowMs             = Date.now();
    const currentExpiresMs  = new Date(existing.expires_at).getTime();
    const baseMs            = Math.max(nowMs, currentExpiresMs);
    const newExpiresAt      = new Date(baseMs + extend_days * 24 * 60 * 60 * 1000);

    // 7) UPDATE (used=false 안전 여벌 — SELECT 이후 회원가입 완료 race 방어)
    const { data: updated, error: updErr } = await adminClient
      .from("invite_codes")
      .update({ expires_at: newExpiresAt.toISOString() })
      .eq("id", code_id)
      .eq("used", false)
      .select("id, code, expires_at, used")
      .maybeSingle();

    if (updErr) {
      return json({ error: "연장 실패", detail: updErr.message }, 500);
    }
    if (!updated) {
      // SELECT와 UPDATE 사이에 used=true로 바뀐 매우 드문 경우
      return json({ error: "이미 사용된 코드는 연장할 수 없습니다." }, 400);
    }

    return json({
      code:       updated.code,
      expires_at: updated.expires_at,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});