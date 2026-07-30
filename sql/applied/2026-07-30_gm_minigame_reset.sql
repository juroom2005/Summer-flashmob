-- sql/pending/2026-07-30_gm_minigame_reset.sql
-- ═══════════════════════════════════════════════════════════════════
-- GM 유저 관리 : 오늘 미니게임 소진 횟수 조회 · 리셋 RPC 2 종 신설
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   운영 중 유저가 실수로 미니게임을 소진했거나 서버 이슈로 카운트가
--   잘못 차감된 경우, GM 이 수동으로 해당 유저의 오늘 미니게임 이력을
--   확인하고 리셋할 수 있어야 한다.
--
-- 도입 RPC 2 종
--
--   1) gm_get_user_minigame_today(p_profile_id uuid)
--        - 대상 유저의 오늘(KST) 미니게임 완주 이력 조회
--        - GM 만 호출 가능
--        - 반환 : 소진 횟수·상한·이력 배열
--
--   2) gm_reset_user_minigame_today(p_profile_id uuid)
--        - 대상 유저의 오늘(KST) 미니게임 완주 이력 전부 삭제
--        - GM 만 호출 가능
--        - 반환 : 삭제된 행 수
--        - 삭제된 이력의 보상(모빌·스탯 exp)은 되돌리지 않음.
--          이유 : 유저가 이미 사용했을 가능성. 되돌리기는 운영 정책상
--          "보상 회수 필요 시 별도 스탯/모빌 조정 패널로 수동" 이 안전.
--          이 RPC 는 순수하게 "오늘 카운트만 리셋" 하는 역할.
--
-- 설계 참고 :
--   기존 GM RPC 패턴 (sql/applied/2026-07-24_stat_level_gm_rpcs.sql) 그대로.
--   · SECURITY DEFINER · search_path = 'public'
--   · assert_caller_is_gm() 호출
--   · 대상 profile 존재 확인
--   · KST 기준 오늘 판정
--
-- 안전장치 :
--   · CREATE OR REPLACE FUNCTION (시그니처 신규라 DROP 불필요)
--   · 트랜잭션 (BEGIN / COMMIT)
--   · 리셋은 INSERT 안 함, DELETE 만. 유저 데이터 파괴 최소화.
--   · 삭제 대상은 반드시 (profile_id, play_date) 조건으로 한정.
--
-- 롤백 :
--   DROP FUNCTION IF EXISTS public.gm_get_user_minigame_today(uuid);
--   DROP FUNCTION IF EXISTS public.gm_reset_user_minigame_today(uuid);
--
-- 선행 마이그레이션 :
--   sql/applied/2026-07-29_minigame_cafe_seed.sql
--   sql/applied/2026-07-29_minigame_cafe_rpcs.sql
--   sql/applied/2026-07-29_minigame_status_ambiguous_fix.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1) gm_get_user_minigame_today
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_get_user_minigame_today(
  p_profile_id uuid
)
RETURNS TABLE (
  plays_today      integer,
  daily_limit      integer,
  plays_remaining  integer,
  play_date        date,
  history          jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_daily_limit constant integer := 3;
  v_today       date;
  v_count       integer;
  v_history     jsonb;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_profile_id';
  END IF;

  -- 대상 profile 존재 확인
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT count(*) INTO v_count
    FROM public.minigame_plays AS mp
   WHERE mp.profile_id = p_profile_id
     AND mp.play_date  = v_today;

  -- 이력 상세 (미니게임 이름 · 점수 · 지급량 · 시각)
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',            mp.id,
               'minigame_code', mg.code,
               'minigame_name', mg.name,
               'score',         mp.score,
               'stat_gained',   mp.stat_gained,
               'mobil_gained',  mp.mobil_gained,
               'target_stat',   mp.target_stat,
               'played_at',     mp.created_at,
               'result_detail', mp.result_detail
             )
             ORDER BY mp.created_at DESC
           ),
           '[]'::jsonb
         )
    INTO v_history
    FROM public.minigame_plays AS mp
    JOIN public.minigames      AS mg ON mg.id = mp.minigame_id
   WHERE mp.profile_id = p_profile_id
     AND mp.play_date  = v_today;

  plays_today     := v_count;
  daily_limit     := v_daily_limit;
  plays_remaining := GREATEST(v_daily_limit - v_count, 0);
  play_date       := v_today;
  history         := v_history;
  RETURN NEXT;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 2) gm_reset_user_minigame_today
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_reset_user_minigame_today(
  p_profile_id uuid
)
RETURNS TABLE (
  deleted_count integer,
  play_date     date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today   date;
  v_deleted integer;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_profile_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  WITH deleted AS (
    DELETE FROM public.minigame_plays AS mp
     WHERE mp.profile_id = p_profile_id
       AND mp.play_date  = v_today
     RETURNING mp.id
  )
  SELECT count(*)::integer INTO v_deleted FROM deleted;

  deleted_count := v_deleted;
  play_date     := v_today;
  RETURN NEXT;
END;
$$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인 (수동 검증용)
-- ─────────────────────────────────────────────────────────────────────
-- 1) 함수 등록 재확인
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--     FROM pg_proc
--    WHERE proname IN (
--      'gm_get_user_minigame_today',
--      'gm_reset_user_minigame_today'
--    );
--
-- 2) SQL Editor 직접 호출은 caller_is_gm 실패로 예외가 정상.
--    실 검증은 GM 로그인 세션의 관리 UI 에서.
-- ═══════════════════════════════════════════════════════════════════
