-- sql/pending/2026-08-14_slot_machine.sql
-- ═══════════════════════════════════════════════════════════════════
-- 슬롯머신 기능 : 설정 테이블 · 인벤토리 타입 확장 · spin_slot RPC
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   유저가 모빌(재화)을 소모해 슬롯을 돌리는 신설 기능.
--   재화가 걸린 트랜잭션이므로 추첨·차감·지급을 전부 서버(RPC)에서
--   원자적으로 처리한다. 클라이언트는 결과를 받아 릴을 "연출"만 한다.
--
-- 규칙 (확정) :
--   · 1회 비용 : slot_config.spin_cost (기본 400 모빌)
--   · 잭팟(확률 slot_config.jackpot_rate) → 인형 1개만 (모빌·쿠폰·잡템 없음)
--   · 논잭팟 → 쿠폰 1 + 잡템 1 보장 (꽝 없음)
--   · 지급 아이템은 shop_items 중 metadata.slot_reward = true 인 것에서 추첨
--     - 인형 : metadata.slot_kind = 'doll'
--     - 잡템 : metadata.slot_kind = 'junk'
--     - 쿠폰 : metadata.slot_kind = 'coupon'
--     - 가중치 : metadata.weight (정수, 없으면 1)
--   · 인벤토리 스택 : 최대 99. 초과 시 새 행(꾸러미)에 1부터 누적.
--
-- 이 마이그레이션이 하는 일 :
--   1) inventory_items.item_type CHECK 제약에 'doll' · 'coupon' · 'junk' 추가
--   2) slot_config 테이블 신설 (단일 행) + RLS (읽기 전체, 쓰기 GM)
--   3) spin_slot() RPC 신설 (SECURITY DEFINER, 원자 처리)
--   4) _slot_give_item() 내부 함수 (스택 99 처리)
--   5) _slot_pick_weighted() 내부 함수 (가중치 추첨)
--
-- 안전장치 :
--   · 잔액·인벤토리 행을 FOR UPDATE 로 잠가 동시성 사고 방지
--     (같은 유저가 연타/재시도해도 두 번 긁히지 않음. 진행 중 스핀은
--      프로필 락으로 직렬화됨)
--   · 잔액 부족 시 insufficient_mobil 예외 → 차감·지급 전부 롤백
--   · 지급할 아이템 풀이 비어 있으면 slot_pool_empty 예외로 명시적 실패
--     (모빌만 빠지고 아무것도 안 주는 사고 방지)
--   · CHECK 제약 교체는 기존 데이터에 위배 행이 없어야 통과. 기존 값
--     (marker·sticker·wallpaper·other)은 그대로 유지하므로 안전.
--   · 전체 BEGIN / COMMIT.
--
-- 복구 (롤백) :
--   · spin_slot · _slot_give_item · _slot_pick_weighted → DROP FUNCTION
--   · slot_config → DROP TABLE
--   · CHECK 제약 → 이 파일 하단 [롤백 스니펫] 참고 (원래 4종으로 되돌림)
--
-- 선행 : 2026-07-27_shop_other_type_purchase.sql (inventory_items 컬럼 구성)
-- 후행 : lib/slot-helpers.ts (RPC 래퍼) · SlotCabinetPop 연동 (별도 작업)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) inventory_items.item_type 확장
--    기존 CHECK 제약명을 모르므로, item_type 관련 CHECK 를 동적으로 찾아
--    교체한다. (제약이 없으면 그냥 새로 추가)
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_conname text;
BEGIN
  -- item_type 을 참조하는 CHECK 제약 탐색
  SELECT con.conname INTO v_conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
   WHERE ns.nspname = 'public'
     AND rel.relname = 'inventory_items'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%item_type%'
   LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.inventory_items DROP CONSTRAINT %I', v_conname);
  END IF;

  ALTER TABLE public.inventory_items
    ADD CONSTRAINT inventory_items_item_type_check
    CHECK (item_type IN (
      'marker', 'sticker', 'wallpaper', 'other',
      'doll', 'coupon', 'junk'
    ));
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 2) slot_config : 단일 행 설정 테이블
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.slot_config (
  id           integer      PRIMARY KEY DEFAULT 1,
  spin_cost    integer      NOT NULL DEFAULT 400,
  lock_seconds integer      NOT NULL DEFAULT 50,
  jackpot_rate numeric(6,5) NOT NULL DEFAULT 0.02000,   -- 2%
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  -- 단일 행 강제 : id 는 항상 1
  CONSTRAINT slot_config_singleton CHECK (id = 1),
  CONSTRAINT slot_config_cost_pos     CHECK (spin_cost >= 0),
  CONSTRAINT slot_config_lock_pos     CHECK (lock_seconds >= 0),
  CONSTRAINT slot_config_rate_range   CHECK (jackpot_rate >= 0 AND jackpot_rate <= 1)
);

-- 기본 행 1건 보장 (있으면 무시)
INSERT INTO public.slot_config (id, spin_cost, lock_seconds, jackpot_rate)
VALUES (1, 400, 50, 0.02000)
ON CONFLICT (id) DO NOTHING;

-- RLS : 읽기는 누구나(로그인 유저), 쓰기는 GM 만
ALTER TABLE public.slot_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS slot_config_read_all ON public.slot_config;
CREATE POLICY slot_config_read_all
  ON public.slot_config FOR SELECT
  USING (true);

DROP POLICY IF EXISTS slot_config_gm_update ON public.slot_config;
CREATE POLICY slot_config_gm_update
  ON public.slot_config FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid() AND p.is_gm = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid() AND p.is_gm = true
  ));

-- ────────────────────────────────────────────────────────────────────
-- 3) 내부 함수 : 가중치 추첨
--    p_kind 에 해당하는 활성 슬롯 보상 아이템 중 metadata.weight 가중치로
--    하나를 뽑아 shop_items 행을 RECORD 로 반환. 풀이 비면 NULL.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._slot_pick_weighted(p_kind text)
  RETURNS public.shop_items
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_total   bigint;
  v_roll    bigint;
  v_item    public.shop_items;
  v_acc     bigint := 0;
  v_rec     RECORD;
BEGIN
  -- 가중치 합계 (weight 없으면 1로 간주, 최소 1 보장)
  SELECT COALESCE(SUM(GREATEST(COALESCE((metadata->>'weight')::int, 1), 1)), 0)
    INTO v_total
    FROM public.shop_items
   WHERE is_active = true
     AND COALESCE((metadata->>'slot_reward')::boolean, false) = true
     AND metadata->>'slot_kind' = p_kind;

  IF v_total <= 0 THEN
    RETURN NULL;   -- 풀 비었음
  END IF;

  -- 1 .. v_total 중 정수 하나
  v_roll := floor(random() * v_total)::bigint + 1;

  FOR v_rec IN
    SELECT si.*,
           GREATEST(COALESCE((si.metadata->>'weight')::int, 1), 1) AS w
      FROM public.shop_items si
     WHERE si.is_active = true
       AND COALESCE((si.metadata->>'slot_reward')::boolean, false) = true
       AND si.metadata->>'slot_kind' = p_kind
     ORDER BY si.id
  LOOP
    v_acc := v_acc + v_rec.w;
    IF v_roll <= v_acc THEN
      SELECT * INTO v_item FROM public.shop_items WHERE id = v_rec.id;
      RETURN v_item;
    END IF;
  END LOOP;

  -- 이론상 도달 불가 (합계 안에서 뽑았으므로). 방어적으로 NULL.
  RETURN NULL;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 4) 내부 함수 : 인벤토리 지급 (스택 99 처리)
--    해당 유저의 (item_type, item_ref) 행들을 FOR UPDATE 로 잠그고,
--    quantity < 99 인 가장 오래된 행을 +1. 그런 행이 없으면 새 행(1).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._slot_give_item(
  p_profile_id uuid,
  p_item_type  text,
  p_item_ref   text,
  p_metadata   jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_row_id uuid;
BEGIN
  -- 99 미만 스택 중 가장 오래된 것 하나 잠금
  SELECT id INTO v_row_id
    FROM public.inventory_items
   WHERE profile_id = p_profile_id
     AND item_type  = p_item_type
     AND item_ref   = p_item_ref
     AND quantity   < 99
   ORDER BY acquired_at ASC
   LIMIT 1
   FOR UPDATE;

  IF v_row_id IS NOT NULL THEN
    UPDATE public.inventory_items
       SET quantity = quantity + 1
     WHERE id = v_row_id;
  ELSE
    -- 채울 스택 없음 → 새 꾸러미 (durability 는 노는 아이템이라 NULL)
    INSERT INTO public.inventory_items
      (profile_id, item_type, item_ref, quantity, durability, metadata)
    VALUES
      (p_profile_id, p_item_type, p_item_ref, 1, NULL, COALESCE(p_metadata, '{}'::jsonb));
  END IF;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 5) spin_slot() : 메인 RPC
--    반환 JSON :
--      {
--        ok: true,
--        jackpot: boolean,
--        new_mobil: int,
--        rewards: [ { kind, item_ref, name, image_url } , ... ]
--      }
--    실패는 EXCEPTION 으로 (클라 helper 가 정규화).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.spin_slot()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_mobil      integer;
  v_cost       integer;
  v_rate       numeric;
  v_next_mobil integer;
  v_is_jackpot boolean;
  v_doll       public.shop_items;
  v_junk       public.shop_items;
  v_coupon     public.shop_items;
  v_rewards    jsonb := '[]'::jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- 설정 읽기
  SELECT spin_cost, jackpot_rate INTO v_cost, v_rate
    FROM public.slot_config WHERE id = 1;
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'slot_config_missing';
  END IF;

  -- 프로필 + 잔액 잠금 (동시성 직렬화 · 연타 방어)
  SELECT id, mobil INTO v_profile_id, v_mobil
    FROM public.profiles
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_mobil < v_cost THEN
    RAISE EXCEPTION 'insufficient_mobil';
  END IF;

  -- ── 당첨 판정 ──
  v_is_jackpot := random() < v_rate;

  IF v_is_jackpot THEN
    -- 잭팟 : 인형만
    v_doll := public._slot_pick_weighted('doll');
    IF v_doll.id IS NULL THEN
      RAISE EXCEPTION 'slot_pool_empty';   -- 인형 풀 비었음 → 차감 롤백
    END IF;
    PERFORM public._slot_give_item(v_profile_id, 'doll', v_doll.item_ref, v_doll.metadata);
    v_rewards := v_rewards || jsonb_build_object(
      'kind', 'doll', 'item_ref', v_doll.item_ref,
      'name', v_doll.name, 'image_url', v_doll.image_url
    );
  ELSE
    -- 논잭팟 : 쿠폰 1 + 잡템 1 (둘 다 보장)
    v_coupon := public._slot_pick_weighted('coupon');
    v_junk   := public._slot_pick_weighted('junk');
    IF v_coupon.id IS NULL OR v_junk.id IS NULL THEN
      RAISE EXCEPTION 'slot_pool_empty';   -- 쿠폰/잡템 풀 비었음 → 롤백
    END IF;

    PERFORM public._slot_give_item(v_profile_id, 'coupon', v_coupon.item_ref, v_coupon.metadata);
    PERFORM public._slot_give_item(v_profile_id, 'junk',   v_junk.item_ref,   v_junk.metadata);

    v_rewards := v_rewards
      || jsonb_build_object('kind','coupon','item_ref',v_coupon.item_ref,'name',v_coupon.name,'image_url',v_coupon.image_url)
      || jsonb_build_object('kind','junk',  'item_ref',v_junk.item_ref,  'name',v_junk.name,  'image_url',v_junk.image_url);
  END IF;

  -- ── 차감 (지급 성공 후) ──
  v_next_mobil := v_mobil - v_cost;
  UPDATE public.profiles SET mobil = v_next_mobil WHERE id = v_profile_id;

  RETURN jsonb_build_object(
    'ok', true,
    'jackpot', v_is_jackpot,
    'new_mobil', v_next_mobil,
    'rewards', v_rewards
  );
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- [롤백 스니펫] (문제 시 수동 실행)
-- ─────────────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.spin_slot();
--   DROP FUNCTION IF EXISTS public._slot_give_item(uuid, text, text, jsonb);
--   DROP FUNCTION IF EXISTS public._slot_pick_weighted(text);
--   DROP TABLE IF EXISTS public.slot_config;
--   ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS inventory_items_item_type_check;
--   ALTER TABLE public.inventory_items
--     ADD CONSTRAINT inventory_items_item_type_check
--     CHECK (item_type IN ('marker','sticker','wallpaper','other'));
-- COMMIT;
--
-- [검증 쿼리]
-- 1) 설정 : SELECT * FROM public.slot_config;
-- 2) 슬롯 보상 풀 확인 :
--    SELECT item_ref, name, metadata->>'slot_kind' AS kind,
--           metadata->>'weight' AS weight
--      FROM public.shop_items
--     WHERE COALESCE((metadata->>'slot_reward')::boolean,false) = true;
-- 3) 스핀 (유저 세션에서) : SELECT public.spin_slot();
-- 4) 인벤토리 스택 : SELECT item_type, item_ref, quantity, acquired_at
--      FROM public.inventory_items WHERE item_type IN ('doll','coupon','junk')
--     ORDER BY item_type, acquired_at;
-- ═══════════════════════════════════════════════════════════════════
