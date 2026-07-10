// supabase/functions/delete-user/index.ts
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

// 카운트 헬퍼 (head 요청으로 count만 받음)
async function countRows(
  client: ReturnType<typeof createClient>,
  table: string,
  column: string,
  value: string
): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw new Error(`count ${table}.${column} failed: ${error.message}`);
  return count ?? 0;
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

    // 2) GM 검증
    const { data: gmProfile, error: gmErr } = await adminClient
      .from("profiles")
      .select("is_gm")
      .eq("user_id", requesterId)
      .maybeSingle();

    if (gmErr) {
      return json({ error: "프로필 조회 실패" }, 500);
    }
    if (!gmProfile?.is_gm) {
      return json({ error: "GM 권한이 필요합니다." }, 403);
    }

    // 3) 요청 파싱
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "요청 형식이 잘못됐습니다." }, 400);
    }
    const targetUserId = (body as Record<string, unknown>).target_user_id;
    const dryRun       = (body as Record<string, unknown>).dry_run === true;

    if (typeof targetUserId !== "string" || !targetUserId) {
      return json({ error: "target_user_id가 필요합니다." }, 400);
    }

    // 4) 자기 자신 방지
    if (targetUserId === requesterId) {
      return json({ error: "자기 자신은 삭제할 수 없습니다." }, 400);
    }

    // 5) 대상 profile 조회 (character_name, is_gm, id)
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
    if (targetProfile.is_gm) {
      return json({ error: "GM 계정은 삭제할 수 없습니다." }, 400);
    }

    const targetProfileId  = targetProfile.id;
    const targetCharacter  = targetProfile.character_name;

    // 6) 카운트 조회
    //    함께 삭제될 항목 (CASCADE)
    const willDelete = {
      badge_awards:     await countRows(adminClient, "badge_awards",     "profile_id", targetProfileId),
      inventory_items:  await countRows(adminClient, "inventory_items",  "profile_id", targetProfileId),
      minigame_plays:   await countRows(adminClient, "minigame_plays",   "profile_id", targetProfileId),
      mobil_grants:     await countRows(adminClient, "mobil_grants",     "profile_id", targetProfileId),
      shop_purchases:   await countRows(adminClient, "shop_purchases",   "profile_id", targetProfileId),
      user_stickers:    await countRows(adminClient, "user_stickers",    "profile_id", targetProfileId),
      invite_codes:     await countRows(adminClient, "invite_codes",     "profile_id", targetProfileId),
    };

    //    익명화될 항목 (SET NULL, 이력 유지)
    const willAnonymize = {
      chat_messages:    await countRows(adminClient, "chat_messages",    "user_id",    targetUserId),
      gm_calls:         await countRows(adminClient, "gm_calls",         "user_id",    targetUserId),
      gm_call_messages: await countRows(adminClient, "gm_call_messages", "sender_id",  targetUserId),
      diary_stickers:   await countRows(adminClient, "diary_stickers",   "profile_id", targetProfileId),
      diary_strokes:    await countRows(adminClient, "diary_strokes",    "profile_id", targetProfileId),
      diary_texts:      await countRows(adminClient, "diary_texts",      "profile_id", targetProfileId),
    };

    // 7) dry_run이면 카운트만 반환
    if (dryRun) {
      return json({
        dry_run: true,
        target: {
          user_id:        targetUserId,
          profile_id:     targetProfileId,
          character_name: targetCharacter,
        },
        will_delete:    willDelete,
        will_anonymize: willAnonymize,
      });
    }

    // 8) 실제 삭제
    //    auth.admin.deleteUser 호출 → profiles.user_id CASCADE로 사슬 전파
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(
      targetUserId
    );

    if (deleteErr) {
      // 이미 삭제된 경우도 여기 걸림 (idempotent 처리)
      const msg = deleteErr.message ?? "";
      if (msg.toLowerCase().includes("not found")) {
        return json({ error: "이미 삭제된 유저입니다." }, 404);
      }
      return json({ error: "삭제 실패", detail: msg }, 500);
    }

    return json({
      dry_run: false,
      success: true,
      target: {
        user_id:        targetUserId,
        profile_id:     targetProfileId,
        character_name: targetCharacter,
      },
      deleted:    willDelete,
      anonymized: willAnonymize,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});