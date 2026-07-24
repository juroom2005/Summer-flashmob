-- sql/pending/2026-07-24_stat_level_gm_rpcs.sql
-- ═══════════════════════════════════════════════════════════════════
-- GM RPC 스탯 개편 반영
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 : summer_flashmob_handoff_v8.md §2-4, §4-1
--
-- 선행 마이그레이션 :
--   sql/applied/2026-07-24_stat_level_migration.sql (완료됨)
--   → profiles.*_stat 컬럼이 없어졌으므로 이 두 RPC 는 현재 호출 불가 상태.
--   → 재정의 필요.
--
-- 대상 RPC 2개
--
--   1) gm_list_users
--        - 반환 TABLE 에 rhythm_stat/physical_stat/expression_stat 포함
--        - 컬럼이 없어져 SELECT 자체가 실패함. 함수 시그니처 재정의 필요.
--        - 신규 반환 : rhythm_exp/rhythm_level 등 6 필드 (exp + level 각 쌍)
--
--   2) gm_adjust_user_stats
--        - 파라미터명은 유지 (p_rhythm_delta, p_physical_delta, p_expression_delta)
--          "스탯 종류" 를 가리키는 이름이라 리네임 불필요
--        - 반환 TABLE 재정의 : rhythm_exp/rhythm_level 등 6 필드
--        - 클램프 범위 0~100 → 0~450
--
-- 실행 순서 함정
--   - RETURNS TABLE 시그니처 변경은 CREATE OR REPLACE 로 안 됨.
--     반드시 DROP FUNCTION 후 CREATE.
--   - DROP 시 인자 시그니처를 정확히 명시해 다른 오버로드를 실수로 지우지 않도록.
--   - 전체 트랜잭션으로 감싸 실패 시 롤백.
--
-- 안정성 방침
--   - SECURITY DEFINER 유지. search_path 명시.
--   - assert_caller_is_gm() 호출 방식 그대로.
--   - profile 존재 확인 방식 그대로.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) gm_list_users 재정의
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.gm_list_users(boolean);

CREATE FUNCTION public.gm_list_users(p_include_inactive boolean DEFAULT false)
RETURNS TABLE(
  id                uuid,
  user_id           uuid,
  email             text,
  family_name       text,
  given_name        text,
  age               integer,
  gender            text,
  school_name       text,
  grade             integer,
  rhythm_exp        integer,
  rhythm_level      integer,
  physical_exp      integer,
  physical_level    integer,
  expression_exp    integer,
  expression_level  integer,
  mobil             integer,
  is_gm             boolean,
  is_registered     boolean,
  deactivated_at    timestamp with time zone,
  created_at        timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  RETURN QUERY
  SELECT
    p.id,
    p.user_id,
    u.email::text,
    p.family_name,
    p.given_name,
    p.age,
    p.gender,
    p.school_name,
    p.grade,
    p.rhythm_exp,
    p.rhythm_level,
    p.physical_exp,
    p.physical_level,
    p.expression_exp,
    p.expression_level,
    p.mobil,
    p.is_gm,
    (p.user_id IS NOT NULL) AS is_registered,
    p.deactivated_at,
    p.created_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.user_id
  WHERE (p_include_inactive OR p.deactivated_at IS NULL)
  ORDER BY p.is_gm DESC, p.created_at DESC;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────
-- 2) gm_adjust_user_stats 재정의
--
--    파라미터명 유지. 반환 필드는 exp + level 6 필드.
--    level 은 DB GENERATED STORED 컬럼이라 UPDATE 후 자동으로 새 값이 들어감.
--    RETURNING 절에서 그대로 반환.
--
--    클램프 :
--      exp = GREATEST(0, LEAST(450, 현재 + 델타))
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.gm_adjust_user_stats(uuid, integer, integer, integer);

CREATE FUNCTION public.gm_adjust_user_stats(
  p_profile_id       uuid,
  p_rhythm_delta     integer DEFAULT 0,
  p_physical_delta   integer DEFAULT 0,
  p_expression_delta integer DEFAULT 0
)
RETURNS TABLE(
  rhythm_exp        integer,
  rhythm_level      integer,
  physical_exp      integer,
  physical_level    integer,
  expression_exp    integer,
  expression_level  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  RETURN QUERY
  UPDATE public.profiles p
     SET rhythm_exp     = GREATEST(0, LEAST(450, p.rhythm_exp     + COALESCE(p_rhythm_delta,     0))),
         physical_exp   = GREATEST(0, LEAST(450, p.physical_exp   + COALESCE(p_physical_delta,   0))),
         expression_exp = GREATEST(0, LEAST(450, p.expression_exp + COALESCE(p_expression_delta, 0)))
   WHERE p.id = p_profile_id
   RETURNING
     p.rhythm_exp,
     p.rhythm_level,
     p.physical_exp,
     p.physical_level,
     p.expression_exp,
     p.expression_level;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 검증
-- ═══════════════════════════════════════════════════════════════════

-- (1) 시그니처 확인 : 재정의된 두 함수의 인자·반환 타입이 예상대로인지
SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid)        AS arguments,
  pg_get_function_result(p.oid)           AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('gm_list_users', 'gm_adjust_user_stats')
ORDER BY p.proname;

-- (2) gm_list_users 호출 확인
--     주의 : 이 SELECT 는 GM 계정으로 실행할 때만 성공. 대시보드 SQL Editor 는
--            supabase_admin 세션이라 auth.uid() 가 NULL 이므로 assert 에서
--            'auth_required' 로 실패한다. 실패해도 정상 (프론트에서 검증하면 됨).
--     반환 컬럼 이름만 보고 싶다면 아래 형태로 :
--
-- SELECT * FROM public.gm_list_users(false) LIMIT 0;
--
-- (3) gm_adjust_user_stats 호출은 대시보드에서 실행하지 말 것.
--     실제 데이터가 변경됨. 프론트 재작업 후 GM UI 를 통해 검증하도록 남겨둠.
