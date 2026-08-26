-- sql/pending/2026-08-26_action_refill_markers_event_items.sql
-- ═══════════════════════════════════════════════════════════════════
-- 2026-08-26  아이템 3종 추가
--   (1) 일일 행동횟수 +1 충전 아이템 (하루 1회 사용, 그날만 +1)
--   (2) 사인펜 색상 추가 : 파랑 · 하양 · 무지개
--   (3) 이벤트(유틸성) 아이템 : 히나인형 (사용 시 랜덤 괴담 대사)
-- ═══════════════════════════════════════════════════════════════════
--
-- 설계 원칙 (프로젝트 방침 준수) :
--   · 기존 RPC 를 덮어써 회귀가 나던 사고를 피하기 위해, 미니게임 play/status
--     RPC 5종은 "본문 전체를 2026-08-21 스키마 덤프에서 그대로 복제"하고
--     딱 두 줄만 바꾼다 :
--       ① 선언  v_daily_limit constant integer := 3;  → v_daily_limit integer;
--       ② 대입  v_today 계산 직후  v_daily_limit := public.minigame_daily_limit(...);
--     그 외 보상 계산·예외·이력 기록은 한 글자도 손대지 않는다.
--   · purchase_shop_item 은 아예 건드리지 않는다. 충전/히나인형은 기존 'other'
--     분기(quantity 누적)로 그대로 구매된다. "효과"는 별도 use_* RPC 가 담당.
--   · 전부 CREATE OR REPLACE / IF NOT EXISTS → 재실행(멱등) 가능.
--   · 전체 트랜잭션. 문제가 있으면 이 파일 실행 전 정의(덤프)로 복구.
--
-- 신규 오브젝트 :
--   · TABLE  public.minigame_daily_bonus  (profile_id, bonus_date, bonus_plays)
--   · FUNC   public.minigame_daily_limit(uuid, date)  → 3 + 오늘 보너스
--   · FUNC   public.use_action_refill()   → 충전 아이템 1개 차감 + 오늘 +1 (하루 1회)
--   · FUNC   public.use_event_item(text)   → 이벤트 아이템 "사용" (히나인형 등)
--   · shop_items seed : 파랑/하양/무지개 사인펜, 행동충전, 히나인형
--
-- 롤백(수동) : 파일 하단 §R 참조.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) 일일 행동 보너스 테이블
--    · (profile_id, bonus_date) 당 한 행. bonus_plays = 그날 추가된 횟수.
--    · 하루 1회 사용 제한은 use_action_refill 에서 "행 존재 여부"로 판정.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.minigame_daily_bonus (
  profile_id   uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bonus_date   date    NOT NULL,
  bonus_plays  integer NOT NULL DEFAULT 0 CHECK (bonus_plays >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, bonus_date)
);

-- RLS : 본인 행만 조회 가능(디버그·표시용). 쓰기는 SECURITY DEFINER RPC 로만.
ALTER TABLE public.minigame_daily_bonus ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='minigame_daily_bonus'
       AND policyname='mdb_select_own'
  ) THEN
    CREATE POLICY mdb_select_own ON public.minigame_daily_bonus
      FOR SELECT USING (
        profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 2) 한도 헬퍼 : 기본 3 + 오늘 보너스
--    · 미니게임 RPC 들이 이 함수만 호출하면 되도록 단일 소스화.
--    · STABLE : 같은 트랜잭션 내 동일 인자 재호출 시 캐시 가능(부수효과 없음).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.minigame_daily_limit(
  p_profile_id uuid,
  p_date       date
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT 3 + COALESCE(
    (SELECT bonus_plays
       FROM public.minigame_daily_bonus
      WHERE profile_id = p_profile_id
        AND bonus_date = p_date),
    0
  );
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 3) 충전 아이템 사용 : use_action_refill
--    · 대상 : inventory_items 의 item_type='other', item_ref='action_refill'.
--    · 하루 1회 : 오늘 bonus 행이 이미 있으면 already_used_today 예외.
--    · 원자 처리 : 프로필 잠금 → 보유 확인 → 아이템 1개 차감 → 보너스 +1.
--    · 반환 : jsonb { ok, bonus_plays(오늘 누적 보너스), daily_limit, remaining_item }
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.use_action_refill()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_today      date;
  v_row        RECORD;
  v_remaining  integer;
  v_bonus      integer;
  v_ref        constant text := 'action_refill';
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- 프로필 잠금 (동시 사용 이중 차감·이중 보너스 방지)
  SELECT id INTO v_profile_id
    FROM public.profiles
   WHERE user_id = v_user_id
   FOR UPDATE;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  -- 하루 1회 : 오늘 이미 충전했으면 거부 (아이템 차감 전에 검사)
  IF EXISTS (
    SELECT 1 FROM public.minigame_daily_bonus
     WHERE profile_id = v_profile_id AND bonus_date = v_today
  ) THEN
    RAISE EXCEPTION 'already_used_today';
  END IF;

  -- 보유한 충전 아이템 스택 1개 잠금
  SELECT id, quantity INTO v_row
    FROM public.inventory_items
   WHERE profile_id = v_profile_id
     AND item_type  = 'other'
     AND item_ref   = v_ref
     AND quantity   > 0
   ORDER BY acquired_at ASC
   LIMIT 1
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no_item';
  END IF;

  -- 아이템 1개 차감 (0 되면 행 삭제)
  IF v_row.quantity <= 1 THEN
    DELETE FROM public.inventory_items WHERE id = v_row.id;
    v_remaining := 0;
  ELSE
    UPDATE public.inventory_items
       SET quantity = quantity - 1
     WHERE id = v_row.id;
    v_remaining := v_row.quantity - 1;
  END IF;

  -- 오늘 보너스 +1 (하루 1회 제한이라 항상 신규 행)
  INSERT INTO public.minigame_daily_bonus (profile_id, bonus_date, bonus_plays)
  VALUES (v_profile_id, v_today, 1);
  v_bonus := 1;

  RETURN jsonb_build_object(
    'ok',             true,
    'bonus_plays',    v_bonus,
    'daily_limit',    public.minigame_daily_limit(v_profile_id, v_today),
    'remaining_item', v_remaining
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 4) 이벤트 아이템 사용 : use_event_item
--    · 대상 : inventory_items item_type='other' 중 metadata.effect 가 있는 것.
--    · 히나인형(effect='random_line') : 소지한 그 아이템의 metadata.lines 배열
--      또는 그 아이템의 shop_items.metadata.lines 에서 랜덤 1개 문자열 반환.
--      아이템은 차감하지 않는다(반복 사용 가능).
--    · 대사 목록이 없으면 fallback 문구.
--    · 반환 : jsonb { ok, effect, message }
--    · GM 은 나중에 shop_items.metadata.lines 를 바꿔 대사를 갱신할 수 있다.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.use_event_item(p_item_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_inv        RECORD;
  v_effect     text;
  v_lines      jsonb;
  v_shop_meta  jsonb;
  v_count      integer;
  v_pick       text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_item_ref IS NULL OR length(btrim(p_item_ref)) = 0 THEN
    RAISE EXCEPTION 'invalid_item_ref';
  END IF;

  SELECT id INTO v_profile_id
    FROM public.profiles
   WHERE user_id = v_user_id;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- 소지 확인 (한 개라도 보유해야 사용 가능)
  SELECT id, metadata INTO v_inv
    FROM public.inventory_items
   WHERE profile_id = v_profile_id
     AND item_type  = 'other'
     AND item_ref   = p_item_ref
     AND quantity   > 0
   ORDER BY acquired_at ASC
   LIMIT 1;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'no_item';
  END IF;

  -- effect 결정 : 인벤토리 metadata 우선, 없으면 shop_items metadata
  SELECT metadata INTO v_shop_meta
    FROM public.shop_items
   WHERE item_ref = p_item_ref
   ORDER BY created_at ASC
   LIMIT 1;

  v_effect := COALESCE(
    NULLIF(v_inv.metadata->>'effect', ''),
    NULLIF(v_shop_meta->>'effect', '')
  );

  IF v_effect IS NULL THEN
    RAISE EXCEPTION 'no_effect';
  END IF;

  -- ── effect : random_line (히나인형 등) ──
  IF v_effect = 'random_line' THEN
    -- lines 배열 : 인벤토리 스냅샷 우선, 없으면 shop 최신값
    v_lines := COALESCE(
      CASE WHEN jsonb_typeof(v_inv.metadata->'lines') = 'array'
           THEN v_inv.metadata->'lines' END,
      CASE WHEN jsonb_typeof(v_shop_meta->'lines') = 'array'
           THEN v_shop_meta->'lines' END
    );

    v_count := COALESCE(jsonb_array_length(v_lines), 0);
    IF v_count = 0 THEN
      v_pick := '...';
    ELSE
      v_pick := v_lines->>(floor(random() * v_count)::int);
      IF v_pick IS NULL OR length(btrim(v_pick)) = 0 THEN
        v_pick := '...';
      END IF;
    END IF;

    RETURN jsonb_build_object('ok', true, 'effect', v_effect, 'message', v_pick);
  END IF;

  -- 알 수 없는 effect
  RAISE EXCEPTION 'unsupported_effect';
END;
$function$;


-- ────────────────────────────────────────────────────────────────────
-- 5) 미니게임 한도 RPC 5종 재정의 (본문 그대로 복제 + 2줄만 변경)
--    · 2026-08-21 스키마 덤프 원본을 그대로 복제하고,
--      한도 상수 → 헬퍼 호출 두 줄만 교체했다.
-- ────────────────────────────────────────────────────────────────────
-- ─────────── get_today_minigame_status ───────────
CREATE OR REPLACE FUNCTION public.get_today_minigame_status()
 RETURNS TABLE(plays_today integer, plays_remaining integer, daily_limit integer, minigame_enabled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id       uuid;
  v_profile_id    uuid;
  v_daily_limit   integer;  -- 기본 3 + 오늘 충전 보너스
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

  SELECT s.minigame_enabled INTO v_enabled
    FROM public.site_settings AS s
   WHERE s.id = 1;
  v_enabled := COALESCE(v_enabled, false);

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_daily_limit := public.minigame_daily_limit(v_profile_id, v_today);

  SELECT count(*) INTO v_plays_today
    FROM public.minigame_plays AS mp
   WHERE mp.profile_id = v_profile_id
     AND mp.play_date  = v_today;

  plays_today      := v_plays_today;
  plays_remaining  := GREATEST(v_daily_limit - v_plays_today, 0);
  daily_limit      := v_daily_limit;
  minigame_enabled := v_enabled;
  RETURN NEXT;
END;
$function$;

-- ─────────── play_cafe_minigame ───────────
CREATE OR REPLACE FUNCTION public.play_cafe_minigame(p_minigame_code text, p_score integer, p_result_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(next_mobil integer, next_expression_exp integer, next_physical_exp integer, mobil_gained integer, expression_gained integer, physical_gained integer, plays_today integer, plays_remaining integer, difficulty integer, mobil_base integer, mobil_difficulty_bonus integer, mobil_perfect_bonus integer, expression_base integer, expression_bonus integer, physical_base integer, physical_bonus integer)
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
  v_daily_limit        integer;  -- 기본 3 + 오늘 충전 보너스 (헬퍼 계산)
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
  v_daily_limit := public.minigame_daily_limit(v_profile_id, v_today);

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
$function$;

-- ─────────── play_practice_minigame ───────────
CREATE OR REPLACE FUNCTION public.play_practice_minigame(p_minigame_code text, p_score integer, p_result_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(next_mobil integer, next_rhythm_exp integer, next_physical_exp integer, mobil_gained integer, rhythm_gained integer, physical_gained integer, plays_today integer, plays_remaining integer, difficulty integer, mobil_base integer, mobil_difficulty_bonus integer, mobil_perfect_bonus integer, rhythm_base integer, rhythm_bonus integer, physical_base integer, physical_bonus integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_daily_limit        integer;  -- 기본 3 + 오늘 충전 보너스 (헬퍼 계산)
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
  v_daily_limit := public.minigame_daily_limit(v_profile_id, v_today);

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
$function$;

-- ─────────── play_rhythm_minigame ───────────
CREATE OR REPLACE FUNCTION public.play_rhythm_minigame(p_minigame_code text, p_score integer, p_selected_stat text, p_result_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(next_mobil integer, next_selected_stat_exp integer, next_physical_exp integer, mobil_gained integer, selected_stat text, selected_stat_gained integer, physical_gained integer, plays_today integer, plays_remaining integer, difficulty integer, selected_stat_base integer, selected_stat_range_min integer, selected_stat_range_max integer, physical_base integer)
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
  v_daily_limit        integer;  -- 기본 3 + 오늘 충전 보너스 (헬퍼 계산)
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
  v_daily_limit := public.minigame_daily_limit(v_profile_id, v_today);

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
$function$;

-- ─────────── gm_get_user_minigame_today ───────────
CREATE OR REPLACE FUNCTION public.gm_get_user_minigame_today(p_profile_id uuid)
 RETURNS TABLE(plays_today integer, daily_limit integer, plays_remaining integer, play_date date, history jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_daily_limit integer;  -- 기본 3 + 대상 유저의 오늘 충전 보너스
  v_today       date;
  v_count       integer;
  v_history     jsonb;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_profile_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_daily_limit := public.minigame_daily_limit(p_profile_id, v_today);

  SELECT count(*) INTO v_count
    FROM public.minigame_plays AS mp
   WHERE mp.profile_id = p_profile_id
     AND mp.play_date  = v_today;

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
               'played_at',     mp.played_at,
               'result_detail', mp.result_detail
             )
             ORDER BY mp.played_at DESC
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
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 6) shop_items seed
--    · 이미 있으면(code 기준) 재삽입 안 함. price·이미지는 초안값(GM 조정 가능).
--    · 사인펜(marker) : item_ref = 색상 코드. 무지개는 'rainbow'.
--      metadata.initial_durability = 초기 잉크. emoji·name 은 표시용.
--    · 무지개는 프론트가 그라데이션으로 렌더(색 hex 무의미하지만 폴백값 넣음).
--    · action_refill / hina_doll : item_type='other'. metadata.effect 로 동작 결정.
-- ────────────────────────────────────────────────────────────────────

-- 파랑 사인펜
INSERT INTO public.shop_items (code, name, description, item_type, item_ref, price, metadata)
SELECT 'marker_blue', '파랑 사인펜',
       '연습일지 보드에 파란색으로 그림을 그릴 수 있는 사인펜입니다.',
       'marker', 'blue', 150,
       jsonb_build_object('initial_durability', 100, 'emoji', '🖊️', 'name', '파랑 사인펜', 'color_hex', '#1e63e9')
WHERE NOT EXISTS (SELECT 1 FROM public.shop_items WHERE code = 'marker_blue');

-- 하양 사인펜
INSERT INTO public.shop_items (code, name, description, item_type, item_ref, price, metadata)
SELECT 'marker_white', '하양 사인펜',
       '연습일지 보드에 하얀색으로 그림을 그릴 수 있는 사인펜입니다.',
       'marker', 'white', 150,
       jsonb_build_object('initial_durability', 100, 'emoji', '🖊️', 'name', '하양 사인펜', 'color_hex', '#ffffff')
WHERE NOT EXISTS (SELECT 1 FROM public.shop_items WHERE code = 'marker_white');

-- 무지개 사인펜
INSERT INTO public.shop_items (code, name, description, item_type, item_ref, price, metadata)
SELECT 'marker_rainbow', '무지개 사인펜',
       '한 번 그으면 빨주노초파남보 무지개색이 흐르는 특별한 사인펜입니다.',
       'marker', 'rainbow', 400,
       jsonb_build_object('initial_durability', 60, 'emoji', '🌈', 'name', '무지개 사인펜', 'color_hex', '#e5484d')
WHERE NOT EXISTS (SELECT 1 FROM public.shop_items WHERE code = 'marker_rainbow');

-- 행동횟수 +1 충전 아이템
INSERT INTO public.shop_items (code, name, description, item_type, item_ref, price, metadata)
SELECT 'action_refill', '행동 충전',
       '사용하면 오늘 하루 미니게임(일일 행동) 횟수가 1회 늘어납니다. 하루 1회만 사용할 수 있습니다.',
       'other', 'action_refill', 500,
       jsonb_build_object('emoji', '⚡', 'name', '행동 충전', 'effect', 'action_refill')
WHERE NOT EXISTS (SELECT 1 FROM public.shop_items WHERE code = 'action_refill');

-- 히나인형 (이벤트 아이템 : 사용 시 랜덤 괴담 대사)
INSERT INTO public.shop_items (code, name, description, item_type, item_ref, price, metadata)
SELECT 'hina_doll', '히나인형',
       '어딘가 서늘한 기운이 감도는 인형입니다. 사용하면 인형이 무언가 속삭입니다…',
       'other', 'hina_doll', 300,
       jsonb_build_object(
         'emoji', '🎎',
         'name', '히나인형',
         'effect', 'random_line',
         'lines', jsonb_build_array(
           '여기서 나가.',
           '뒤를 돌아보지 마.',
           '한 명… 두 명… 어라, 왜 한 명이 더 있지?',
           '아까부터 계속 쳐다보고 있었어.',
           '문은 잠갔니?',
           '방금 네 이름을 부른 건 내가 아니야.',
           '오늘 밤엔 자지 않는 게 좋을 거야.',
           '그 소리… 너한테도 들리는구나.',
           '거울은 보지 않는 게 좋아.',
           '이제 곧 셋을 셀 거야. 하나….'
         )
       )
WHERE NOT EXISTS (SELECT 1 FROM public.shop_items WHERE code = 'hina_doll');

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- §R 롤백 (수동) — 문제 발생 시
-- ═══════════════════════════════════════════════════════════════════
-- 1) 미니게임 RPC 5종을 2026-08-21 덤프의 원본 정의로 다시 CREATE OR REPLACE.
--    (이 파일이 바꾼 것은 각 함수의 한도 두 줄뿐이므로, 덤프 원본을 붙이면 원복.)
-- 2) 신규 오브젝트 제거 :
--    DROP FUNCTION IF EXISTS public.use_event_item(text);
--    DROP FUNCTION IF EXISTS public.use_action_refill();
--    DROP FUNCTION IF EXISTS public.minigame_daily_limit(uuid, date);
--    DROP TABLE    IF EXISTS public.minigame_daily_bonus;
-- 3) seed 제거(선택) :
--    DELETE FROM public.shop_items
--     WHERE code IN ('marker_blue','marker_white','marker_rainbow','action_refill','hina_doll');
--    (이미 구매·인벤토리에 반영된 건 남으므로, 회수 필요 시 별도 처리.)
-- ═══════════════════════════════════════════════════════════════════
