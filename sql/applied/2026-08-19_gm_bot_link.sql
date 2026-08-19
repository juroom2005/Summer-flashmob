-- sql/pending/2026-08-19_gm_bot_link.sql
-- ═══════════════════════════════════════════════════════════════════
-- GM용 봇 계정 연동 관리 RPC (bot_account_links)
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경:
--   · bot_account_links(마스토돈 계정 id ↔ profiles.id) 매핑을 지금은
--     GM 이 SQL 로 직접 INSERT 해야 함 → 불편·실수(user_id vs profile_id 등).
--   · 홈페이지 GM 화면에서 매핑을 조회/설정/해제할 수 있게 RPC 3종 신설.
--
-- 설계:
--   · 기존 GM RPC 패턴(assert_caller_is_gm 선검사)을 그대로 따름.
--   · GM 은 유저를 선택한 상태이므로 profile_id 는 UI 가 자동으로 넘긴다.
--     GM 은 마스토돈 계정 id(숫자)만 입력.
--   · bot_account_links.profile_id 는 UNIQUE(한 프로필=한 마스토돈 계정).
--     → 재연동 시 UPSERT(있으면 갱신).
--   · mastodon_account_id 도 사실상 유일해야 함(한 마스토돈 계정=한 프로필).
--     다른 프로필이 같은 마스토돈 id 를 이미 쓰고 있으면 거부.
--
-- RPC:
--   · gm_get_bot_link(p_profile_id)  → 현재 매핑(없으면 null 필드) 반환
--   · gm_set_bot_link(p_profile_id, p_mastodon_account_id, p_mastodon_acct)
--       → UPSERT. 다른 프로필이 그 마스토돈 id 를 쓰면 mastodon_id_taken 예외
--   · gm_delete_bot_link(p_profile_id) → 매핑 해제
--
-- 방어(예외):
--   · auth_required / gm_only        : assert_caller_is_gm
--   · profile_not_found              : 대상 프로필 없음
--   · invalid_mastodon_id            : 빈 값/숫자 아님
--   · mastodon_id_taken              : 그 마스토돈 id 가 다른 프로필에 이미 연결됨
--
-- 권한: authenticated 는 실행 가능(내부에서 GM 검사). anon 차단.
--
-- 롤백: 파일 하단.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 조회 : gm_get_bot_link
--   현재 매핑을 반환. 없으면 mastodon_account_id/mastodon_acct 가 NULL.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_get_bot_link(
  p_profile_id uuid
)
  RETURNS TABLE (
    profile_id           uuid,
    mastodon_account_id  text,
    mastodon_acct        text,
    updated_at           timestamptz
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  RETURN QUERY
  SELECT l.profile_id, l.mastodon_account_id, l.mastodon_acct, l.updated_at
    FROM public.bot_account_links l
   WHERE l.profile_id = p_profile_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 설정 : gm_set_bot_link (UPSERT)
--   profile_id 기준으로 있으면 갱신, 없으면 삽입.
--   그 마스토돈 계정 id 가 "다른" 프로필에 이미 연결돼 있으면 거부.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_set_bot_link(
  p_profile_id          uuid,
  p_mastodon_account_id text,
  p_mastodon_acct       text DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_mid   text;
  v_acct  text;
  v_owner uuid;
BEGIN
  PERFORM public.assert_caller_is_gm();

  -- 대상 프로필 존재 확인
  PERFORM 1 FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- 마스토돈 id 정규화·검증 (공백 제거, 숫자만)
  v_mid := regexp_replace(COALESCE(p_mastodon_account_id, ''), '\s', '', 'g');
  IF v_mid = '' OR v_mid !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_mastodon_id';
  END IF;

  v_acct := NULLIF(TRIM(COALESCE(p_mastodon_acct, '')), '');

  -- 그 마스토돈 id 를 이미 다른 프로필이 쓰고 있으면 거부
  SELECT profile_id INTO v_owner
    FROM public.bot_account_links
   WHERE mastodon_account_id = v_mid;
  IF v_owner IS NOT NULL AND v_owner <> p_profile_id THEN
    RAISE EXCEPTION 'mastodon_id_taken';
  END IF;

  -- UPSERT (profile_id UNIQUE 기준)
  INSERT INTO public.bot_account_links
    (mastodon_account_id, profile_id, mastodon_acct, updated_at)
  VALUES
    (v_mid, p_profile_id, v_acct, now())
  ON CONFLICT (profile_id) DO UPDATE
    SET mastodon_account_id = EXCLUDED.mastodon_account_id,
        mastodon_acct       = EXCLUDED.mastodon_acct,
        updated_at          = now();
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 해제 : gm_delete_bot_link
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_delete_bot_link(
  p_profile_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  DELETE FROM public.bot_account_links
   WHERE profile_id = p_profile_id;
END;
$function$;

-- 권한 : anon 차단, authenticated 만(내부에서 GM 검사)
REVOKE ALL ON FUNCTION public.gm_get_bot_link(uuid)               FROM anon;
REVOKE ALL ON FUNCTION public.gm_set_bot_link(uuid, text, text)   FROM anon;
REVOKE ALL ON FUNCTION public.gm_delete_bot_link(uuid)            FROM anon;
GRANT EXECUTE ON FUNCTION public.gm_get_bot_link(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.gm_set_bot_link(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gm_delete_bot_link(uuid)          TO authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- [롤백]
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.gm_get_bot_link(uuid);
--   DROP FUNCTION IF EXISTS public.gm_set_bot_link(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.gm_delete_bot_link(uuid);
-- COMMIT;
--
-- [검증 쿼리]  (GM 세션에서 실행해야 함. 아니면 gm_only 예외)
-- 1) 함수 등록:
--    SELECT proname FROM pg_proc WHERE proname LIKE 'gm_%bot_link' ORDER BY proname;
-- 2) 매핑 설정(UPSERT):
--    SELECT public.gm_set_bot_link('프로필uuid'::uuid, '117116553032013932', 'chise_haruyuki');
-- 3) 조회:
--    SELECT * FROM public.gm_get_bot_link('프로필uuid'::uuid);
-- 4) 중복 방어 (다른 프로필에 같은 마스토돈 id → mastodon_id_taken):
--    SELECT public.gm_set_bot_link('다른프로필'::uuid, '117116553032013932');
-- 5) 잘못된 id (숫자 아님 → invalid_mastodon_id):
--    SELECT public.gm_set_bot_link('프로필uuid'::uuid, 'abc');
-- 6) 해제:
--    SELECT public.gm_delete_bot_link('프로필uuid'::uuid);
-- ═══════════════════════════════════════════════════════════════════
