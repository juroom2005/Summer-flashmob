-- sql/pending/2026-08-03_dish_mobil_scale_down.sql
-- ═══════════════════════════════════════════════════════════════════
-- 설거지 (cafe_dish) mobil 구간표 축소
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 (세션 K) :
--   설거지 밸런스 문제.
--   · 별 3 (주문받기) 두 개 틀림 → 대략 3,300 mobil 수령
--   · 별 1 (설거지) 만점    → 3,000 (기본) + 300 (퍼펙트) = 3,300 mobil
--   난이도 대비 리워드 역전. 별 3 힘들게 만들었는데 별 1 만점과 동등.
--
-- 해결 :
--   설거지 전용 mobil 구간표 (기존 기준 대비 축소).
--   음료제조 · 주문받기 구간표는 기존 그대로.
--   퍼펙트 보너스는 세 게임 공통 유지 (+300).
--
-- 신규 설거지 구간표 :
--   90~100 : 2,200
--   80~ 89 : 1,900
--   70~ 79 : 1,600
--   60~ 69 : 1,300
--   10~ 59 : 1,000
--   0~  9 :   300
--
-- 만점 (100점) 시 리워드 (game 별) :
--   설거지     : 2,200 + 300(퍼펙트) + 0(난이도)     = 2,500  ← 신규 상한
--   음료제조   : 3,000 + 300(퍼펙트) + 400(난이도★★)  = 3,700
--   주문받기   : 3,000 + 300(퍼펙트) + 900(난이도★★★) = 4,200
--
-- 시그니처 :
--   기존 함수 반환 시그니처 동일 (16 필드).
--   CREATE OR REPLACE 로 처리 가능. DROP 불필요.
--
-- 롤백 :
--   선행 마이그레이션 (2026-07-30_play_cafe_minigame_with_difficulty.sql)
--   의 함수 정의를 다시 실행하면 모든 게임에 통일 구간표로 복귀.
--
-- 선행 마이그레이션 :
--   sql/applied/2026-07-30_play_cafe_minigame_with_difficulty.sql
--
-- 실행 검증 :
--   대시보드 SQL Editor 에서 SELECT play_cafe_minigame(...) 직접 호출은
--   auth.uid()=null 이라 'auth_required' 예외 정상. 브라우저 로그인 세션에서
--   실플레이 후 mobil 수령량 확인 필요.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.play_cafe_minigame(
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

  -- ── mobil 기본 산정 (점수 구간표, 게임별 분기) ────
  --   설거지 (cafe_dish) : 별 1 리워드 축소 (밸런스 조정, 세션 K)
  --   그 외 (cafe_mix, cafe_order) : 기존 구간표 유지
  IF p_minigame_code = 'cafe_dish' THEN
    IF p_score >= 90 THEN
      v_mobil_base_amt := 2200;
    ELSIF p_score >= 80 THEN
      v_mobil_base_amt := 1900;
    ELSIF p_score >= 70 THEN
      v_mobil_base_amt := 1600;
    ELSIF p_score >= 60 THEN
      v_mobil_base_amt := 1300;
    ELSIF p_score >= 10 THEN
      v_mobil_base_amt := 1000;
    ELSE
      v_mobil_base_amt := 300;
    END IF;
  ELSE
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
  END IF;

  -- 퍼펙트 보너스 (score = 100 만, 게임 공통)
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
-- 실행 확인 (수동 검증)
-- ─────────────────────────────────────────────────────────────────────
-- 1) 함수 등록 재확인
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--     FROM pg_proc
--    WHERE proname = 'play_cafe_minigame';
--
-- 2) 브라우저 로그인 세션에서 카페 → 설거지 실플레이 :
--   · 만점(100) → mobil +2,500 확인 (base 2200 + perfect 300)
--   · 60점       → mobil +1,300 확인 (base 1300)
--
-- 3) 대조 검증 : 주문받기·음료제조 는 구간표 변경 없음.
--   · 주문받기 만점 → mobil +4,200 (변화 없음)
--   · 음료제조 만점 → mobil +3,700 (변화 없음)
-- ═══════════════════════════════════════════════════════════════════
