-- sql/pending/2026-08-15_purchase_camera.sql
-- ═══════════════════════════════════════════════════════════════════
-- 사진기(camera) 아이템 : shop seed + purchase_shop_item 의 camera 분기
-- ═══════════════════════════════════════════════════════════════════
--
-- 선행 : sql/pending/2026-08-15_daily_board.sql
--   → inventory_items.item_type CHECK 에 'camera' 가 이미 허용돼 있어야 함.
--     (이 파일보다 먼저 적용할 것)
--
-- 배경 :
--   연습일지 보드의 폴라로이드(photo) 기능은 사진기(camera) 아이템 보유자만
--   쓸 수 있다. 사진기는 스티커와 동일하게 "보유 여부만" 판정하는 무제한
--   아이템(중복 구매 거부, durability 없음).
--
-- 이 마이그레이션이 하는 일 :
--   0) shop_items.item_type CHECK 확장 — 'camera' 허용 (동적 탐색 후 재생성).
--      inventory_items 와 별개로 shop_items 에도 item_type CHECK 가 존재해,
--      이걸 확장하지 않으면 camera seed 가 CHECK 위반으로 거부된다.
--   1) 사진기 shop 아이템 seed (item_type='camera', code='camera_basic').
--      · 이미 있으면 재삽입 안 함. price/이름은 초안값(GM 이 조정 가능).
--   2) purchase_shop_item() 재정의 — 최신본(2026-08-15_inventory_name_snapshot)
--      을 그대로 두고 sticker 분기 뒤에 camera 분기를 추가.
--      · camera : sticker 와 동일 규칙(중복 보유 거부, quantity=1, durability=NULL).
--      · 그 외 로직·예외·이력 기록·metadata 스냅샷은 최신본과 100% 동일.
--
-- 안정성 :
--   · 전체 트랜잭션. RETURNS integer 시그니처 불변이므로 CREATE OR REPLACE 안전.
--   · 최신본에서 바뀐 부분은 "camera 분기 추가" 한 곳뿐. 나머지는 복제.
--
-- 롤백(수동) : 파일 하단.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 0) shop_items.item_type CHECK 확장 : 'camera' 추가
--    (inventory_items 와 별개로 shop_items 에도 item_type CHECK 가 있어,
--     camera seed 가 거부된다. 동적 탐색 후 재생성한다.)
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT con.conname INTO v_conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
   WHERE ns.nspname = 'public'
     AND rel.relname = 'shop_items'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%item_type%'
   LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.shop_items DROP CONSTRAINT %I', v_conname);
  END IF;

  ALTER TABLE public.shop_items
    ADD CONSTRAINT shop_items_item_type_check
    CHECK (item_type IN (
      'marker', 'sticker', 'wallpaper', 'refill_ink', 'other',
      'camera'
    ));
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 1) 사진기 shop 아이템 seed
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.shop_items (code, name, description, item_type, item_ref, price, metadata)
SELECT
  'camera_basic',
  '사진기',
  '연습일지 보드에 폴라로이드 사진을 붙일 수 있게 해주는 사진기입니다.',
  'camera',
  'camera_basic',
  300,
  jsonb_build_object('emoji', '📷')
WHERE NOT EXISTS (
  SELECT 1 FROM public.shop_items WHERE code = 'camera_basic'
);

-- ────────────────────────────────────────────────────────────────────
-- 2) purchase_shop_item 재정의 (camera 분기 추가)
--    최신본(2026-08-15_inventory_name_snapshot.sql) 복제 + sticker 뒤 camera.
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

  ELSIF v_item.item_type = 'camera' THEN
    -- 사진기 : 스티커와 동일 규칙. 이미 보유 시 중복 구매 거부.
    IF EXISTS (
      SELECT 1 FROM public.inventory_items
       WHERE profile_id = v_profile_id
         AND item_type  = 'camera'
         AND item_ref   = v_item.item_ref
    ) THEN
      RAISE EXCEPTION 'duplicate_camera';
    END IF;

    INSERT INTO public.inventory_items
      (profile_id, item_type, item_ref, quantity, durability, metadata)
    VALUES
      (v_profile_id, 'camera', v_item.item_ref, 1, NULL, v_meta);

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

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 롤백(수동) :
--   · purchase_shop_item 을 camera 분기 없는 최신본으로 되돌리려면
--     2026-08-15_inventory_name_snapshot.sql 의 함수 정의를 재적용.
--   · DELETE FROM public.shop_items WHERE code = 'camera_basic';
--     (이미 구매해 inventory_items 에 들어간 camera 행이 있으면 그 행도
--      정리할지 별도 판단. 보통은 남겨도 무방.)
-- ═══════════════════════════════════════════════════════════════════
