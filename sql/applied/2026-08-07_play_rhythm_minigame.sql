-- sql/pending/2026-08-07_play_rhythm_minigame.sql
-- ═══════════════════════════════════════════════════════════════════
-- play_rhythm_minigame : 리듬게임 전용 RPC 신설
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 (세션 M) :
--   세션 L 아키텍처 옵션 B (별도 RPC 신설) 원칙 유지.
--   카페 · 연습실 RPC 무변경 · 리듬은 완전 격리된 함수.
--
-- 카페 · 연습실 RPC 와의 근본 차이 :
--   1) 선택 스탯 매개변수 신설  : p_selected_stat text ('rhythm' | 'expression')
--   2) mobil 지급 없음          : v_mobil_gained = 0 상수, base 계산 skip
--   3) 스탯 exp 구간표 방식     : 점수 구간에 따라 exp 값이 변동
--                                (알바는 5+bonus 고정, 리듬은 18~30 점수 연동)
--   4) 스탯 대상 컬럼 동적 결정 : rhythm_exp 또는 expression_exp 중 선택
--   5) target_stat 기록 방식    : v_minigame.target_stat 이 아닌
--                                p_selected_stat 값을 minigame_plays 에 기록
--   6) result_detail 필드명     : selected_stat / selected_stat_gained 신설
--
-- 카페 · 연습실 RPC 와 공유하는 로직 (물리적으로 중복 코드) :
--   · 인증 확인 (auth.uid())
--   · 미니게임 전역 활성 확인 (site_settings.minigame_enabled)
--   · score 범위 검증 (0..100)
--   · 미니게임 마스터 조회
--   · 프로필 FOR UPDATE 락
--   · 하루 KST 3회 검증 (카페 + 연습실 + 리듬 통합 카운트)
--   · exp cap (450) LEAST clamp
--   · profiles UPDATE
--   · result_detail 병합 + breakdown 기록
--   · minigame_plays INSERT
--
-- 하루 3회 통합 카운트 :
--   기존 카페 · 연습실 RPC 와 동일한 방식.
--     SELECT count(*) FROM minigame_plays
--      WHERE profile_id = <자기> AND play_date = <오늘 KST>;
--   category 조건 없이 그냥 개수 셈. 리듬 플레이도 여기 그대로 잡히므로
--   3개 게임 통합 3회 제한이 자연스럽게 성립.
--
-- 스탯 exp 구간표 (원안 v8 §2-4 정확 반영) :
--   ┌──────────────┬─────────────┬─────────────┐
--   │  score       │ selected exp │ physical exp │
--   ├──────────────┼─────────────┼─────────────┤
--   │  score = 100 │  30 (퍼펙트)│  12         │
--   │  score >= 90 │  30         │  12         │  ← 원안 상한
--   │  score >= 70 │  26         │  11         │
--   │  score >= 50 │  22         │   9         │
--   │  score <  50 │  18         │   7         │  ← 원안 하한 (완주 최소)
--   └──────────────┴─────────────┴─────────────┘
--   완주 개념 : 서버 도달 자체가 완주. score=0 이라도 완주면 하한 exp 지급.
--   중도 이탈은 RPC 자체가 호출되지 않으므로 여기서 처리 불필요.
--
-- 선택 스탯 검증 :
--   · p_selected_stat 은 'rhythm' 또는 'expression' 만 유효.
--     그 외 값 (null · physical · 기타) 은 'invalid_selected_stat' 예외.
--   · target_stat CHECK 는 { rhythm, physical, expression } 허용이지만
--     리듬게임 원안 상 physical 선택은 없음. RPC 단에서 rhythm/expression 만 허용.
--
-- 반환 시그니처 (14 필드, 알바 RPC 와 다른 필드 구성) :
--   next_mobil               integer   (현재 mobil, 변경 없음 · 정보용)
--   next_selected_stat_exp   integer   (rhythm_exp 또는 expression_exp, 지급 후)
--   next_physical_exp        integer
--   mobil_gained             integer   (항상 0)
--   selected_stat            text      ('rhythm' | 'expression')
--   selected_stat_gained     integer   (18~30 구간)
--   physical_gained          integer   (7~12 구간)
--   plays_today              integer
--   plays_remaining          integer
--   difficulty               integer   (metadata.difficulty, 항상 3)
--   selected_stat_base       integer   (구간에서 얻은 base 값, breakdown 용)
--   selected_stat_range_min  integer   (metadata 참고값)
--   selected_stat_range_max  integer
--   physical_base            integer
--
-- 안전장치 :
--   · SECURITY DEFINER · search_path = 'public'
--   · profiles FOR UPDATE 로 유저 단위 직렬화
--   · category = 'rhythm_game' 검증 (오호출 방지)
--   · metadata 필드 fallback (누락 시 원안 기본값 사용)
--   · exp cap (450) clamp
--   · 스탯 exp 는 항상 음수 아님 (LEAST 로 상한만 걸림)
--
-- 실행 함정 :
--   대시보드 SQL Editor 는 postgres 슈퍼유저 세션. auth.uid() = null 이라
--   SELECT play_rhythm_minigame(...) 직접 호출은 'auth_required' 예외 정상.
--   실제 검증은 브라우저 로그인 세션에서 실플레이 진행.
--
-- 롤백 :
--   DROP FUNCTION IF EXISTS public.play_rhythm_minigame(text, integer, text, jsonb);
--
-- 선행 마이그레이션 :
--   sql/pending/2026-08-07_minigame_rhythm_category_check.sql
--   sql/pending/2026-08-07_minigame_rhythm_seed.sql   (반드시 seed 먼저 apply)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 신규 함수. 재배포 안전성 위해 IF EXISTS 로 방어.
DROP FUNCTION IF EXISTS public.play_rhythm_minigame(text, integer, text, jsonb);

CREATE FUNCTION public.play_rhythm_minigame(
  p_minigame_code text,
  p_score         integer,
  p_selected_stat text,
  p_result_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  next_mobil               integer,
  next_selected_stat_exp   integer,
  next_physical_exp        integer,
  mobil_gained             integer,
  selected_stat            text,
  selected_stat_gained     integer,
  physical_gained          integer,
  plays_today              integer,
  plays_remaining          integer,
  difficulty               integer,
  selected_stat_base       integer,
  selected_stat_range_min  integer,
  selected_stat_range_max  integer,
  physical_base            integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id            uuid;
  v_profile_id         uuid;
  v_mobil              integer;
  v_rhythm_exp         integer;
  v_expression_exp     integer;
  v_physical_exp       integer;
  v_selected_exp_now   integer;  -- 지급 전 선택 스탯 exp
  v_next_selected      integer;  -- 지급 후 선택 스탯 exp
  v_minigame           RECORD;
  v_minigame_enabled   boolean;
  v_today              date;
  v_plays_today        integer;
  v_daily_limit        constant integer := 3;
  v_exp_cap            constant integer := 450;
  v_difficulty         integer;
  v_sel_min            integer;
  v_sel_max            integer;
  v_phys_min           integer;
  v_phys_max           integer;
  v_selected_gain      integer;
  v_physical_gain      integer;
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

  -- ── 선택 스탯 검증 ────────────────────────────────
  --   원안 상 rhythm 또는 expression 만 유효. physical 은 허용 안 함.
  IF p_selected_stat IS NULL
     OR p_selected_stat NOT IN ('rhythm', 'expression') THEN
    RAISE EXCEPTION 'invalid_selected_stat';
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
  IF v_minigame.category <> 'rhythm_game' THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;

  -- ── 프로필 잠금 ──────────────────────────────────
  SELECT id, mobil, rhythm_exp, expression_exp, physical_exp
    INTO v_profile_id, v_mobil, v_rhythm_exp, v_expression_exp, v_physical_exp
    FROM public.profiles
   WHERE user_id = v_user_id
   FOR UPDATE;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- ── 오늘 KST 완주 횟수 검증 ──────────────────────
  --   카페 + 연습실 + 리듬게임 통합 카운트 (하루 3회, 카테고리 무관)
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT count(*) INTO v_plays_today
    FROM public.minigame_plays AS mp
   WHERE mp.profile_id = v_profile_id
     AND mp.play_date  = v_today;

  IF v_plays_today >= v_daily_limit THEN
    RAISE EXCEPTION 'daily_limit_exceeded';
  END IF;

  -- ── metadata 에서 스탯 구간 읽기 (안전 fallback) ──
  v_difficulty := COALESCE((v_minigame.metadata->>'difficulty')::integer, 3);
  v_sel_min    := COALESCE(
    (v_minigame.metadata->'selected_stat_range'->>'min')::integer, 18
  );
  v_sel_max    := COALESCE(
    (v_minigame.metadata->'selected_stat_range'->>'max')::integer, 30
  );
  v_phys_min   := COALESCE(
    (v_minigame.metadata->'physical_range'->>'min')::integer, 7
  );
  v_phys_max   := COALESCE(
    (v_minigame.metadata->'physical_range'->>'max')::integer, 12
  );
  -- 음수 · 역전 방어 (min > max 인 경우 등)
  IF v_sel_min  < 0 THEN v_sel_min  := 0; END IF;
  IF v_sel_max  < v_sel_min  THEN v_sel_max  := v_sel_min;  END IF;
  IF v_phys_min < 0 THEN v_phys_min := 0; END IF;
  IF v_phys_max < v_phys_min THEN v_phys_max := v_phys_min; END IF;

  -- ── 점수 구간표 (원안 v8 §2-4 정확 반영) ──────────
  --   완주 최소 : 하한 값
  --   score 100 : 상한 값 (퍼펙트 = 상한 도달)
  --   상하한 사이는 4구간 계단식 (18/22/26/30 · 7/9/11/12)
  --   min / max 를 metadata 에서 받아 균등 분할 방식으로 계산 :
  --     grade 3 (score>=90) : max
  --     grade 2 (score>=70) : max - round((max-min)/3)
  --     grade 1 (score>=50) : min + round((max-min)/3)
  --     grade 0 (score< 50) : min
  IF p_score >= 90 THEN
    v_selected_gain := v_sel_max;
    v_physical_gain := v_phys_max;
  ELSIF p_score >= 70 THEN
    v_selected_gain := v_sel_max - round((v_sel_max  - v_sel_min ) / 3.0)::integer;
    v_physical_gain := v_phys_max - round((v_phys_max - v_phys_min) / 3.0)::integer;
  ELSIF p_score >= 50 THEN
    v_selected_gain := v_sel_min + round((v_sel_max  - v_sel_min ) / 3.0)::integer;
    v_physical_gain := v_phys_min + round((v_phys_max - v_phys_min) / 3.0)::integer;
  ELSE
    v_selected_gain := v_sel_min;
    v_physical_gain := v_phys_min;
  END IF;

  -- ── 선택 스탯의 현재 exp 결정 ─────────────────────
  IF p_selected_stat = 'rhythm' THEN
    v_selected_exp_now := v_rhythm_exp;
  ELSE
    v_selected_exp_now := v_expression_exp;
  END IF;

  -- ── 다음 exp 계산 (cap clamp) ───────────────────
  v_next_selected := LEAST(v_selected_exp_now + v_selected_gain, v_exp_cap);
  v_next_physical := LEAST(v_physical_exp     + v_physical_gain, v_exp_cap);

  -- ── 프로필 반영 (선택 스탯 컬럼만 UPDATE) ─────────
  IF p_selected_stat = 'rhythm' THEN
    UPDATE public.profiles
       SET rhythm_exp   = v_next_selected,
           physical_exp = v_next_physical
     WHERE id = v_profile_id;
  ELSE
    UPDATE public.profiles
       SET expression_exp = v_next_selected,
           physical_exp   = v_next_physical
     WHERE id = v_profile_id;
  END IF;
  -- mobil 은 지급하지 않으므로 UPDATE 대상 아님

  -- ── result_detail 병합 (클라 상세 + 서버 breakdown) ─
  v_result_detail := COALESCE(p_result_detail, '{}'::jsonb)
                     || jsonb_build_object(
                       'selected_stat',        p_selected_stat,
                       'selected_stat_gained', v_selected_gain,
                       'physical_gained',      v_physical_gain,
                       'mobil_gained',         0,
                       'perfect',              (p_score = 100),
                       'breakdown',            jsonb_build_object(
                         'difficulty',              v_difficulty,
                         'selected_stat',           p_selected_stat,
                         'selected_stat_base',      v_selected_gain,
                         'selected_stat_range_min', v_sel_min,
                         'selected_stat_range_max', v_sel_max,
                         'physical_base',           v_physical_gain,
                         'physical_range_min',      v_phys_min,
                         'physical_range_max',      v_phys_max,
                         'mobil_gained',            0
                       )
                     );

  -- ── 플레이 이력 저장 ────────────────────────────
  --   target_stat 컬럼에 실제 선택된 스탯 (p_selected_stat) 기록.
  --   stat_gained 컬럼에는 선택 스탯 획득 exp.
  --   체력 exp 는 result_detail 안에.
  --   mobil_gained 는 0.
  INSERT INTO public.minigame_plays
    (minigame_id, profile_id, score, stat_gained, mobil_gained,
     target_stat, play_date, result_detail)
  VALUES
    (v_minigame.id, v_profile_id, p_score, v_selected_gain, 0,
     p_selected_stat, v_today, v_result_detail);

  -- ── 반환 ────────────────────────────────────────
  next_mobil              := v_mobil;                -- 변경 없음
  next_selected_stat_exp  := v_next_selected;
  next_physical_exp       := v_next_physical;
  mobil_gained            := 0;
  selected_stat           := p_selected_stat;
  selected_stat_gained    := v_selected_gain;
  physical_gained         := v_physical_gain;
  plays_today             := v_plays_today + 1;
  plays_remaining         := v_daily_limit - (v_plays_today + 1);
  difficulty              := v_difficulty;
  selected_stat_base      := v_selected_gain;
  selected_stat_range_min := v_sel_min;
  selected_stat_range_max := v_sel_max;
  physical_base           := v_physical_gain;
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
--    WHERE proname = 'play_rhythm_minigame';
--
-- 2) 대시보드 직접 호출은 auth.uid()=null 이라 'auth_required' 예외 정상.
--    브라우저 로그인 세션에서 실플레이 후 결과 확인.
--
-- 3) 대조 검증 (리듬 seed 배포 후) :
--    · rhythm 만점(100) · rhythm 선택 → rhythm_exp +30, physical_exp +12, mobil +0
--    · rhythm 만점(100) · expression 선택 → expression_exp +30, physical_exp +12
--    · rhythm 완주 최저(0) · rhythm 선택 → rhythm_exp +18, physical_exp +7
--    · rhythm score=70 · expression 선택 → expression_exp +26, physical_exp +11
--
-- 4) 하루 3회 통합 카운트 확인 :
--    · 오늘 이미 카페 3회 완주한 유저 → 리듬 진입 시 'daily_limit_exceeded'
--    · 오늘 리듬 1회 완주 → plays_remaining = 2
--    · 리듬 완주 후 minigame_plays 에 새 row (target_stat = 선택값, mobil_gained=0)
--
-- 5) 카페 · 연습실 RPC 는 이 배포로 전혀 영향 받지 않음.
--    실플레이 정상 확인.
-- ═══════════════════════════════════════════════════════════════════
