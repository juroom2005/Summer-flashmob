-- sql/pending/2026-07-29_minigame_cafe_rpcs.sql
-- ═══════════════════════════════════════════════════════════════════
-- 카페알바 미니게임 실행 RPC 2 종 신설
--   · play_cafe_minigame       : 게임 완주 결과 제출 → 보상 지급 · 이력 저장
--   · get_today_minigame_status : 오늘 소진 횟수 · 남은 횟수 · 미니게임 전역 활성 조회
-- ═══════════════════════════════════════════════════════════════════
--
-- 밸런싱 방침 (세션 J 확정) :
--   · 하루 총 3 회 미니게임 (KST 기준. 카페 · 연습실 · 리듬게임 자유 조합.
--     지금은 카페만 존재하므로 사실상 카페 3 회.)
--   · 완주만 카운트 · 보상 지급. 중도 이탈은 이 RPC 를 호출하지 않음.
--   · 보상 :
--       - 표현력 exp : 완주 시 +5 고정 (점수 무관)
--       - 체력 exp   : 완주 시 +8 고정 (점수 무관)
--       - exp 는 컬럼 CHECK (0..450) 상한을 넘지 않도록 LEAST 로 clamp
--       - mobil : 점수 구간별 차등
--   · mobil 지급표 (세션 J 확정) :
--       90~100 : 3000
--       80~ 89 : 2700
--       70~ 79 : 2400
--       60~ 69 : 2100
--       10~ 59 : 1800
--        0~  9 :  500
--   · 퍼펙트 보너스 : 100 점 도달 시 mobil + 300 (세 미니게임 동일)
--
-- 스탯 저장 방침 :
--   · minigame_plays.target_stat = 'expression' 통일
--   · minigame_plays.stat_gained = 표현력 exp 지급량 (5)
--   · 체력 exp 는 minigame_plays.result_detail.physical_gained 에 기록
--   · 클라이언트가 넘긴 result_detail 상세 (미스 수 · 레이어 순서 등) 는
--     내부 필드로 병합해 함께 저장 (result_detail || jsonb 값)
--
-- 동시성 · 정합성 :
--   · profiles FOR UPDATE 로 유저 단위 직렬화. 같은 유저의 동시 완주 방지.
--   · 하루 카운트 검증은 profiles 락 획득 이후에 수행. 다른 세션이 3 회째
--     기록하는 사이 이 세션이 4 회째 시도할 수 없음.
--   · site_settings.minigame_enabled 가 false 이면 RPC 자체가 거부.
--     UI 는 진입 자체를 막지만 이중 방어.
--
-- 실패 시 원자성 :
--   · PL/pgSQL 함수는 기본적으로 하나의 트랜잭션 단위로 실행됨.
--     예외 raise 시 함수 안의 모든 UPDATE / INSERT 는 자동 롤백.
--   · CREATE OR REPLACE FUNCTION 은 기존 함수 원자적 교체.
--     실행 중인 다른 트랜잭션에는 영향 없음.
--
-- 예외 코드 (클라이언트 helper 가 매핑) :
--   auth_required            : 로그인 안 됨
--   profile_not_found        : profiles row 없음
--   minigame_disabled        : site_settings.minigame_enabled = false
--   minigame_not_found       : code 로 minigames row 조회 실패
--   minigame_inactive        : minigames.is_active = false
--   invalid_category         : 카페알바 RPC 인데 다른 category 인 게임 지정
--   invalid_score            : score 가 0~100 범위 밖
--   daily_limit_exceeded     : 오늘 이미 3 회 완주
--
-- 롤백 :
--   DROP FUNCTION IF EXISTS public.play_cafe_minigame(text, integer, jsonb);
--   DROP FUNCTION IF EXISTS public.get_today_minigame_status();
--
-- 선행 마이그레이션 : 2026-07-29_minigame_cafe_seed.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1) play_cafe_minigame
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.play_cafe_minigame(
  p_minigame_code text,
  p_score         integer,
  p_result_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  next_mobil          integer,
  next_expression_exp integer,
  next_physical_exp   integer,
  mobil_gained        integer,
  expression_gained   integer,
  physical_gained     integer,
  plays_today         integer,
  plays_remaining     integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id            uuid;
  v_profile_id         uuid;
  v_mobil              integer;
  v_expression_exp     integer;
  v_physical_exp       integer;
  v_minigame           RECORD;
  v_minigame_enabled   boolean;
  v_today              date;
  v_plays_today        integer;
  v_daily_limit        constant integer := 3;
  v_expression_gain    constant integer := 5;
  v_physical_gain      constant integer := 8;
  v_perfect_bonus      constant integer := 300;
  v_exp_cap            constant integer := 450;
  v_mobil_gained       integer;
  v_next_mobil         integer;
  v_next_expression    integer;
  v_next_physical      integer;
  v_result_detail      jsonb;
BEGIN
  -- ── 인증 확인 ──────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- ── 미니게임 전역 활성 확인 ────────────────────────
  SELECT minigame_enabled INTO v_minigame_enabled
    FROM public.site_settings
   WHERE id = 1;
  IF v_minigame_enabled IS NULL OR v_minigame_enabled = false THEN
    RAISE EXCEPTION 'minigame_disabled';
  END IF;

  -- ── score 범위 검증 ───────────────────────────────
  IF p_score IS NULL OR p_score < 0 OR p_score > 100 THEN
    RAISE EXCEPTION 'invalid_score';
  END IF;

  -- ── 미니게임 마스터 조회 ──────────────────────────
  SELECT id, code, category, target_stat, is_active
    INTO v_minigame
    FROM public.minigames
   WHERE code = p_minigame_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'minigame_not_found';
  END IF;
  IF v_minigame.is_active = false THEN
    RAISE EXCEPTION 'minigame_inactive';
  END IF;
  IF v_minigame.category <> 'cafe' THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;

  -- ── 프로필 잠금 (유저 단위 직렬화) ────────────────
  SELECT id, mobil, expression_exp, physical_exp
    INTO v_profile_id, v_mobil, v_expression_exp, v_physical_exp
    FROM public.profiles
   WHERE user_id = v_user_id
   FOR UPDATE;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- ── 오늘 KST 기준 완주 횟수 (락 획득 후 검증) ─────
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT count(*) INTO v_plays_today
    FROM public.minigame_plays
   WHERE profile_id = v_profile_id
     AND play_date  = v_today;

  IF v_plays_today >= v_daily_limit THEN
    RAISE EXCEPTION 'daily_limit_exceeded';
  END IF;

  -- ── mobil 지급량 산정 (점수 구간표) ───────────────
  IF p_score >= 90 THEN
    v_mobil_gained := 3000;
  ELSIF p_score >= 80 THEN
    v_mobil_gained := 2700;
  ELSIF p_score >= 70 THEN
    v_mobil_gained := 2400;
  ELSIF p_score >= 60 THEN
    v_mobil_gained := 2100;
  ELSIF p_score >= 10 THEN
    v_mobil_gained := 1800;
  ELSE
    v_mobil_gained := 500;
  END IF;

  -- 퍼펙트 보너스
  IF p_score = 100 THEN
    v_mobil_gained := v_mobil_gained + v_perfect_bonus;
  END IF;

  -- ── exp 지급량 산정 (완주 고정 · 상한 clamp) ─────
  v_next_expression := LEAST(v_expression_exp + v_expression_gain, v_exp_cap);
  v_next_physical   := LEAST(v_physical_exp   + v_physical_gain,   v_exp_cap);
  v_next_mobil      := v_mobil + v_mobil_gained;

  -- ── 프로필 반영 ───────────────────────────────────
  UPDATE public.profiles
     SET mobil          = v_next_mobil,
         expression_exp = v_next_expression,
         physical_exp   = v_next_physical
   WHERE id = v_profile_id;

  -- ── result_detail 병합 (클라 상세 + 지급 내역) ────
  v_result_detail := COALESCE(p_result_detail, '{}'::jsonb)
                     || jsonb_build_object(
                       'physical_gained',   v_physical_gain,
                       'expression_gained', v_expression_gain,
                       'mobil_gained',      v_mobil_gained,
                       'perfect',           (p_score = 100)
                     );

  -- ── 플레이 이력 저장 ─────────────────────────────
  INSERT INTO public.minigame_plays
    (minigame_id, profile_id, score, stat_gained, mobil_gained,
     target_stat, play_date, result_detail)
  VALUES
    (v_minigame.id, v_profile_id, p_score, v_expression_gain, v_mobil_gained,
     v_minigame.target_stat, v_today, v_result_detail);

  -- ── 반환 ─────────────────────────────────────────
  next_mobil          := v_next_mobil;
  next_expression_exp := v_next_expression;
  next_physical_exp   := v_next_physical;
  mobil_gained        := v_mobil_gained;
  expression_gained   := v_expression_gain;
  physical_gained     := v_physical_gain;
  plays_today         := v_plays_today + 1;
  plays_remaining     := v_daily_limit - (v_plays_today + 1);
  RETURN NEXT;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────
-- 2) get_today_minigame_status
--   · 카페 화면 진입 시 · 미니게임 시작 전 확인용
--   · 인증 필수. 유저 본인의 오늘 소진 상태만 반환.
-- ─────────────────────────────────────────────────────────────────
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
AS $function$
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

  SELECT minigame_enabled INTO v_enabled
    FROM public.site_settings
   WHERE id = 1;
  v_enabled := COALESCE(v_enabled, false);

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT count(*) INTO v_plays_today
    FROM public.minigame_plays
   WHERE profile_id = v_profile_id
     AND play_date  = v_today;

  plays_today      := v_plays_today;
  plays_remaining  := GREATEST(v_daily_limit - v_plays_today, 0);
  daily_limit      := v_daily_limit;
  minigame_enabled := v_enabled;
  RETURN NEXT;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인 (수동 검증용)
-- ─────────────────────────────────────────────────────────────────────
-- 1) 함수 정의 재확인
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--     FROM pg_proc
--    WHERE proname IN ('play_cafe_minigame','get_today_minigame_status');
--
-- 2) 오늘 상태 조회 (로그인 상태에서)
--   SELECT * FROM public.get_today_minigame_status();
--
-- 3) 게임 완주 시뮬레이션 (로그인 상태에서)
--   SELECT * FROM public.play_cafe_minigame('cafe_order', 92,
--            jsonb_build_object('miss_count', 0));
--
-- 4) 예외 확인
--   SELECT * FROM public.play_cafe_minigame('cafe_order', 150, '{}'::jsonb);
--      → invalid_score 예외
--   SELECT * FROM public.play_cafe_minigame('nonexistent', 80, '{}'::jsonb);
--      → minigame_not_found 예외
-- ═══════════════════════════════════════════════════════════════════
