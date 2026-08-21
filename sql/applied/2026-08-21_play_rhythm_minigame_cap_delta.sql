-- sql/pending/2026-08-21_play_rhythm_minigame_cap_delta.sql
-- ═══════════════════════════════════════════════════════════════════
-- play_rhythm_minigame : cap(450) 도달 시 "실제 반영량" 반환으로 수정
-- ═══════════════════════════════════════════════════════════════════
--
-- 문제 :
--   기존 함수는 selected_stat_gained / physical_gained 로 점수 구간표의
--   명목값(예: +30)을 그대로 반환·기록했다. 실제 프로필 반영은
--   LEAST(현재 + 명목값, 450) 이므로, cap 근처에서는
--   팝업 표기(+30)와 실제 상승량(+10, +0 등)이 어긋난다.
--   minigame_plays.stat_gained 이력도 명목값으로 남아 통계가 부정확.
--
-- 수정 :
--   · cap clamp 후 실제 delta 를 계산해
--     - 반환 컬럼 selected_stat_gained / physical_gained
--     - minigame_plays.stat_gained
--     - result_detail 의 selected_stat_gained / physical_gained
--     에 사용한다.
--   · selected_stat_base / physical_base (반환 + breakdown) 는
--     기존대로 구간표 명목값 유지. → "구간표상 몇이었고, 실제 몇 올랐나"
--     를 클라가 구분 가능 (base > gained 이면 cap 도달).
--   · 그 외 로직(검증 · 구간표 · UPDATE · 카운트)은 일절 무변경.
--
-- 시그니처 · 반환 컬럼 구조 무변경 → 프론트 호환 (재배포 불필요).
--   lib/minigame-helpers.ts 의 playRhythmMinigame 파싱 그대로 동작.
--
-- 참고 :
--   같은 명목값 반환 문제가 play_practice_minigame / 카페 RPC 에도 있다.
--   이 파일은 리듬만 다룬다 (안정성 원칙 : 한 번에 하나).
--
-- 롤백 :
--   sql/applied/2026-08-07_play_rhythm_minigame.sql 재적용.
--
-- 적용 후 확인 (파일 하단 주석 참조).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.play_rhythm_minigame(
  p_minigame_code text,
  p_score integer,
  p_selected_stat text,
  p_result_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  next_mobil integer,
  next_selected_stat_exp integer,
  next_physical_exp integer,
  mobil_gained integer,
  selected_stat text,
  selected_stat_gained integer,
  physical_gained integer,
  plays_today integer,
  plays_remaining integer,
  difficulty integer,
  selected_stat_base integer,
  selected_stat_range_min integer,
  selected_stat_range_max integer,
  physical_base integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_selected_gain      integer;  -- 구간표 명목값 (base 표기용)
  v_physical_gain      integer;  -- 구간표 명목값 (base 표기용)
  v_next_physical      integer;
  v_selected_actual    integer;  -- cap 반영 후 실제 증가량 ← 이번 수정
  v_physical_actual    integer;  -- cap 반영 후 실제 증가량 ← 이번 수정
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

  -- ── 실제 증가량 (cap 반영 후) ← 이번 수정 ─────────
  --   명목값(v_*_gain)과 별개로, 프로필에 실제 더해진 양.
  --   cap 미도달이면 명목값과 동일. 도달이면 그만큼 줄거나 0.
  v_selected_actual := v_next_selected - v_selected_exp_now;
  v_physical_actual := v_next_physical - v_physical_exp;

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
  --   gained 계열은 실제 증가량, base 계열은 구간표 명목값.
  v_result_detail := COALESCE(p_result_detail, '{}'::jsonb)
                     || jsonb_build_object(
                       'selected_stat',        p_selected_stat,
                       'selected_stat_gained', v_selected_actual,
                       'physical_gained',      v_physical_actual,
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
  --   stat_gained 컬럼에는 실제 반영된 선택 스탯 exp (cap 반영 후).
  --   체력 exp 는 result_detail 안에.
  --   mobil_gained 는 0.
  INSERT INTO public.minigame_plays
    (minigame_id, profile_id, score, stat_gained, mobil_gained,
     target_stat, play_date, result_detail)
  VALUES
    (v_minigame.id, v_profile_id, p_score, v_selected_actual, 0,
     p_selected_stat, v_today, v_result_detail);

  -- ── 반환 ────────────────────────────────────────
  --   *_gained = 실제 증가량 (cap 반영 후) ← 이번 수정
  --   *_base   = 구간표 명목값 (breakdown 용, 기존 유지)
  --   → base > gained 이면 클라가 "상한 도달"을 표시할 수 있다.
  next_mobil              := v_mobil;                -- 변경 없음
  next_selected_stat_exp  := v_next_selected;
  next_physical_exp       := v_next_physical;
  mobil_gained            := 0;
  selected_stat           := p_selected_stat;
  selected_stat_gained    := v_selected_actual;
  physical_gained         := v_physical_actual;
  plays_today             := v_plays_today + 1;
  plays_remaining         := v_daily_limit - (v_plays_today + 1);
  difficulty              := v_difficulty;
  selected_stat_base      := v_selected_gain;
  selected_stat_range_min := v_sel_min;
  selected_stat_range_max := v_sel_max;
  physical_base           := v_physical_gain;
  RETURN NEXT;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ─────────────────────────────────────────────────────────────────────
-- 1) cap 미도달 계정으로 1판 : gained == base 여야 한다.
-- 2) cap 근접 계정(예: GM 스탯조정으로 rhythm_exp=445 세팅) 으로 1판 :
--    selected_stat_gained 가 5 로 나오고 next_selected_stat_exp = 450.
--    minigame_plays.stat_gained 도 5 로 기록.
--   SELECT played_at, score, target_stat, stat_gained,
--          result_detail->>'selected_stat_gained'          AS gained,
--          result_detail->'breakdown'->>'selected_stat_base' AS base
--     FROM public.minigame_plays mp
--     JOIN public.minigames mg ON mg.id = mp.minigame_id
--    WHERE mg.category = 'rhythm_game'
--    ORDER BY played_at DESC LIMIT 5;
-- 3) 테스트 후 GM 스탯조정으로 원복.
-- ═══════════════════════════════════════════════════════════════════
