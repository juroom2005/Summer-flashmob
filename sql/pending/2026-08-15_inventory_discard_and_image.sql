-- sql/pending/2026-08-15_inventory_discard_and_image.sql
-- ═══════════════════════════════════════════════════════════════════
-- 인벤토리 : (1) 슬롯 지급 시 image_url 스냅샷  (2) 파기 RPC 신설
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   · 인형(doll) 등 슬롯 보상을 인벤토리에서 이미지로 표시하려면 image_url
--     이 필요하다. inventory_items 에는 image_url 컬럼이 없으므로, 지급 시점에
--     metadata.image_url 로 "스냅샷" 을 심는다. (지급 후 GM 이 원본 shop_items
--     이미지를 바꾸거나 지워도 유저 인벤토리는 그대로 유지 — 정합성 안전)
--   · 유저가 일반 아이템(쿠폰·잡템·일반 other)을 직접 파기할 수 있게 한다.
--     파기 불가 : marker · sticker · doll (기능성·수집성 보호).
--     파기는 재화성 삭제이므로 서버 RPC 로 원자 처리한다.
--
-- 이 마이그레이션이 하는 일 :
--   1) spin_slot() 재정의 — 지급 metadata 에 image_url 병합 (+ emoji 유지).
--      · 2026-08-15_slot_reward_emoji.sql 의 emoji 반환도 그대로 포함한다.
--      · 함수 로직(잠금·차감·판정·롤백)은 원본과 동일. 지급에 넘기는 metadata
--        조립과 rewards JSON 만 손댄다.
--   2) discard_inventory_item(p_item_type, p_item_ref, p_count) 신설.
--      · 해당 유저의 (type, ref) 스택 행들을 acquired_at 순으로 FOR UPDATE 잠금.
--      · 합계에서 p_count 만큼 차감. 행을 오래된 것부터 비우고, 다 빈 행은 삭제.
--      · 파기 불가 타입은 discard_forbidden 예외.
--      · 보유 합계보다 많이 파기 시도하면 discard_too_many 예외 (아무것도 안 지움).
--      · 반환 : { ok, item_type, item_ref, discarded, remaining }
--
-- 안전장치 :
--   · 파기는 FOR UPDATE 로 스택을 직렬화 → 동시 파기/지급과 경합해도 안전.
--   · 합계 검사 후 차감 → 부분 삭제로 유령 수량이 남지 않음.
--   · SECURITY DEFINER + search_path=public. 본인 프로필 행만 조작.
--   · 전체 BEGIN / COMMIT.
--
-- 복구 (롤백) :
--   · DROP FUNCTION discard_inventory_item(text, text, integer);
--   · spin_slot() 은 2026-08-15_slot_reward_emoji.sql 정의로 되돌리면 됨.
--
-- 선행 : 2026-08-14_slot_machine.sql · 2026-08-15_slot_reward_emoji.sql
-- 후행 : lib/inventory-helpers.ts · InventorySection.tsx
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) spin_slot() 재정의 : 지급 metadata 에 image_url 스냅샷 병합
--    (emoji 반환은 2026-08-15_slot_reward_emoji.sql 과 동일하게 유지)
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

  SELECT spin_cost, jackpot_rate INTO v_cost, v_rate
    FROM public.slot_config WHERE id = 1;
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'slot_config_missing';
  END IF;

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

  v_is_jackpot := random() < v_rate;

  IF v_is_jackpot THEN
    v_doll := public._slot_pick_weighted('doll');
    IF v_doll.id IS NULL THEN
      RAISE EXCEPTION 'slot_pool_empty';
    END IF;
    -- 지급 metadata 에 image_url 스냅샷 병합 (원본 metadata 우선 유지)
    PERFORM public._slot_give_item(
      v_profile_id, 'doll', v_doll.item_ref,
      COALESCE(v_doll.metadata, '{}'::jsonb)
        || jsonb_build_object('image_url', v_doll.image_url)
    );
    v_rewards := v_rewards || jsonb_build_object(
      'kind', 'doll', 'item_ref', v_doll.item_ref,
      'name', v_doll.name, 'image_url', v_doll.image_url,
      'emoji', v_doll.metadata->>'emoji'
    );
  ELSE
    v_coupon := public._slot_pick_weighted('coupon');
    v_junk   := public._slot_pick_weighted('junk');
    IF v_coupon.id IS NULL OR v_junk.id IS NULL THEN
      RAISE EXCEPTION 'slot_pool_empty';
    END IF;

    PERFORM public._slot_give_item(
      v_profile_id, 'coupon', v_coupon.item_ref,
      COALESCE(v_coupon.metadata, '{}'::jsonb)
        || jsonb_build_object('image_url', v_coupon.image_url)
    );
    PERFORM public._slot_give_item(
      v_profile_id, 'junk', v_junk.item_ref,
      COALESCE(v_junk.metadata, '{}'::jsonb)
        || jsonb_build_object('image_url', v_junk.image_url)
    );

    v_rewards := v_rewards
      || jsonb_build_object('kind','coupon','item_ref',v_coupon.item_ref,'name',v_coupon.name,'image_url',v_coupon.image_url,'emoji',v_coupon.metadata->>'emoji')
      || jsonb_build_object('kind','junk',  'item_ref',v_junk.item_ref,  'name',v_junk.name,  'image_url',v_junk.image_url,  'emoji',v_junk.metadata->>'emoji');
  END IF;

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

-- ────────────────────────────────────────────────────────────────────
-- 2) discard_inventory_item() : 유저 인벤토리 아이템 파기 (원자 처리)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.discard_inventory_item(
  p_item_type text,
  p_item_ref  text,
  p_count     integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_total      integer;
  v_remaining  integer;
  v_to_remove  integer;
  v_rec        record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- 파기 불가 타입 방어 (기능성·수집성 아이템 보호)
  IF p_item_type IN ('marker', 'sticker', 'doll') THEN
    RAISE EXCEPTION 'discard_forbidden';
  END IF;

  IF p_item_ref IS NULL OR p_item_ref = '' THEN
    RAISE EXCEPTION 'invalid_item_ref';
  END IF;

  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'invalid_count';
  END IF;

  SELECT id INTO v_profile_id
    FROM public.profiles
   WHERE user_id = v_user_id;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- 해당 (type, ref) 스택 전체를 오래된 것부터 잠금 (동시성 직렬화)
  -- 합계 계산도 잠금 범위 안에서.
  v_total := 0;
  FOR v_rec IN
    SELECT id, quantity
      FROM public.inventory_items
     WHERE profile_id = v_profile_id
       AND item_type  = p_item_type
       AND item_ref   = p_item_ref
     ORDER BY acquired_at ASC
     FOR UPDATE
  LOOP
    v_total := v_total + v_rec.quantity;
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'item_not_found';
  END IF;

  IF p_count > v_total THEN
    RAISE EXCEPTION 'discard_too_many';   -- 보유보다 많이 파기 불가 (아무것도 안 지움)
  END IF;

  -- 오래된 행부터 차감. 다 빈 행은 삭제.
  v_to_remove := p_count;
  FOR v_rec IN
    SELECT id, quantity
      FROM public.inventory_items
     WHERE profile_id = v_profile_id
       AND item_type  = p_item_type
       AND item_ref   = p_item_ref
     ORDER BY acquired_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_to_remove <= 0;

    IF v_rec.quantity <= v_to_remove THEN
      DELETE FROM public.inventory_items WHERE id = v_rec.id;
      v_to_remove := v_to_remove - v_rec.quantity;
    ELSE
      UPDATE public.inventory_items
         SET quantity = quantity - v_to_remove
       WHERE id = v_rec.id;
      v_to_remove := 0;
    END IF;
  END LOOP;

  v_remaining := v_total - p_count;

  RETURN jsonb_build_object(
    'ok', true,
    'item_type', p_item_type,
    'item_ref', p_item_ref,
    'discarded', p_count,
    'remaining', v_remaining
  );
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- [롤백 스니펫] (문제 시 수동 실행)
-- ─────────────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.discard_inventory_item(text, text, integer);
--   -- spin_slot 은 2026-08-15_slot_reward_emoji.sql 의 정의를 다시 실행해 되돌림.
-- COMMIT;
--
-- [검증 쿼리]
-- 1) 파기 (유저 세션) : SELECT public.discard_inventory_item('junk', 'weed', 2);
-- 2) 파기 불가 확인   : SELECT public.discard_inventory_item('doll', 'doll_bunny', 1);
--    → discard_forbidden 예외.
-- 3) 지급 스냅샷 확인  : 스핀 후
--    SELECT item_type, item_ref, metadata->>'image_url' AS img
--      FROM public.inventory_items WHERE item_type IN ('doll','coupon','junk');
-- ═══════════════════════════════════════════════════════════════════
