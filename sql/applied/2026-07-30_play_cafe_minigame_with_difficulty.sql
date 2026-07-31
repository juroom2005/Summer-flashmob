-- sql/pending/2026-07-30_play_cafe_minigame_with_difficulty.sql
-- ═══════════════════════════════════════════════════════════════════
-- play_cafe_minigame 재정의 : 난이도 기반 리워드 가산
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 (세션 J-α) :
--   설거지·음료제조·주문받기 세 게임의 난이도 차이를 리워드에 반영.
--   완주 시 기본 지급에 metadata 의 mobil_bonus / stat_bonus 를 얹는다.
--
-- 계산 로직 :
--   · mobil_base            : 점수 구간표 (0~9=500, 10~59=1800, 60~69=2100,
--                              70~79=2400, 80~89=2700, 90~100=3000)
--   · mobil_perfect_bonus   : score=100 이면 +300 (게임 공통)
--   · mobil_difficulty_bonus: metadata->>'mobil_bonus'
--   · expression_base       : +5 (게임 공통)
--   · expression_bonus      : metadata->'stat_bonus'->>'expression'
--   · physical_base         : +8 (게임 공통)
--   · physical_bonus        : metadata->'stat_bonus'->>'physical'
--   · 최종 지급             : base + bonus + (perfect_bonus, mobil 만)
--   · exp 는 컬럼 CHECK (0..450) 로 clamp
--
-- 반환 시그니처 변경 (breakdown 필드 추가) :
--   기존 8 필드 + 신규 8 필드 = 16 필드.
--   CREATE OR REPLACE 는 시그니처 변경 불가 → DROP FUNCTION 후 CREATE.
--
-- 이력 저장 (minigame_plays) :
--   · stat_gained  : expression_base + expression_bonus (총합)
--   · mobil_gained : 최종 지급 mobil (base + difficulty + perfect)
--   · result_detail:
--       - 클라이언트가 넘긴 상세 (miss_count 등)
--       - breakdown : 서버 계산 내역 (base/bonus 분리)
--       - physical_gained : 체력 총 지급 (base + bonus)
--
-- 안전장치 :
--   · SECURITY DEFINER · search_path = 'public' (기존 방침 유지)
--   · profiles FOR UPDATE 로 유저 단위 직렬화
--   · 하루 3회 검증
--   · minigame 카테고리 = 'cafe' 검증
--   · metadata 필드 없거나 잘못된 값이면 각 bonus 는 0 취급 (안전 fallback)
--
-- 실행 순서 함정 :
--   RETURNS TABLE 시그니처 변경은 CREATE OR REPLACE 로 안 됨.
--   반드시 DROP FUNCTION 후 CREATE.
--   DROP 시 인자 시그니처를 정확히 명시.
--
-- 롤백 :
--   선행 마이그레이션 (2026-07-29_minigame_cafe_rpcs.sql) 의 함수 정의를
--   다시 실행하면 이전 시그니처로 복귀.
--
-- 선행 마이그레이션 :
--   sql/applied/2026-07-29_minigame_cafe_rpcs.sql
--   sql/pending/2026-07-30_minigame_difficulty_metadata.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 시그니처 변경 → 기존 함수 DROP 후 재생성
DROP FUNCTION IF EXISTS public.play_cafe_minigame(text, integer, jsonb);

CREATE FUNCTION public.play_cafe_minigame(
  p_minigame_code text,
  p_score         integer,
  p_result_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  next_mobil               integer,
  next_expression_exp      integer,
  next_physical_exp        integer,
  mobil_gained             integer,
  expression_gained        integer,
  physical_gained          integer,
  plays_today              integer,
  plays_remaining          integer,
  difficulty               integer,
  mobil_base               integer,
  mobil_difficulty_bonus   integer,
  mobil_perfect_bonus      integer,
  expression_base          integer,
  expression_bonus         integer,
  physical_base            integer,
  physical_bonus           integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  v_expression_base    constant integer := 5;
  v_physical_base      constant integer := 8;
  v_perfect_bonus      constant integer := 300;
  v_exp_cap            constant integer := 450;
  v_difficulty         integer;
  v_mobil_bonus        integer;
  v_expression_bonus   integer;
  v_physical_bonus     integer;
  v_mobil_base_amt     integer;
  v_mobil_perfect_amt  integer;
  v_expression_total   integer;
  v_physical_total     integer;
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
  SELECT s.minigame_enabled INTO v_minigame_enabled
    FROM public.site_settings AS s
   WHERE s.id = 1;
  IF v_minigame_enabled IS NULL OR v_minigame_enabled = false THEN
    RAISE EXCEPTION 'minigame_disabled';
  END IF;

  -- ── score 범위 검증 ──────────────────────────────
  IF p_score IS NULL OR p_score < 0 OR p_score > 100 THEN
    RAISE EXCEPTION 'invalid_score';
  END IF;

  -- ── 미니게임 마스터 조회 ─────────────────────────
  SELECT mg.id, mg.code, mg.category, mg.target_stat, mg.is_active, mg.metadata
    INTO v_minigame
    FROM public.minigames AS mg
   WHERE mg.code = p_minigame_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'minigame_not_found';
  END IF;
  IF v_minigame.is_active = false THEN
    RAISE EXCEPTION 'minigame_inactive';
  END IF;
  IF v_minigame.category <> 'cafe' THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;

  -- ── 프로필 잠금 ──────────────────────────────────
  SELECT id, mobil, expression_exp, physical_exp
    INTO v_profile_id, v_mobil, v_expression_exp, v_physical_exp
    FROM public.profiles
   WHERE user_id = v_user_id
   FOR UPDATE;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- ── 오늘 KST 완주 횟수 검증 ──────────────────────
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT count(*) INTO v_plays_today
    FROM public.minigame_plays AS mp
   WHERE mp.profile_id = v_profile_id
     AND mp.play_date  = v_today;

  IF v_plays_today >= v_daily_limit THEN
    RAISE EXCEPTION 'daily_limit_exceeded';
  END IF;

  -- ── metadata 에서 난이도·가산 읽기 (안전 fallback) ─
  v_difficulty       := COALESCE((v_minigame.metadata->>'difficulty')::integer, 1);
  v_mobil_bonus      := COALESCE((v_minigame.metadata->>'mobil_bonus')::integer, 0);
  v_expression_bonus := COALESCE(
    (v_minigame.metadata->'stat_bonus'->>'expression')::integer, 0
  );
  v_physical_bonus   := COALESCE(
    (v_minigame.metadata->'stat_bonus'->>'physical')::integer, 0
  );
  -- 음수 방어
  IF v_mobil_bonus      < 0 THEN v_mobil_bonus      := 0; END IF;
  IF v_expression_bonus < 0 THEN v_expression_bonus := 0; END IF;
  IF v_physical_bonus   < 0 THEN v_physical_bonus   := 0; END IF;

  -- ── mobil 기본 산정 (점수 구간표) ─────────────────
  IF p_score >= 90 THEN
    v_mobil_base_amt := 3000;
  ELSIF p_score >= 80 THEN
    v_mobil_base_amt := 2700;
  ELSIF p_score >= 70 THEN
    v_mobil_base_amt := 2400;
  ELSIF p_score >= 60 THEN
    v_mobil_base_amt := 2100;
  ELSIF p_score >= 10 THEN
    v_mobil_base_amt := 1800;
  ELSE
    v_mobil_base_amt := 500;
  END IF;

  -- 퍼펙트 보너스 (score = 100 만)
  IF p_score = 100 THEN
    v_mobil_perfect_amt := v_perfect_bonus;
  ELSE
    v_mobil_perfect_amt := 0;
  END IF;

  v_mobil_gained := v_mobil_base_amt + v_mobil_bonus + v_mobil_perfect_amt;

  -- ── 스탯 총합 산정 (base + bonus, 상한 clamp) ────
  v_expression_total := v_expression_base + v_expression_bonus;
  v_physical_total   := v_physical_base   + v_physical_bonus;

  v_next_expression := LEAST(v_expression_exp + v_expression_total, v_exp_cap);
  v_next_physical   := LEAST(v_physical_exp   + v_physical_total,   v_exp_cap);
  v_next_mobil      := v_mobil + v_mobil_gained;

  -- ── 프로필 반영 ─────────────────────────────────
  UPDATE public.profiles
     SET mobil          = v_next_mobil,
         expression_exp = v_next_expression,
         physical_exp   = v_next_physical
   WHERE id = v_profile_id;

  -- ── result_detail 병합 (클라 상세 + 서버 breakdown) ─
  v_result_detail := COALESCE(p_result_detail, '{}'::jsonb)
                     || jsonb_build_object(
                       'physical_gained',   v_physical_total,
                       'expression_gained', v_expression_total,
                       'mobil_gained',      v_mobil_gained,
                       'perfect',           (p_score = 100),
                       'breakdown',         jsonb_build_object(
                         'difficulty',             v_difficulty,
                         'mobil_base',             v_mobil_base_amt,
                         'mobil_difficulty_bonus', v_mobil_bonus,
                         'mobil_perfect_bonus',    v_mobil_perfect_amt,
                         'expression_base',        v_expression_base,
                         'expression_bonus',       v_expression_bonus,
                         'physical_base',          v_physical_base,
                         'physical_bonus',         v_physical_bonus
                       )
                     );

  -- ── 플레이 이력 저장 ────────────────────────────
  INSERT INTO public.minigame_plays
    (minigame_id, profile_id, score, stat_gained, mobil_gained,
     target_stat, play_date, result_detail)
  VALUES
    (v_minigame.id, v_profile_id, p_score, v_expression_total, v_mobil_gained,
     v_minigame.target_stat, v_today, v_result_detail);

  -- ── 반환 ────────────────────────────────────────
  next_mobil             := v_next_mobil;
  next_expression_exp    := v_next_expression;
  next_physical_exp      := v_next_physical;
  mobil_gained           := v_mobil_gained;
  expression_gained      := v_expression_total;
  physical_gained        := v_physical_total;
  plays_today            := v_plays_today + 1;
  plays_remaining        := v_daily_limit - (v_plays_today + 1);
  difficulty             := v_difficulty;
  mobil_base             := v_mobil_base_amt;
  mobil_difficulty_bonus := v_mobil_bonus;
  mobil_perfect_bonus    := v_mobil_perfect_amt;
  expression_base        := v_expression_base;
  expression_bonus       := v_expression_bonus;
  physical_base          := v_physical_base;
  physical_bonus         := v_physical_bonus;
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
--    WHERE proname = 'play_cafe_minigame';
--
-- 2) 브라우저 로그인 세션에서 호출. SQL Editor 직접 호출은 auth_required.
-- ═══════════════════════════════════════════════════════════════════
