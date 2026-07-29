-- sql/pending/2026-07-29_minigame_status_ambiguous_fix.sql
-- ═══════════════════════════════════════════════════════════════════
-- get_today_minigame_status 컬럼 모호성 (ambiguous) 수정
-- ═══════════════════════════════════════════════════════════════════
--
-- 증상 :
--   호출 시 "column reference minigame_enabled is ambiguous" 에러.
--
-- 원인 :
--   RETURNS TABLE 출력 컬럼 minigame_enabled 와 site_settings.minigame_enabled
--   컬럼명이 동일하여, 본문의 SELECT ... FROM site_settings 에서 모호성 발생.
--
-- 수정 :
--   site_settings 조회에 별칭 (s) 을 붙여 s.minigame_enabled 로 명시.
--   minigame_plays 에도 별칭 (mp) 부여.
--
-- 안전장치 :
--   · CREATE OR REPLACE FUNCTION 원자적 교체. 시그니처 동일.
--   · 달러 인용 태그는 표준 $$ 사용 (대시보드 호환).
--   · 트랜잭션으로 감쌈.
--
-- 선행 마이그레이션 : 2026-07-29_minigame_cafe_rpcs.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_today_minigame_status()
RETURNS TABLE (
  plays_today       integer,
  plays_remaining   integer,
  daily_limit       integer,
  minigame_enabled  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id       uuid;
  v_profile_id    uuid;
  v_daily_limit   constant integer := 3;
  v_today         date;
  v_plays_today   integer;
  v_enabled       boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT id INTO v_profile_id
    FROM public.profiles
   WHERE user_id = v_user_id;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  SELECT s.minigame_enabled INTO v_enabled
    FROM public.site_settings AS s
   WHERE s.id = 1;
  v_enabled := COALESCE(v_enabled, false);

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT count(*) INTO v_plays_today
    FROM public.minigame_plays AS mp
   WHERE mp.profile_id = v_profile_id
     AND mp.play_date  = v_today;

  plays_today      := v_plays_today;
  plays_remaining  := GREATEST(v_daily_limit - v_plays_today, 0);
  daily_limit      := v_daily_limit;
  minigame_enabled := v_enabled;
  RETURN NEXT;
END;
$$;

COMMIT;
