-- sql/pending/2026-08-04_play_practice_minigame.sql
-- ═══════════════════════════════════════════════════════════════════
-- play_practice_minigame : 연습실알바 전용 RPC 신설
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 (세션 L) :
--   카페 3종 완성 후 연습실 3종 착수. 아키텍처 옵션 A/B/C 중 B 선택.
--     A) play_cafe_minigame → play_minigame rename + category 확장
--     B) play_practice_minigame 별도 신설  ← 채택
--     C) 공유 helper + 카테고리별 wrapper
--
-- B 채택 근거 :
--   · 안정성 최우선 원칙. 카페 RPC 는 이미 배포·검증 완료 (세션 J·K 실플레이).
--     rename · 시그니처 변경 · 내부 분기 확장은 그 위에 새 리스크 추가.
--   · 카페와 연습실은 채점 대상 스탯 (expression vs rhythm) 이 다르고, 향후
--     카테고리별 특수 로직 추가 여지 있음 (예: 리듬감 스탯 뱃지 조건).
--   · 코드 중복은 감수. 함수 하나가 격리되어 있어 사고 발생 시 카페 미니게임
--     운영에 영향 없음.
--
-- 카페 RPC 와의 차이점 :
--   1) 함수명       : play_cafe_minigame → play_practice_minigame
--   2) category 검증 : 'cafe' → 'practice_room'
--   3) 주 스탯      : expression_exp → rhythm_exp
--   4) 축소 스케일 대상 코드 : cafe_dish → practice_clean
--   5) 반환 필드명  : next_expression_exp / expression_gained / expression_base /
--                    expression_bonus → next_rhythm_exp / rhythm_gained /
--                    rhythm_base / rhythm_bonus
--   6) result_detail.breakdown 안 필드명도 같은 규칙으로 rename
--   7) minigame_plays.target_stat 컬럼에는 'rhythm' 이 기록됨 (v_minigame.target_stat 그대로)
--
-- 카페 RPC 와 공유하는 로직 (물리적으로 중복 코드) :
--   · 인증 확인 (auth.uid())
--   · 미니게임 전역 활성 확인 (site_settings.minigame_enabled)
--   · score 범위 검증 (0..100)
--   · 미니게임 마스터 조회
--   · 프로필 FOR UPDATE 락
--   · 하루 KST 3회 검증
--   · metadata 파싱 (difficulty · mobil_bonus · stat_bonus · 음수 방어)
--   · mobil 구간표 (별 1 축소 · 나머지 기본)
--   · perfect 보너스 (+300, score=100 시)
--   · exp cap (450) LEAST clamp
--   · profiles UPDATE
--   · result_detail 병합 + breakdown 기록
--   · minigame_plays INSERT
--
-- 반환 시그니처 (16 필드, 카페와 동일한 구조지만 필드명 rename) :
--   next_mobil               integer
--   next_rhythm_exp          integer   ← (카페 : next_expression_exp)
--   next_physical_exp        integer
--   mobil_gained             integer
--   rhythm_gained            integer   ← (카페 : expression_gained)
--   physical_gained          integer
--   plays_today              integer
--   plays_remaining          integer
--   difficulty               integer
--   mobil_base               integer
--   mobil_difficulty_bonus   integer
--   mobil_perfect_bonus      integer
--   rhythm_base              integer   ← (카페 : expression_base)
--   rhythm_bonus             integer   ← (카페 : expression_bonus)
--   physical_base            integer
--   physical_bonus           integer
--
-- 안전장치 :
--   · SECURITY DEFINER · search_path = 'public' (기존 방침 유지)
--   · profiles FOR UPDATE 로 유저 단위 직렬화
--   · 하루 3회 검증 (카페 + 연습실 + 리듬게임 통합 카운트)
--     v_plays_today 는 profile_id + play_date 로만 count. category 무관.
--     즉 오늘 카페 3회 했으면 연습실 진입 불가. 요구 사양 그대로.
--   · minigame 카테고리 = 'practice_room' 검증 (다른 카테고리 코드 오호출 방지)
--   · metadata 필드 없거나 잘못된 값이면 각 bonus 는 0 취급 (안전 fallback)
--
-- 실행 함정 :
--   대시보드 SQL Editor 는 postgres 슈퍼유저 세션. auth.uid() = null 이라
--   SELECT play_practice_minigame(...) 직접 호출은 'auth_required' 예외 정상.
--   실제 검증은 브라우저 로그인 세션에서 실플레이 진행.
--
-- 롤백 :
--   DROP FUNCTION IF EXISTS public.play_practice_minigame(text, integer, jsonb);
--   (연습실 seed 도 롤백해야 완전 원복 : DELETE FROM minigames WHERE ...)
--
-- 선행 마이그레이션 :
--   sql/pending/2026-08-04_minigame_practice_seed.sql (반드시 seed 먼저 apply)
-- 후행 마이그레이션 :
--   없음 (세션 L 안에서는 이 두 SQL 이 전부. 후속 밸런스 조정 시 별도 파일)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 신규 함수. 재배포 안전성 위해 IF EXISTS 로 방어.
DROP FUNCTION IF EXISTS public.play_practice_minigame(text, integer, jsonb);

CREATE FUNCTION public.play_practice_minigame(
  p_minigame_code text,
  p_score         integer,
  p_result_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  next_mobil               integer,
  next_rhythm_exp          integer,
  next_physical_exp        integer,
  mobil_gained             integer,
  rhythm_gained            integer,
  physical_gained          integer,
  plays_today              integer,
  plays_remaining          integer,
  difficulty               integer,
  mobil_base               integer,
  mobil_difficulty_bonus   integer,
  mobil_perfect_bonus      integer,
  rhythm_base              integer,
  rhythm_bonus             integer,
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
  v_rhythm_exp         integer;
  v_physical_exp       integer;
  v_minigame           RECORD;
  v_minigame_enabled   boolean;
  v_today              date;
  v_plays_today        integer;
  v_daily_limit        constant integer := 3;
  v_rhythm_base        constant integer := 5;
  v_physical_base      constant integer := 8;
  v_perfect_bonus      constant integer := 300;
  v_exp_cap            constant integer := 450;
  v_difficulty         integer;
  v_mobil_bonus        integer;
  v_rhythm_bonus       integer;
  v_physical_bonus     integer;
  v_mobil_base_amt     integer;
  v_mobil_perfect_amt  integer;
  v_rhythm_total       integer;
  v_physical_total     integer;
  v_mobil_gained       integer;
  v_next_mobil         integer;
  v_next_rhythm        integer;
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
  IF v_minigame.category <> 'practice_room' THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;

  -- ── 프로필 잠금 ──────────────────────────────────
  SELECT id, mobil, rhythm_exp, physical_exp
    INTO v_profile_id, v_mobil, v_rhythm_exp, v_physical_exp
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

  -- ── metadata 에서 난이도·가산 읽기 (안전 fallback) ─
  v_difficulty     := COALESCE((v_minigame.metadata->>'difficulty')::integer, 1);
  v_mobil_bonus    := COALESCE((v_minigame.metadata->>'mobil_bonus')::integer, 0);
  v_rhythm_bonus   := COALESCE(
    (v_minigame.metadata->'stat_bonus'->>'rhythm')::integer, 0
  );
  v_physical_bonus := COALESCE(
    (v_minigame.metadata->'stat_bonus'->>'physical')::integer, 0
  );
  -- 음수 방어
  IF v_mobil_bonus    < 0 THEN v_mobil_bonus    := 0; END IF;
  IF v_rhythm_bonus   < 0 THEN v_rhythm_bonus   := 0; END IF;
  IF v_physical_bonus < 0 THEN v_physical_bonus := 0; END IF;

  -- ── mobil 기본 산정 (점수 구간표, 게임별 분기) ────
  --   청소 (practice_clean) : 별 1 축소 스케일 (카페 설거지와 동일)
  --   재고정리·장비세팅        : 기본 스케일 (카페 mix·order 와 동일)
  IF p_minigame_code = 'practice_clean' THEN
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
  v_rhythm_total   := v_rhythm_base   + v_rhythm_bonus;
  v_physical_total := v_physical_base + v_physical_bonus;

  v_next_rhythm   := LEAST(v_rhythm_exp   + v_rhythm_total,   v_exp_cap);
  v_next_physical := LEAST(v_physical_exp + v_physical_total, v_exp_cap);
  v_next_mobil    := v_mobil + v_mobil_gained;

  -- ── 프로필 반영 ─────────────────────────────────
  UPDATE public.profiles
     SET mobil        = v_next_mobil,
         rhythm_exp   = v_next_rhythm,
         physical_exp = v_next_physical
   WHERE id = v_profile_id;

  -- ── result_detail 병합 (클라 상세 + 서버 breakdown) ─
  v_result_detail := COALESCE(p_result_detail, '{}'::jsonb)
                     || jsonb_build_object(
                       'physical_gained', v_physical_total,
                       'rhythm_gained',   v_rhythm_total,
                       'mobil_gained',    v_mobil_gained,
                       'perfect',         (p_score = 100),
                       'breakdown',       jsonb_build_object(
                         'difficulty',             v_difficulty,
                         'mobil_base',             v_mobil_base_amt,
                         'mobil_difficulty_bonus', v_mobil_bonus,
                         'mobil_perfect_bonus',    v_mobil_perfect_amt,
                         'rhythm_base',            v_rhythm_base,
                         'rhythm_bonus',           v_rhythm_bonus,
                         'physical_base',          v_physical_base,
                         'physical_bonus',         v_physical_bonus
                       )
                     );

  -- ── 플레이 이력 저장 ────────────────────────────
  --   target_stat 컬럼에는 v_minigame.target_stat ('rhythm') 이 그대로 들어감.
  --   stat_gained 컬럼에는 rhythm 총 지급량. 체력은 result_detail 안.
  INSERT INTO public.minigame_plays
    (minigame_id, profile_id, score, stat_gained, mobil_gained,
     target_stat, play_date, result_detail)
  VALUES
    (v_minigame.id, v_profile_id, p_score, v_rhythm_total, v_mobil_gained,
     v_minigame.target_stat, v_today, v_result_detail);

  -- ── 반환 ────────────────────────────────────────
  next_mobil             := v_next_mobil;
  next_rhythm_exp        := v_next_rhythm;
  next_physical_exp      := v_next_physical;
  mobil_gained           := v_mobil_gained;
  rhythm_gained          := v_rhythm_total;
  physical_gained        := v_physical_total;
  plays_today            := v_plays_today + 1;
  plays_remaining        := v_daily_limit - (v_plays_today + 1);
  difficulty             := v_difficulty;
  mobil_base             := v_mobil_base_amt;
  mobil_difficulty_bonus := v_mobil_bonus;
  mobil_perfect_bonus    := v_mobil_perfect_amt;
  rhythm_base            := v_rhythm_base;
  rhythm_bonus           := v_rhythm_bonus;
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
--    WHERE proname = 'play_practice_minigame';
--
-- 2) 대시보드 직접 호출은 auth.uid()=null 이라 'auth_required' 예외 정상.
--    브라우저 로그인 세션에서 실플레이 후 결과 확인.
--
-- 3) 대조 검증 (연습실 seed 배포 후) :
--    · practice_clean 만점(100) → mobil +2,500 (base 2200 + perfect 300)
--    · practice_stock 만점(100) → mobil +3,700 (base 3000 + perfect 300 + 난이도 400)
--    · practice_setup 만점(100) → mobil +4,200 (base 3000 + perfect 300 + 난이도 900)
--
-- 4) 카페 RPC 는 이 배포로 전혀 영향 받지 않음. 카페 3종 실플레이 정상 확인.
-- ═══════════════════════════════════════════════════════════════════
