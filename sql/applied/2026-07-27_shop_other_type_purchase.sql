-- sql/pending/2026-07-27_shop_other_type_purchase.sql
-- ═══════════════════════════════════════════════════════════════════
-- purchase_shop_item RPC 확장 : item_type = 'other' (이벤트성 아이템) 구매 지원
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   지금까지 purchase_shop_item 은 marker · sticker 만 인벤토리에 반영하고
--   그 외 타입은 'unsupported_item_type' 예외를 던져 구매 자체를 거부해 왔다.
--   본 세션에서 GM 이 "이벤트성 아이템 (예: 소다맛 아이스크림)" 을 등록할 수
--   있도록, other 타입 구매 시 :
--     · 같은 (profile_id, item_type='other', item_ref) 행이 이미 있으면
--       quantity += 1 로 누적
--     · 없으면 새 행을 quantity=1 로 생성
--   방식으로 처리하도록 확장한다.
--
-- 이벤트성 아이템의 실체 (사용자 요청) :
--   · 기능 없음. 구매 이후 인벤토리에 아이스크림 · 아이스크림 처럼 쌓이기만 함
--   · 같은 종류 재구매 가능 (quantity 누적)
--
-- 유지되는 사항 :
--   · marker 처리 : 기존 그대로 (durability 초기값 = metadata.initial_durability
--     또는 100)
--   · sticker 처리 : 기존 그대로 (중복 소지 거부, duplicate_sticker 예외)
--   · wallpaper · refill_ink 는 여전히 'unsupported_item_type' 예외
--   · 잔액 차감 · shop_purchases 이력 기록 · RETURN 값 모두 동일
--
-- 안전장치 :
--   · CREATE OR REPLACE FUNCTION 은 기존 함수를 원자적으로 교체한다.
--     실행 중인 다른 트랜잭션에는 영향 없음.
--   · other 타입에 item_ref 가 NULL 또는 빈 문자열이면 누적 대상 식별이
--     불가능하므로 'other_item_missing_ref' 예외로 명시적 실패.
--     (shop_items 스키마에서 item_ref 는 NOT NULL 이지만 이중 방어)
--   · inventory_items 에 (profile_id, item_type, item_ref) UNIQUE 제약이
--     없으므로, UPDATE 후 FOUND 검사로 INSERT 여부를 결정한다.
--   · 트랜잭션 (BEGIN / COMMIT) 으로 감쌈.
--   · 실패 시 롤백을 위해 별도 안전 스크립트 없음. CREATE OR REPLACE 는
--     원본 정의를 잃지 않고 갱신하므로, 문제가 있을 경우 이 파일 실행 전의
--     스키마 dump (2026-07-24) 의 정의를 다시 붙여 복구 가능.
--
-- 선행 마이그레이션 : 2026-07-27_shop_gm_policies.sql
-- 후행 영향 :
--   · lib/shop-helpers.ts normalizePurchaseError 는 'other_item_missing_ref'
--     신규 에러를 unknown 으로 처리하게 되므로, 필요 시 매핑 추가 권장
--     (본 마이그레이션 범위 밖).
--   · components/noticeboard/panels/InventorySection.tsx 는 other 타입 렌더
--     로직을 추가해야 유저가 구매 결과를 볼 수 있다 (별도 작업).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.purchase_shop_item(p_shop_item_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      uuid;
  v_profile_id   uuid;
  v_mobil        integer;
  v_item         RECORD;
  v_next_mobil   integer;
  v_durability   integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- 아이템 조회
  SELECT * INTO v_item FROM public.shop_items WHERE id = p_shop_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found';
  END IF;
  IF NOT v_item.is_active THEN
    RAISE EXCEPTION 'item_inactive';
  END IF;

  -- 세션 유저 프로필 + 잔액 잠금
  SELECT id, mobil INTO v_profile_id, v_mobil
    FROM public.profiles
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- 잔액 확인
  IF v_mobil < v_item.price THEN
    RAISE EXCEPTION 'insufficient_mobil';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 종류별 인벤토리 처리
  -- ────────────────────────────────────────────────────────────────
  IF v_item.item_type = 'marker' THEN
    v_durability := COALESCE(
      (v_item.metadata->>'initial_durability')::integer,
      100
    );
    INSERT INTO public.inventory_items
      (profile_id, item_type, item_ref, quantity, durability, metadata)
    VALUES
      (v_profile_id, 'marker', v_item.item_ref, 1, v_durability, v_item.metadata);

  ELSIF v_item.item_type = 'sticker' THEN
    -- 이미 소지 여부 확인 (스티커는 무제한이라 중복 구매 거부)
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
      (v_profile_id, 'sticker', v_item.item_ref, 1, NULL, v_item.metadata);

  ELSIF v_item.item_type = 'other' THEN
    -- ────────────────────────────────────────────────────────────
    -- 신규 : 이벤트성 아이템 (기능 없음, 인벤토리에 quantity 누적)
    -- ────────────────────────────────────────────────────────────
    IF v_item.item_ref IS NULL OR length(v_item.item_ref) = 0 THEN
      RAISE EXCEPTION 'other_item_missing_ref';
    END IF;

    -- 같은 종류가 있으면 누적
    UPDATE public.inventory_items
       SET quantity = quantity + 1
     WHERE profile_id = v_profile_id
       AND item_type  = 'other'
       AND item_ref   = v_item.item_ref;

    -- 없으면 새 행
    IF NOT FOUND THEN
      INSERT INTO public.inventory_items
        (profile_id, item_type, item_ref, quantity, durability, metadata)
      VALUES
        (v_profile_id, 'other', v_item.item_ref, 1, NULL, v_item.metadata);
    END IF;

  ELSE
    -- wallpaper · refill_ink 등은 여전히 미지원
    RAISE EXCEPTION 'unsupported_item_type';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 잔액 차감
  -- ────────────────────────────────────────────────────────────────
  v_next_mobil := v_mobil - v_item.price;
  UPDATE public.profiles
     SET mobil = v_next_mobil
   WHERE id = v_profile_id;

  -- ────────────────────────────────────────────────────────────────
  -- 이력 기록
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO public.shop_purchases
    (profile_id, shop_item_id, item_code, item_name, item_type, price_paid, quantity)
  VALUES
    (v_profile_id, v_item.id, v_item.code, v_item.name, v_item.item_type, v_item.price, 1);

  RETURN v_next_mobil;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인 (수동 검증용)
-- ─────────────────────────────────────────────────────────────────────
-- 1) 함수 정의 재확인
-- SELECT prosrc
--   FROM pg_proc
--  WHERE proname = 'purchase_shop_item';
--
-- 2) GM 이 shop_items 에 임시 other 아이템 하나 만든 뒤 :
--    (실제로는 다음 세션의 아이템 추가 UI 로 만들 예정. 지금은 수동 INSERT 가능)
--    · 유저 계정으로 두 번 구매 → inventory_items 에 같은 행 quantity=2 되는지
--    · shop_purchases 에 2 개 이력 남는지
-- ═══════════════════════════════════════════════════════════════════
