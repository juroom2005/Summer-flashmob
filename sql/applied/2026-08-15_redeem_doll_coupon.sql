-- sql/pending/2026-08-15_redeem_doll_coupon.sql
-- ═══════════════════════════════════════════════════════════════════
-- 인형 교환권 사용 : redeem_doll_coupon() RPC
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   유저가 인형 교환권(coupon · item_ref='doll_coupon')을 써서 인형 풀에서
--   무작위(완전 균등)로 인형 1개를 받는다. 재화성(쿠폰 소모 + 인형 지급)
--   이므로 서버에서 한 트랜잭션으로 원자 처리한다.
--
--   · 인형 풀 = shop_items 중 is_active AND slot_reward=true AND slot_kind='doll'
--     (슬롯 잭팟이 뽑는 풀과 동일). 단 추첨은 가중치 무시 · 완전 균등(random()).
--   · 쿠폰 식별 : item_ref = 'doll_coupon' (현재 쿠폰이 인형 교환권 하나뿐).
--     향후 쿠폰이 늘면 metadata 태그 방식으로 확장 예정.
--
-- 이 마이그레이션이 하는 일 :
--   · redeem_doll_coupon() 신설 (SECURITY DEFINER, 원자 처리).
--     1) 세션 유저 프로필 확인.
--     2) doll_coupon 스택을 acquired_at 순으로 FOR UPDATE 잠금 · 합계 계산.
--        보유 0 이면 no_coupon 예외.
--     3) 인형 풀에서 균등 랜덤 1개 선택. 풀 비었으면 doll_pool_empty 예외
--        (쿠폰 차감 안 함).
--     4) 쿠폰 1개 차감(가장 오래된 스택부터, 빈 행 삭제).
--     5) 인형 1개 지급 : _slot_give_item 재사용 + name·image_url 스냅샷.
--     6) 반환 : { ok, item_ref, name, image_url, emoji, remaining_coupons }
--
-- 안전장치 :
--   · 쿠폰 스택·프로필을 FOR UPDATE 로 잠가 동시 사용/연타에도 이중 차감 방지.
--   · 풀 비었으면 차감 전에 예외 → 쿠폰만 사라지고 아무것도 안 주는 사고 방지.
--   · _slot_give_item 재사용으로 스택(99) 처리·지급 경로를 슬롯과 일치시킴.
--   · 전체 BEGIN / COMMIT.
--
-- 복구 (롤백) :
--   · DROP FUNCTION IF EXISTS public.redeem_doll_coupon();
--
-- 선행 : 2026-08-14_slot_machine.sql (_slot_give_item) · 인형 풀 등록분
-- 후행 : lib/inventory-helpers.ts (래퍼) · InventorySection.tsx (교환 UI)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.redeem_doll_coupon()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_coupon_ref text := 'doll_coupon';
  v_total      integer;
  v_to_remove  integer;
  v_rec        record;
  v_doll       public.shop_items;
  v_give_meta  jsonb;
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

  -- 쿠폰 스택 잠금 + 합계
  v_total := 0;
  FOR v_rec IN
    SELECT id, quantity
      FROM public.inventory_items
     WHERE profile_id = v_profile_id
       AND item_type  = 'coupon'
       AND item_ref   = v_coupon_ref
     ORDER BY acquired_at ASC
     FOR UPDATE
  LOOP
    v_total := v_total + v_rec.quantity;
  END LOOP;

  IF v_total < 1 THEN
    RAISE EXCEPTION 'no_coupon';
  END IF;

  -- 인형 풀에서 균등 랜덤 1개 (가중치 무시)
  SELECT * INTO v_doll
    FROM public.shop_items
   WHERE is_active = true
     AND COALESCE((metadata->>'slot_reward')::boolean, false) = true
     AND metadata->>'slot_kind' = 'doll'
   ORDER BY random()
   LIMIT 1;

  IF v_doll.id IS NULL THEN
    RAISE EXCEPTION 'doll_pool_empty';   -- 인형 없음 → 쿠폰 차감 안 함
  END IF;

  -- 쿠폰 1개 차감 (가장 오래된 스택부터, 빈 행 삭제)
  v_to_remove := 1;
  FOR v_rec IN
    SELECT id, quantity
      FROM public.inventory_items
     WHERE profile_id = v_profile_id
       AND item_type  = 'coupon'
       AND item_ref   = v_coupon_ref
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

  -- 인형 지급 (name·image_url 스냅샷 병합 · 기존 metadata 우선 유지)
  v_give_meta := jsonb_build_object('name', v_doll.name, 'image_url', v_doll.image_url)
                   || COALESCE(v_doll.metadata, '{}'::jsonb);
  PERFORM public._slot_give_item(v_profile_id, 'doll', v_doll.item_ref, v_give_meta);

  RETURN jsonb_build_object(
    'ok', true,
    'item_ref', v_doll.item_ref,
    'name', v_doll.name,
    'image_url', v_doll.image_url,
    'emoji', v_doll.metadata->>'emoji',
    'remaining_coupons', v_total - 1
  );
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- [롤백 스니펫]
--   DROP FUNCTION IF EXISTS public.redeem_doll_coupon();
--
-- [검증 쿼리]
-- 1) 인형 풀 개수 : SELECT count(*) FROM public.shop_items
--      WHERE is_active AND COALESCE((metadata->>'slot_reward')::boolean,false)
--        AND metadata->>'slot_kind'='doll';
-- 2) 교환 (유저 세션) : SELECT public.redeem_doll_coupon();
--    → 쿠폰 없으면 no_coupon, 인형 풀 비면 doll_pool_empty.
-- ═══════════════════════════════════════════════════════════════════
