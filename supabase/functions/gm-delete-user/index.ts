// supabase/functions/delete-user/index.ts
//
// GM 전용 · 유저 완전 삭제 EF (v2 — flashmob 스키마 대응 재작성).
//
// v1 → v2 변경점:
//   - profiles.character_name 참조 제거 (이 프로젝트는 family_name/given_name 분리)
//   - KEYHOLE 잔재 테이블 카운트 제거 (chat_messages / gm_calls / gm_call_messages)
//   - 신설 테이블 반영 (gm_conversations / gm_conversation_messages)
//   - SET NULL 대상에 invite_codes.issued_by, invite_mismatch_reports.resolved_by 추가
//   - shell profile(미가입, user_id IS NULL) 삭제 경로 추가
//     · v1은 auth 계정 삭제만 가능했으나, shell은 auth 계정이 없어 삭제 불가였음
//
// 흐름:
//   1) JWT → auth.getUser()
//   2) GM 검증
//   3) body 파싱: { target_profile_id: uuid, dry_run?: boolean }
//      · v1의 target_user_id 대신 profile_id 기준으로 변경
//        (shell profile은 user_id가 없으므로 profile_id가 유일한 식별자)
//   4) 대상 조회 · 안전장치 검사
//   5) dry_run이면 영향 범위 카운트만 반환
//   6) 실제 삭제:
//      · 가입 유저  → auth.admin.deleteUser() → profiles CASCADE 연쇄
//      · shell 유저 → profiles 직접 DELETE → CASCADE 연쇄
//
// 안전장치:
//   · 자기 자신 삭제 불가
//   · GM 계정 삭제 불가
//   · dry_run 기본 제공 (UI에서 먼저 호출해 확인 후 실삭제 권장)
//
// 응답 코드:
//   200 - 성공 (dry_run 포함)
//   400 - 잘못된 body / 자기 자신 / GM 대상
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

/** 특정 컬럼 = 값 인 행 개수. 실패 시 예외. */
async function countRows(
  // deno-lint-ignore no-explicit-any
  client: any,
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
    const dryRun          = (body as Record<string, unknown>).dry_run === true;

    if (typeof targetProfileId !== "string" || !targetProfileId) {
      return json({ error: "target_profile_id가 필요합니다." }, 400);
    }

    /* ── 4) 대상 조회 ── */
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

    // 안전장치: 자기 자신
    if (target.id === gmProfile.id) {
      return json({ error: "본인 계정은 삭제할 수 없습니다." }, 400);
    }
    // 안전장치: GM 계정
    if (target.is_gm) {
      return json({ error: "GM 계정은 삭제할 수 없습니다." }, 400);
    }

    const targetUserId = target.user_id as string | null;
    const displayName =
      [target.family_name, target.given_name].filter(Boolean).join(" ") ||
      "(이름 미등록)";

    /* ── 5) 영향 범위 집계 ── */

    // CASCADE: profile 삭제 시 함께 사라짐
    const willDelete: Record<string, number> = {
      invite_codes:     await countRows(adminClient, "invite_codes",     "profile_id",      targetProfileId),
      inventory_items:  await countRows(adminClient, "inventory_items",  "profile_id",      targetProfileId),
      badge_awards:     await countRows(adminClient, "badge_awards",     "profile_id",      targetProfileId),
      minigame_plays:   await countRows(adminClient, "minigame_plays",   "profile_id",      targetProfileId),
      user_stickers:    await countRows(adminClient, "user_stickers",    "profile_id",      targetProfileId),
      shop_purchases:   await countRows(adminClient, "shop_purchases",   "profile_id",      targetProfileId),
      mobil_grants:     await countRows(adminClient, "mobil_grants",     "profile_id",      targetProfileId),
      gm_conversations: await countRows(adminClient, "gm_conversations", "user_profile_id", targetProfileId),
    };

    // SET NULL: 행은 남고 작성자 참조만 끊김
    const willAnonymize: Record<string, number> = {
      diary_texts:              await countRows(adminClient, "diary_texts",              "profile_id",        targetProfileId),
      diary_strokes:            await countRows(adminClient, "diary_strokes",            "profile_id",        targetProfileId),
      diary_stickers:           await countRows(adminClient, "diary_stickers",           "profile_id",        targetProfileId),
      invite_codes_issued_by:   await countRows(adminClient, "invite_codes",             "issued_by",         targetProfileId),
      reports_resolved_by:      await countRows(adminClient, "invite_mismatch_reports",  "resolved_by",       targetProfileId),
      gm_messages_sent:         await countRows(adminClient, "gm_conversation_messages", "sender_profile_id", targetProfileId),
    };

    /* ── 6) dry_run이면 여기서 종료 ── */
    if (dryRun) {
      return json({
        dry_run: true,
        target: {
          profile_id:   target.id,
          user_id:      targetUserId,
          display_name: displayName,
          is_registered: targetUserId !== null,
        },
        will_delete:    willDelete,
        will_anonymize: willAnonymize,
      });
    }

    /* ── 7) 실제 삭제 ── */

    if (targetUserId) {
      // 가입 유저: auth 계정 삭제 → profiles.user_id CASCADE 연쇄
      const { error: delErr } = await adminClient.auth.admin.deleteUser(
        targetUserId
      );

      if (delErr) {
        const msg = delErr.message ?? "";
        if (msg.toLowerCase().includes("not found")) {
          return json({ error: "이미 삭제된 유저입니다." }, 404);
        }
        return json({ error: "삭제에 실패하였습니다.", detail: msg }, 500);
      }
    } else {
      // shell 유저(미가입): auth 계정이 없으므로 profiles 직접 삭제
      const { error: delErr } = await adminClient
        .from("profiles")
        .delete()
        .eq("id", targetProfileId);

      if (delErr) {
        return json(
          { error: "삭제에 실패하였습니다.", detail: delErr.message },
          500
        );
      }
    }

    return json({
      dry_run: false,
      success: true,
      target: {
        profile_id:    target.id,
        user_id:       targetUserId,
        display_name:  displayName,
        is_registered: targetUserId !== null,
      },
      deleted:    willDelete,
      anonymized: willAnonymize,
    });
  } catch (e) {
    return json({ error: "처리 중 오류가 발생하였습니다.", detail: String(e) }, 500);
  }
});