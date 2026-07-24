-- sql/pending/2026-07-24_stat_level_invite_rpc.sql
-- ═══════════════════════════════════════════════════════════════════
-- generate_invite_with_shell RPC 스탯 개편 반영
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 : summer_flashmob_handoff_v8.md §2-4, §4-1
--
-- 선행 마이그레이션 :
--   sql/applied/2026-07-24_stat_level_migration.sql
--   sql/applied/2026-07-24_stat_level_gm_rpcs.sql
--
-- 변경점
--   · 파라미터명 : p_rhythm_stat → p_rhythm_exp (저장 계층 관점 통일)
--   · INSERT 컬럼 : rhythm_stat → rhythm_exp
--   · 클램프는 하지 않음. 0~450 범위는 DB CHECK 가 담당.
--     COALESCE 만 유지해 NULL 방어.
--   · 5 포인트 초과 검증은 EF 에서 담당 (RPC 는 저장만).
--     비즈니스 검증을 두 계층에 두면 로직 이중화로 오히려 위험.
--
-- 시그니처 변경이므로 CREATE OR REPLACE 불가. DROP + CREATE.
-- 전체 트랜잭션으로 감싸 실패 시 롤백.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.generate_invite_with_shell(
  text, uuid, timestamptz, text, text, text, integer, text, text, integer,
  integer, integer, integer
);

CREATE FUNCTION public.generate_invite_with_shell(
  p_code           text,
  p_gm_profile_id  uuid,
  p_expires_at     timestamp with time zone,
  p_invitee_note   text,
  p_family_name    text,
  p_given_name     text,
  p_age            integer,
  p_gender         text,
  p_school_name    text,
  p_grade          integer,
  p_rhythm_exp     integer DEFAULT 0,
  p_physical_exp   integer DEFAULT 0,
  p_expression_exp integer DEFAULT 0
)
RETURNS TABLE(code text, expires_at timestamp with time zone, profile_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_shell_id uuid;
BEGIN
  -- 1) shell profile INSERT (user_id null 상태 + 초기 exp)
  --    exp 는 EF 에서 이미 검증된 값이 들어옴.
  --    NULL 이 들어와도 안전하도록 COALESCE 로 0 처리.
  --    0~450 범위는 DB CHECK 가 최종 방어.
  INSERT INTO profiles (
    family_name, given_name, age, gender, school_name, grade,
    rhythm_exp, physical_exp, expression_exp
  ) VALUES (
    p_family_name, p_given_name, p_age, p_gender, p_school_name, p_grade,
    COALESCE(p_rhythm_exp, 0),
    COALESCE(p_physical_exp, 0),
    COALESCE(p_expression_exp, 0)
  )
  RETURNING id INTO v_shell_id;

  -- 2) invite_codes INSERT
  INSERT INTO invite_codes (
    code, profile_id, issued_by, expires_at, invitee_note
  ) VALUES (
    p_code, v_shell_id, p_gm_profile_id, p_expires_at, p_invitee_note
  );

  -- 3) 결과 반환
  RETURN QUERY
  SELECT p_code, p_expires_at, v_shell_id;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 검증
-- ═══════════════════════════════════════════════════════════════════

-- 시그니처 확인
SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid)        AS arguments,
  pg_get_function_result(p.oid)           AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'generate_invite_with_shell';

-- 실제 호출 검증은 대시보드에서 하지 말 것. shell profile 이 실제로 생성됨.
-- EF (generate-invite) 재배포 후 GM UI 를 통해 검증한다.
