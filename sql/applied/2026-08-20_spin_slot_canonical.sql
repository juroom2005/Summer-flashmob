-- sql/pending/2026-08-20_spin_slot_canonical.sql
-- ═══════════════════════════════════════════════════════════════════
-- ★★★ spin_slot() 정본(SINGLE SOURCE OF TRUTH) — 여기만 수정할 것 ★★★
-- ═══════════════════════════════════════════════════════════════════
--
--  ⛔ 중요 : spin_slot() 함수는 이 파일이 유일한 정본이다.
--     · spin_slot 을 고칠 일이 생기면 반드시 "이 파일"만 편집한다.
--     · 다른 파일(2026-08-14_slot_machine.sql, 2026-08-15_slot_reward_emoji.sql)
--       에도 과거 spin_slot 정의가 남아 있으나 전부 폐기됨. 그 파일들의
--       spin_slot 을 다시 실행하면 아래 기능들이 사라진다(회귀 사고 원인).
--     · 새 기능을 추가할 때 별도 마이그레이션에서 spin_slot 을 CREATE OR
--       REPLACE 하지 말 것. 이 파일에 반영하고, 이 파일을 다시 실행한다.
--
--  이 정본이 보장하는 spin_slot 의 기능 (되돌아가면 안 되는 것들) :
--   1) 잭팟(random < jackpot_rate) → 인형만.
--   2) 논잭팟 → 잡템 항상 + 쿠폰은 coupon_rate 확률로만 (쿠폰 "매번" 아님).
--      · 쿠폰 풀이 비어도 롤백하지 않고 잡템만 주고 정상 진행.
--   3) rewards 반환 JSON 각 항목에 name·image_url·emoji 포함
--      (슬롯 보상 표시가 이미지→이모지→기본 순으로 뜨도록).
--   4) 지급 시 인벤토리 metadata 에 name·image_url 보강
--      (인벤토리에서 "인형" 뭉뚱그림이 아니라 실제 이름·이미지가 나오도록).
--      ※ 이게 빠지면 인벤토리 인형이 전부 "인형 🧸" 으로만 보인다.
--
--  선행(이미 적용돼 있어야 하는 것 — 이 파일은 재생성하지 않음) :
--   · slot_config 테이블 + RLS + 내부함수(_slot_pick_weighted, _slot_give_item)
--     : 2026-08-14_slot_machine.sql 이 최초 생성. (테이블/내부함수는 그대로 유효)
--   · coupon_rate 컬럼은 이 파일이 ADD COLUMN IF NOT EXISTS 로 보강한다.
--
--  적용 : Supabase SQL Editor 에서 이 파일 전체 실행. 재실행 안전
--         (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION).
--
--  검증(실행 후, GM 세션에서) :
--     SELECT public.spin_slot();
--     → rewards 각 항목에 name·image_url·emoji 키가 있는지 확인.
--     SELECT spin_cost, jackpot_rate, coupon_rate FROM public.slot_config WHERE id=1;
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
    PERFORM public._slot_give_item(
      v_profile_id, 'doll', v_doll.item_ref,
      -- 인벤토리 표시(이름·이미지·이모지)용으로 shop_items 컬럼값을 metadata 에 보강.
      -- 기존 metadata(slot_kind/weight/emoji 등)를 우선 유지하고 없는 키만 채운다.
      jsonb_build_object('name', v_doll.name, 'image_url', v_doll.image_url)
        || COALESCE(v_doll.metadata, '{}'::jsonb)
    );
    v_rewards := v_rewards || jsonb_build_object(
      'kind', 'doll', 'item_ref', v_doll.item_ref,
      'name', v_doll.name, 'image_url', v_doll.image_url,
      'emoji', v_doll.metadata->>'emoji'
    );
  ELSE
    -- 논잭팟 : 잡템 항상 + 쿠폰은 coupon_rate 확률로만
    v_junk := public._slot_pick_weighted('junk');
    IF v_junk.id IS NULL THEN
      RAISE EXCEPTION 'slot_pool_empty';   -- 잡템 풀 비었음 → 롤백 (잡템은 보장)
    END IF;
    PERFORM public._slot_give_item(
      v_profile_id, 'junk', v_junk.item_ref,
      jsonb_build_object('name', v_junk.name, 'image_url', v_junk.image_url)
        || COALESCE(v_junk.metadata, '{}'::jsonb)
    );
    v_rewards := v_rewards
      || jsonb_build_object('kind','junk','item_ref',v_junk.item_ref,'name',v_junk.name,'image_url',v_junk.image_url,'emoji',v_junk.metadata->>'emoji');

    -- 쿠폰 판정 (확률제). 나오기로 됐어도 쿠폰 풀이 비면 롤백하지 않고 건너뛴다.
    v_give_coupon := random() < v_coupon_rate;
    IF v_give_coupon THEN
      v_coupon := public._slot_pick_weighted('coupon');
      IF v_coupon.id IS NOT NULL THEN
        PERFORM public._slot_give_item(
          v_profile_id, 'coupon', v_coupon.item_ref,
          jsonb_build_object('name', v_coupon.name, 'image_url', v_coupon.image_url)
            || COALESCE(v_coupon.metadata, '{}'::jsonb)
        );
        v_rewards := v_rewards
          || jsonb_build_object('kind','coupon','item_ref',v_coupon.item_ref,'name',v_coupon.name,'image_url',v_coupon.image_url,'emoji',v_coupon.metadata->>'emoji');
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
