-- sql/pending/2026-08-19_badge_test_rollback.sql
-- ═══════════════════════════════════════════════════════════════════
-- 뱃지 테스트 되돌리기 유틸 (테스트 전용)
-- ═══════════════════════════════════════════════════════════════════
--
-- 목적 : 테스트로 부여된 뱃지 · 순위권 자리를 되돌려 재테스트 가능하게 한다.
--
-- ⚠ 주의
--   · 이 파일은 "실행 대본" 이다. 전체를 한 번에 실행하지 말 것.
--     필요한 섹션만 골라 값을 채워 실행한다.
--   · 순위권(금은동)은 rank 자리를 한 번 먹으면 그 자리가 막힌다.
--     테스트 후 회수하지 않으면 다음 테스트에서 순번이 계속 밀린다.
--   · 운영 오픈 후에는 절대 쓰지 말 것. 실유저 업적이 사라진다.
--
-- 되돌리기 원리 (중요)
--   트리거는 OLD.level < 5 AND NEW.level = 5 (최초 도달 순간) 에만 발동한다.
--   따라서 exp 를 450 그대로 두거나 다시 450 으로 올려도 재발동하지 않는다.
--   재테스트하려면 반드시 :
--     (1) badge_awards 에서 해당 부여 삭제
--     (2) exp 를 Lv5 미만(예: 0)으로 내려 "미도달" 상태 복귀
--     (3) 다시 exp 를 450 으로 올려 트리거 재발동
--   순서를 지켜야 트리거가 "최초 도달" 로 인식한다.
-- ═══════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
-- [조회 A] 현재 부여된 뱃지 전체 보기 (누가 뭘 몇 등으로)
-- ────────────────────────────────────────────────────────────────────
-- SELECT ba.awarded_at,
--        p.family_name, p.given_name,
--        b.code, ba.rank,
--        ba.profile_id
--   FROM public.badge_awards ba
--   JOIN public.badges   b ON b.id = ba.badge_id
--   JOIN public.profiles p ON p.id = ba.profile_id
--  ORDER BY b.code, ba.rank NULLS LAST, ba.awarded_at;


-- ────────────────────────────────────────────────────────────────────
-- [조회 B] 특정 스탯 순위권 자리 현황 (금/은/동 누가 먹었나)
--   :stat = 'rhythm' | 'physical' | 'performance'
-- ────────────────────────────────────────────────────────────────────
-- SELECT ba.rank,
--        p.family_name, p.given_name,
--        ba.profile_id, ba.awarded_at
--   FROM public.badge_awards ba
--   JOIN public.badges   b ON b.id = ba.badge_id
--   JOIN public.profiles p ON p.id = ba.profile_id
--  WHERE b.code = 'rhythm_rank'          -- ← 스탯 바꿔서
--  ORDER BY ba.rank;


-- ════════════════════════════════════════════════════════════════════
-- 유틸 함수 3종 설치 (한 번 실행해두면 이후 SELECT 호출로 간편 되돌리기)
-- ════════════════════════════════════════════════════════════════════
BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- [유틸 1] 특정 유저의 뱃지 award 만 회수 (exp/level 은 유지)
--
--   뱃지 표시만 없애고 싶을 때. 순위권 자리도 이 유저 것이면 함께 비워진다.
--   p_stat 이 NULL 이면 그 유저의 모든 뱃지 회수, 지정하면 해당 스탯만.
--
--   사용 :
--     SELECT public.test_revoke_badges('<profile-id>');            -- 전체
--     SELECT public.test_revoke_badges('<profile-id>', 'rhythm');  -- 리듬만
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.test_revoke_badges(
  p_profile_id uuid,
  p_stat       text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.badge_awards ba
   USING public.badges b
   WHERE ba.badge_id = b.id
     AND ba.profile_id = p_profile_id
     AND (
       p_stat IS NULL
       OR b.code = p_stat || '_rank'
       OR b.code = p_stat || '_common'
     );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;  -- 삭제된 award 개수
END;
$$;


-- ────────────────────────────────────────────────────────────────────
-- [유틸 2] 특정 유저를 특정 스탯에 대해 "재테스트 준비" 상태로
--
--   (1) 해당 스탯 뱃지 회수  →  (2) 해당 스탯 exp = 0 (Lv0 복귀)
--   이 상태에서 exp 를 다시 450 으로 올리면 트리거가 최초 도달로 재발동한다.
--
--   ⚠ exp 를 0 으로 내리므로 그 스탯 진행도가 사라진다(테스트 계정이라 무방).
--
--   p_stat : 'rhythm' | 'physical' | 'performance'
--            (주의) performance 는 내부적으로 expression_exp 를 초기화한다.
--
--   사용 :
--     SELECT public.test_reset_stat('<profile-id>', 'rhythm');
--     -- 이후 재발동 :
--     -- UPDATE public.profiles SET rhythm_exp = 450 WHERE id = '<profile-id>';
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.test_reset_stat(
  p_profile_id uuid,
  p_stat       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1) 뱃지 회수 (순위권 자리도 이 유저 것이면 비워짐)
  PERFORM public.test_revoke_badges(p_profile_id, p_stat);

  -- 2) exp 를 0 으로 → level 0 복귀 (GENERATED 라 자동 재계산)
  IF p_stat = 'rhythm' THEN
    UPDATE public.profiles SET rhythm_exp = 0 WHERE id = p_profile_id;
  ELSIF p_stat = 'physical' THEN
    UPDATE public.profiles SET physical_exp = 0 WHERE id = p_profile_id;
  ELSIF p_stat = 'performance' THEN
    UPDATE public.profiles SET expression_exp = 0 WHERE id = p_profile_id;
  ELSE
    RAISE EXCEPTION 'test_reset_stat: unknown stat %', p_stat;
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────────────
-- [유틸 3] 특정 스탯 순위권 자리 전체 비우기 (모든 유저)
--
--   금/은/동 자리를 싹 비운다. 순번 로직을 처음부터 다시 시험하고 싶을 때.
--   일반 뱃지(rank NULL)는 건드리지 않는다. exp/level 도 유지.
--
--   ⚠ 이 스탯의 순위권을 받은 모든 테스트 유저의 금은동이 사라진다.
--
--   사용 :
--     SELECT public.test_clear_rank_slots('rhythm');
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.test_clear_rank_slots(
  p_stat text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.badge_awards ba
   USING public.badges b
   WHERE ba.badge_id = b.id
     AND b.code = p_stat || '_rank'
     AND ba.rank IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;  -- 비운 자리 개수
END;
$$;

COMMIT;


-- ════════════════════════════════════════════════════════════════════
-- 재테스트 표준 절차 (예시 : 리듬감 순위권을 처음부터 다시)
-- ════════════════════════════════════════════════════════════════════
-- -- 1) 현황 확인
-- SELECT public.test_clear_rank_slots('rhythm');   -- 금은동 자리 비우기
--
-- -- 2) 테스트 유저들 각각 미도달 상태로 되돌리기
-- SELECT public.test_reset_stat('<userA-profile-id>', 'rhythm');
-- SELECT public.test_reset_stat('<userB-profile-id>', 'rhythm');
-- SELECT public.test_reset_stat('<userC-profile-id>', 'rhythm');
--
-- -- 3) 원하는 순서대로 Lv5 도달시켜 금→은→동 확인
-- UPDATE public.profiles SET rhythm_exp = 450 WHERE id = '<userA-profile-id>'; -- 금
-- UPDATE public.profiles SET rhythm_exp = 450 WHERE id = '<userB-profile-id>'; -- 은
-- UPDATE public.profiles SET rhythm_exp = 450 WHERE id = '<userC-profile-id>'; -- 동
--
-- -- 4) 결과 확인
-- SELECT ba.rank, p.family_name, p.given_name
--   FROM public.badge_awards ba
--   JOIN public.badges   b ON b.id = ba.badge_id
--   JOIN public.profiles p ON p.id = ba.profile_id
--  WHERE b.code = 'rhythm_rank'
--  ORDER BY ba.rank;


-- ════════════════════════════════════════════════════════════════════
-- 완전 철거 (뱃지 시스템 테스트를 끝내고 유틸 함수를 제거하려면)
-- ════════════════════════════════════════════════════════════════════
-- DROP FUNCTION IF EXISTS public.test_revoke_badges(uuid, text);
-- DROP FUNCTION IF EXISTS public.test_reset_stat(uuid, text);
-- DROP FUNCTION IF EXISTS public.test_clear_rank_slots(text);
