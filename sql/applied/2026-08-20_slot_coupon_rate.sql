-- sql/pending/2026-08-20_slot_coupon_rate.sql
-- ═══════════════════════════════════════════════════════════════════
-- 슬롯 쿠폰을 "매번" → "확률제"로 변경 + GM 조정용 coupon_rate 추가
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경(변경 전):
--   논잭팟이면 항상 "쿠폰 1 + 잡템 1"을 지급 → 쿠폰이 매 스핀(잭팟 제외)마다 나옴.
--
-- 변경 후:
--   논잭팟이면 잡템은 항상 지급하고, 쿠폰은 slot_config.coupon_rate 확률로만
--   추가 지급한다. 즉:
--     · 잭팟(random < jackpot_rate)        → 인형만
--     · 논잭팟 + (random < coupon_rate)     → 잡템 1 + 쿠폰 1
--     · 논잭팟 + (그 외)                    → 잡템 1만
--
-- 쿠폰류 확장(재화교환권 등):
--   쿠폰은 slot_kind='coupon' 하나로 묶고 item_ref 로 종류를 구분한다.
--   (예: 'doll_coupon', 'mobil_voucher_1000'). 쿠폰이 나올 확률은 coupon_rate
--   하나로 관리하고, 어떤 쿠폰이 뽑힐지는 각 아이템 metadata.weight 로 결정된다
--   (_slot_pick_weighted('coupon') 이 이미 그렇게 동작). 새 쿠폰은 shop_items 에
--   등록만 하면 별도 코드 변경 없이 풀에 포함된다.
--
-- 안전성(중요):
--   · 잡템 풀이 비면 기존과 동일하게 slot_pool_empty 로 롤백(모빌 안 빠짐).
--   · 쿠폰은 확률제라 "안 나오는 게 정상". 따라서 쿠폰을 지급하기로 판정됐는데
--     쿠폰 풀이 비어 있으면 → 롤백하지 않고 쿠폰 없이 잡템만 주고 정상 진행한다.
--     (쿠폰 풀이 비었다고 스핀을 실패시키면 안 됨)
--   · 지급 먼저, 차감 나중 원칙 유지.
--
-- 재실행 안전:
--   · ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
--
-- 롤백(수동):
--   ALTER TABLE public.slot_config DROP CONSTRAINT IF EXISTS slot_config_coupon_rate_range;
--   ALTER TABLE public.slot_config DROP COLUMN IF EXISTS coupon_rate;
--   그리고 spin_slot 을 2026-08-14_slot_machine.sql 버전으로 되돌린다.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1) coupon_rate 컬럼 (0~1, 기본 0.20 = 20%) -------------------------
ALTER TABLE public.slot_config
  ADD COLUMN IF NOT EXISTS coupon_rate numeric(6,5) NOT NULL DEFAULT 0.20000;

-- 범위 CHECK (jackpot_rate 규칙과 동일: 0~1)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'slot_config_coupon_rate_range'
  ) THEN
    ALTER TABLE public.slot_config
      ADD CONSTRAINT slot_config_coupon_rate_range
      CHECK (coupon_rate >= 0 AND coupon_rate <= 1);
  END IF;
END$$;

-- 2) spin_slot 재정의 (쿠폰 확률제) ----------------------------------
CREATE OR REPLACE FUNCTION public.spin_slot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     uuid;
  v_profile_id  uuid;
  v_mobil       integer;
  v_cost        integer;
  v_rate        numeric;   -- jackpot_rate
  v_coupon_rate numeric;   -- coupon_rate
  v_next_mobil  integer;
  v_is_jackpot  boolean;
  v_give_coupon boolean;
  v_doll        public.shop_items;
  v_junk        public.shop_items;
  v_coupon      public.shop_items;
  v_rewards     jsonb := '[]'::jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- 설정 읽기 (coupon_rate 포함)
  SELECT spin_cost, jackpot_rate, coupon_rate
    INTO v_cost, v_rate, v_coupon_rate
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
    -- 논잭팟 : 잡템 항상 + 쿠폰은 coupon_rate 확률로만
    v_junk := public._slot_pick_weighted('junk');
    IF v_junk.id IS NULL THEN
      RAISE EXCEPTION 'slot_pool_empty';   -- 잡템 풀 비었음 → 롤백 (잡템은 보장)
    END IF;
    PERFORM public._slot_give_item(v_profile_id, 'junk', v_junk.item_ref, v_junk.metadata);
    v_rewards := v_rewards
      || jsonb_build_object('kind','junk','item_ref',v_junk.item_ref,'name',v_junk.name,'image_url',v_junk.image_url);

    -- 쿠폰 판정 (확률제). 나오기로 됐어도 쿠폰 풀이 비면 롤백하지 않고 건너뛴다.
    v_give_coupon := random() < v_coupon_rate;
    IF v_give_coupon THEN
      v_coupon := public._slot_pick_weighted('coupon');
      IF v_coupon.id IS NOT NULL THEN
        PERFORM public._slot_give_item(v_profile_id, 'coupon', v_coupon.item_ref, v_coupon.metadata);
        v_rewards := v_rewards
          || jsonb_build_object('kind','coupon','item_ref',v_coupon.item_ref,'name',v_coupon.name,'image_url',v_coupon.image_url);
      END IF;
      -- 쿠폰 풀이 비어 있으면(v_coupon.id IS NULL) 조용히 건너뜀 → 잡템만 지급된 상태로 정상 진행.
    END IF;
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

-- 확인 --------------------------------------------------------------
-- SELECT spin_cost, jackpot_rate, coupon_rate FROM public.slot_config WHERE id=1;
