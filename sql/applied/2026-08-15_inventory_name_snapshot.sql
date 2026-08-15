-- sql/pending/2026-08-15_inventory_name_snapshot.sql
-- ═══════════════════════════════════════════════════════════════════
-- 인벤토리 : 모든 아이템에 개별 name 스냅샷 (+ image_url 일관 병합) + 백필
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   인벤토리는 inventory_items 만 읽고 shop_items.name 을 저장하지 않아,
--   화면에 대분류(“인형”·“스티커” 등)로만 떴다. 지급 시점에 name 을
--   metadata 에 스냅샷으로 심어, 인벤토리에서 개별 이름이 그대로 뜨게 한다.
--   프론트(InventorySection)는 이미 metadata.name 을 우선 사용한다.
--
--   image_url 은 2026-08-15_inventory_discard_and_image.sql 에서 spin_slot
--   지급분에만 들어갔다. 이번에 purchase_shop_item 지급분에도 image_url 을
--   함께 심어 슬롯/구매 아이템 표시를 일관되게 한다.
--
-- 이 마이그레이션이 하는 일 :
--   1) spin_slot() 재정의 — 지급 metadata 에 name 병합 (image_url·emoji 유지).
--   2) purchase_shop_item() 재정의 — marker·sticker·other 지급 metadata 에
--      name·image_url 병합. (로직·예외·이력 기록은 기존과 동일)
--   3) 기존 인벤토리 백필 — 각 행의 metadata 에 name(과 image_url)이 없으면
--      shop_items 에서 찾아 채운다.
--      · marker·sticker·other : (item_type, item_ref) 정확 매칭.
--      · doll·coupon·junk     : shop_items 는 other 로 저장되므로 item_ref 로만
--        매칭. 같은 item_ref 가 여러 개면 created_at 최신 1개.
--      · 매칭 실패 행은 건드리지 않는다(프론트 폴백 유지).
--      · 기존 metadata 의 다른 키는 보존. name 이 이미 있으면 덮어쓰지 않는다.
--
-- 안전장치 :
--   · 병합은 `기존 || 신규` 가 아니라 `신규 || 기존` 순서로, 기존 값이 우선
--     유지되도록 한다 (재실행 안전 · 수동 수정분 보존).
--   · 백필은 metadata ? 'name' (키 존재) 로 필터해 이미 채운 행은 건너뛴다
--     → 여러 번 실행해도 결과 동일(멱등).
--   · SECURITY DEFINER 함수 로직(잠금·차감·예외·이력)은 원본과 동일.
--   · 전체 BEGIN / COMMIT.
--
-- 복구 (롤백) :
--   · spin_slot·purchase_shop_item 은 직전 마이그레이션 정의로 되돌리면 됨.
--   · 백필로 채운 name 을 되돌리려면 아래 [롤백 스니펫] 참고(선택).
--
-- 선행 : 2026-08-14_slot_machine.sql · 2026-08-15_slot_reward_emoji.sql
--        · 2026-08-15_inventory_discard_and_image.sql · 2026-07-27_shop_other_type_purchase.sql
-- 후행 : components/noticeboard/panels/InventorySection.tsx (metadata.name 우선)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) spin_slot() : 지급 metadata 에 name 병합 (image_url·emoji 유지)
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
    -- 지급 metadata 에 name·image_url 스냅샷 병합 (기존 metadata 값 우선 유지)
    PERFORM public._slot_give_item(
      v_profile_id, 'doll', v_doll.item_ref,
      jsonb_build_object('name', v_doll.name, 'image_url', v_doll.image_url)
        || COALESCE(v_doll.metadata, '{}'::jsonb)
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
      jsonb_build_object('name', v_coupon.name, 'image_url', v_coupon.image_url)
        || COALESCE(v_coupon.metadata, '{}'::jsonb)
    );
    PERFORM public._slot_give_item(
      v_profile_id, 'junk', v_junk.item_ref,
      jsonb_build_object('name', v_junk.name, 'image_url', v_junk.image_url)
        || COALESCE(v_junk.metadata, '{}'::jsonb)
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
-- 2) purchase_shop_item() : 지급 metadata 에 name·image_url 병합
--    (로직·예외·이력 기록은 2026-07-27_shop_other_type_purchase.sql 과 동일)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_shop_item(p_shop_item_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_mobil      integer;
  v_item       RECORD;
  v_next_mobil integer;
  v_durability integer;
  v_meta       jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO v_item FROM public.shop_items WHERE id = p_shop_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found';
  END IF;
  IF NOT v_item.is_active THEN
    RAISE EXCEPTION 'item_inactive';
  END IF;

  SELECT id, mobil INTO v_profile_id, v_mobil
    FROM public.profiles
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_mobil < v_item.price THEN
    RAISE EXCEPTION 'insufficient_mobil';
  END IF;

  -- 지급용 metadata : name·image_url 스냅샷 병합 (기존 metadata 값 우선 유지)
  v_meta := jsonb_build_object('name', v_item.name, 'image_url', v_item.image_url)
              || COALESCE(v_item.metadata, '{}'::jsonb);

  IF v_item.item_type = 'marker' THEN
    v_durability := COALESCE(
      (v_item.metadata->>'initial_durability')::integer,
      100
    );
    INSERT INTO public.inventory_items
      (profile_id, item_type, item_ref, quantity, durability, metadata)
    VALUES
      (v_profile_id, 'marker', v_item.item_ref, 1, v_durability, v_meta);

  ELSIF v_item.item_type = 'sticker' THEN
    IF EXISTS (
      SELECT 1 FROM public.inventory_items
       WHERE profile_id = v_profile_id
         AND item_type  = 'sticker'
         AND item_ref   = v_item.item_ref
    ) THEN
      RAISE EXCEPTION 'duplicate_sticker';
    END IF;

    INSERT INTO public.inventory_items
      (profile_id, item_type, item_ref, quantity, durability, metadata)
    VALUES
      (v_profile_id, 'sticker', v_item.item_ref, 1, NULL, v_meta);

  ELSIF v_item.item_type = 'other' THEN
    IF v_item.item_ref IS NULL OR length(v_item.item_ref) = 0 THEN
      RAISE EXCEPTION 'other_item_missing_ref';
    END IF;

    UPDATE public.inventory_items
       SET quantity = quantity + 1
     WHERE profile_id = v_profile_id
       AND item_type  = 'other'
       AND item_ref   = v_item.item_ref;

    IF NOT FOUND THEN
      INSERT INTO public.inventory_items
        (profile_id, item_type, item_ref, quantity, durability, metadata)
      VALUES
        (v_profile_id, 'other', v_item.item_ref, 1, NULL, v_meta);
    END IF;

  ELSE
    RAISE EXCEPTION 'unsupported_item_type';
  END IF;

  v_next_mobil := v_mobil - v_item.price;
  UPDATE public.profiles
     SET mobil = v_next_mobil
   WHERE id = v_profile_id;

  INSERT INTO public.shop_purchases
    (profile_id, shop_item_id, item_code, item_name, item_type, price_paid, quantity)
  VALUES
    (v_profile_id, v_item.id, v_item.code, v_item.name, v_item.item_type, v_item.price, 1);

  RETURN v_next_mobil;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 3) 기존 인벤토리 백필 : metadata 에 name 없는 행을 shop_items 로 채움
-- ────────────────────────────────────────────────────────────────────

-- 3-a) marker·sticker·other : (item_type, item_ref) 정확 매칭
UPDATE public.inventory_items AS inv
   SET metadata = jsonb_build_object('name', si.name, 'image_url', si.image_url)
                    || COALESCE(inv.metadata, '{}'::jsonb)
  FROM public.shop_items AS si
 WHERE inv.item_type IN ('marker', 'sticker', 'other')
   AND NOT (inv.metadata ? 'name')
   AND si.item_type = inv.item_type
   AND si.item_ref  = inv.item_ref;

-- 3-b) doll·coupon·junk : shop_items 는 other 로 저장 → item_ref 로만 매칭.
--       같은 item_ref 가 여러 개면 created_at 최신 1개(DISTINCT ON).
UPDATE public.inventory_items AS inv
   SET metadata = jsonb_build_object('name', pick.name, 'image_url', pick.image_url)
                    || COALESCE(inv.metadata, '{}'::jsonb)
  FROM (
    SELECT DISTINCT ON (item_ref) item_ref, name, image_url
      FROM public.shop_items
     WHERE COALESCE((metadata->>'slot_reward')::boolean, false) = true
     ORDER BY item_ref, created_at DESC
  ) AS pick
 WHERE inv.item_type IN ('doll', 'coupon', 'junk')
   AND NOT (inv.metadata ? 'name')
   AND pick.item_ref = inv.item_ref;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- [롤백 스니펫] (문제 시 수동 실행)
-- ─────────────────────────────────────────────────────────────────────
-- · 함수 되돌리기 : spin_slot 은 2026-08-15_inventory_discard_and_image.sql,
--   purchase_shop_item 은 2026-07-27_shop_other_type_purchase.sql 의 정의를
--   다시 실행하면 name 병합 이전으로 돌아간다.
-- · 백필로 채운 name·image_url 만 제거하려면 (선택, 주의) :
--   -- UPDATE public.inventory_items
--   --    SET metadata = (metadata - 'name') - 'image_url'
--   --  WHERE ...;   -- 조건은 상황에 맞게. 수동 지정분과 섞이지 않도록 주의.
--
-- [검증 쿼리]
-- 1) 백필 결과 확인 :
--    SELECT item_type, item_ref, metadata->>'name' AS name,
--           metadata->>'image_url' AS img
--      FROM public.inventory_items
--     ORDER BY item_type;
-- 2) name 없는 잔여 행(매칭 실패) 확인 :
--    SELECT item_type, item_ref, COUNT(*)
--      FROM public.inventory_items
--     WHERE NOT (metadata ? 'name')
--     GROUP BY item_type, item_ref;
-- ═══════════════════════════════════════════════════════════════════
