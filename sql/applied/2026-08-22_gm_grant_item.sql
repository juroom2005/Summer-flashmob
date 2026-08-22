-- sql/pending/2026-08-22_gm_grant_item.sql
-- ═══════════════════════════════════════════════════════════════════
-- GM 아이템 지급 + 유저 인벤토리 조회
-- ═══════════════════════════════════════════════════════════════════
--
-- 목적:
--   GM 관리 페이지(유저 상세)에서
--     1) 대상 유저에게 shop_items 카탈로그의 아이템을 무상 지급
--     2) 대상 유저의 현재 인벤토리 상태 확인
--   을 할 수 있게 한다.
--
--   기존에는 GM 이 재화(mobil)만 gm_grant_mobil 로 줄 수 있었고,
--   인벤토리 아이템을 직접 넣어주는 통로가 없었다.
--
-- ★ 중요 — 기존 자산 무변경 ★
--   · purchase_shop_item / bot_purchase_shop_item : 그대로 둔다.
--   · _slot_give_item / spin_slot / redeem_doll_coupon : 그대로 둔다.
--   · consume_marker_ink / discard_inventory_item : 그대로 둔다.
--   이 마이그레이션은 새 테이블 1개 + 새 함수 2개를 "추가"만 한다.
--   기존 RPC 를 CREATE OR REPLACE 로 덮어쓰지 않는다. 되돌아가는 사고 없음.
--
-- 지급 규칙 (purchase_shop_item / spin_slot 정본을 그대로 따름):
--   · slot 보상(metadata.slot_reward=true) → slot_kind(doll/coupon/junk)로
--     item_type 저장, 99 스택 병합 (_slot_give_item 과 동일한 로직 인라인).
--   · marker  → 새 행, durability = metadata.initial_durability(기본 100).
--   · sticker → 1개 한정. 이미 보유 시 duplicate_sticker.
--   · camera  → 1개 한정. 이미 보유 시 duplicate_camera.
--   · other   → 스택 quantity+1.
--   · wallpaper / refill_ink → unsupported_item_type
--       (구매 RPC 도 미지원하는, 지급 경로가 검증되지 않은 타입이므로 막는다.)
--
-- 원자성:
--   지급(inventory_items 반영) + 이력(item_grants) 을 한 트랜잭션에서 처리.
--   함수 하나가 통째로 하나의 트랜잭션이므로 중간 실패 시 전부 롤백.
--
-- 추적성:
--   지급 1건당 item_grants 1행. 무엇을·몇 개·누가·언제 지급했는지 남는다.
--   (mobil_grants 와 동일한 이력 정책)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- 1) 이력 테이블 : item_grants
--    mobil_grants 컨벤션(grant_type / note / grant_date / granted_by)을
--    그대로 따른다.
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.item_grants (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  profile_id    uuid        NOT NULL,
  shop_item_id  uuid,                       -- 지급 근거가 된 카탈로그 행 (삭제돼도 이력 보존 위해 NULL 허용)
  item_type     text        NOT NULL,       -- 실제 인벤토리에 저장된 타입 (slot 은 doll/coupon/junk)
  item_ref      text,
  item_name     text,                       -- 지급 시점 이름 스냅샷
  quantity      integer     NOT NULL,
  grant_type    text        NOT NULL DEFAULT 'gm_grant',
  note          text,
  grant_date    date        NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul'))::date,
  granted_by    uuid,
  granted_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT item_grants_pkey PRIMARY KEY (id),
  CONSTRAINT item_grants_quantity_check CHECK (quantity >= 1),
  CONSTRAINT item_grants_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT item_grants_shop_item_id_fkey
    FOREIGN KEY (shop_item_id) REFERENCES public.shop_items(id) ON DELETE SET NULL,
  CONSTRAINT item_grants_granted_by_fkey
    FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS item_grants_profile_id_idx
  ON public.item_grants USING btree (profile_id);
CREATE INDEX IF NOT EXISTS item_grants_granted_at_idx
  ON public.item_grants USING btree (granted_at DESC);

ALTER TABLE public.item_grants ENABLE ROW LEVEL SECURITY;

-- 조회 정책 : mobil_grants 와 동일 (GM 전체 / 본인 것)
--   INSERT 정책은 두지 않는다. 기록은 SECURITY DEFINER 함수로만 발생.
DROP POLICY IF EXISTS item_grants_gm_select ON public.item_grants;
CREATE POLICY item_grants_gm_select
  ON public.item_grants
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE profiles.user_id = auth.uid()
         AND profiles.is_gm = true
    )
  );

DROP POLICY IF EXISTS item_grants_own_select ON public.item_grants;
CREATE POLICY item_grants_own_select
  ON public.item_grants
  FOR SELECT
  TO public
  USING (
    profile_id IN (
      SELECT profiles.id FROM public.profiles
       WHERE profiles.user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- 2) 지급 함수 : gm_grant_inventory_item
--    GM 이 대상 유저에게 shop_items 한 종을 p_qty 개 지급.
--    반환 : 지급 후 해당 (profile, item_type, item_ref) 총 보유 수량.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_grant_inventory_item(
  p_profile_id   uuid,
  p_shop_item_id uuid,
  p_qty          integer DEFAULT 1,
  p_note         text    DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item        RECORD;
  v_is_slot     boolean;
  v_slot_kind   text;
  v_dest_type   text;      -- 인벤토리에 실제 저장될 item_type
  v_durability  integer;
  v_meta        jsonb;
  v_deact       timestamptz;
  v_total       integer := 0;
  v_row_id      uuid;
  i             integer;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  -- 1회 지급 상한 (오조작 방어). 필요 시 나눠서 지급.
  IF p_qty > 999 THEN
    RAISE EXCEPTION 'grant_too_many';
  END IF;

  -- 대상 유저 확인 + 잠금
  SELECT deactivated_at INTO v_deact
    FROM public.profiles
   WHERE id = p_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  IF v_deact IS NOT NULL THEN
    RAISE EXCEPTION 'recipient_deactivated';
  END IF;

  -- 카탈로그 아이템 확인
  SELECT * INTO v_item FROM public.shop_items WHERE id = p_shop_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found';
  END IF;
  IF NOT v_item.is_active THEN
    RAISE EXCEPTION 'item_inactive';
  END IF;

  v_is_slot   := COALESCE((v_item.metadata->>'slot_reward')::boolean, false);
  v_slot_kind := v_item.metadata->>'slot_kind';

  -- 지급용 metadata : name·image_url 스냅샷 병합 (기존 metadata 우선 유지)
  --   purchase_shop_item / spin_slot 과 동일 규칙.
  v_meta := jsonb_build_object('name', v_item.name, 'image_url', v_item.image_url)
              || COALESCE(v_item.metadata, '{}'::jsonb);

  -- ── 지급 대상 타입 결정 ──
  IF v_is_slot THEN
    IF v_slot_kind NOT IN ('doll', 'coupon', 'junk') THEN
      RAISE EXCEPTION 'unsupported_item_type';
    END IF;
    v_dest_type := v_slot_kind;
  ELSE
    v_dest_type := v_item.item_type;
    IF v_dest_type NOT IN ('marker', 'sticker', 'camera', 'other') THEN
      -- wallpaper / refill_ink 등 검증되지 않은 지급 경로는 막는다.
      RAISE EXCEPTION 'unsupported_item_type';
    END IF;
  END IF;

  -- ── 타입별 지급 ──
  IF v_dest_type IN ('doll', 'coupon', 'junk') THEN
    -- 스택형 : 99 미만 스택에 병합, 없으면 새 꾸러미. p_qty 만큼 반복.
    -- (_slot_give_item 과 동일 로직을 인라인 — 기존 함수는 1개씩만 넣으므로
    --  루프로 호출해도 되지만, 잠금/조회 왕복을 줄이려 인라인 처리)
    FOR i IN 1..p_qty LOOP
      SELECT id INTO v_row_id
        FROM public.inventory_items
       WHERE profile_id = p_profile_id
         AND item_type  = v_dest_type
         AND item_ref   = v_item.item_ref
         AND quantity   < 99
       ORDER BY acquired_at ASC
       LIMIT 1
       FOR UPDATE;

      IF v_row_id IS NOT NULL THEN
        UPDATE public.inventory_items
           SET quantity = quantity + 1
         WHERE id = v_row_id;
      ELSE
        INSERT INTO public.inventory_items
          (profile_id, item_type, item_ref, quantity, durability, metadata)
        VALUES
          (p_profile_id, v_dest_type, v_item.item_ref, 1, NULL, v_meta);
      END IF;
    END LOOP;

  ELSIF v_dest_type = 'marker' THEN
    -- 마커 : 각 자루가 독립 durability. p_qty 자루를 개별 행으로 지급.
    v_durability := COALESCE((v_item.metadata->>'initial_durability')::integer, 100);
    FOR i IN 1..p_qty LOOP
      INSERT INTO public.inventory_items
        (profile_id, item_type, item_ref, quantity, durability, metadata)
      VALUES
        (p_profile_id, 'marker', v_item.item_ref, 1, v_durability, v_meta);
    END LOOP;

  ELSIF v_dest_type = 'sticker' THEN
    -- 스티커 : 1개 한정. 수량 지정 무의미하며, 이미 보유 시 거부.
    IF p_qty <> 1 THEN
      RAISE EXCEPTION 'invalid_amount';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.inventory_items
       WHERE profile_id = p_profile_id
         AND item_type  = 'sticker'
         AND item_ref   = v_item.item_ref
    ) THEN
      RAISE EXCEPTION 'duplicate_sticker';
    END IF;
    INSERT INTO public.inventory_items
      (profile_id, item_type, item_ref, quantity, durability, metadata)
    VALUES
      (p_profile_id, 'sticker', v_item.item_ref, 1, NULL, v_meta);

  ELSIF v_dest_type = 'camera' THEN
    -- 사진기 : 스티커와 동일 규칙 (1개 한정).
    IF p_qty <> 1 THEN
      RAISE EXCEPTION 'invalid_amount';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.inventory_items
       WHERE profile_id = p_profile_id
         AND item_type  = 'camera'
         AND item_ref   = v_item.item_ref
    ) THEN
      RAISE EXCEPTION 'duplicate_camera';
    END IF;
    INSERT INTO public.inventory_items
      (profile_id, item_type, item_ref, quantity, durability, metadata)
    VALUES
      (p_profile_id, 'camera', v_item.item_ref, 1, NULL, v_meta);

  ELSIF v_dest_type = 'other' THEN
    -- 기타 : 단일 스택 quantity 누적.
    UPDATE public.inventory_items
       SET quantity = quantity + p_qty
     WHERE profile_id = p_profile_id
       AND item_type  = 'other'
       AND item_ref   = v_item.item_ref;
    IF NOT FOUND THEN
      INSERT INTO public.inventory_items
        (profile_id, item_type, item_ref, quantity, durability, metadata)
      VALUES
        (p_profile_id, 'other', v_item.item_ref, p_qty, NULL, v_meta);
    END IF;
  END IF;

  -- ── 이력 기록 ──
  INSERT INTO public.item_grants
    (profile_id, shop_item_id, item_type, item_ref, item_name, quantity,
     grant_type, note, granted_by)
  VALUES
    (p_profile_id, v_item.id, v_dest_type, v_item.item_ref, v_item.name, p_qty,
     'gm_grant', NULLIF(trim(COALESCE(p_note, '')), ''), auth.uid());

  -- ── 지급 후 총 보유 수량 계산 (marker 처럼 여러 행이면 합산) ──
  SELECT COALESCE(SUM(quantity), 0) INTO v_total
    FROM public.inventory_items
   WHERE profile_id = p_profile_id
     AND item_type  = v_dest_type
     AND item_ref   = v_item.item_ref;

  RETURN v_total;
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 3) 조회 함수 : gm_list_user_inventory
--    GM 이 대상 유저의 인벤토리 전체를 확인.
--    (inventory_items 는 select_all=true 라 직접 조회도 되지만,
--     GM 검증을 함수에 두어 다른 gm_* 조회와 일관되게 캡슐화)
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_list_user_inventory(
  p_profile_id uuid
)
RETURNS TABLE (
  id          uuid,
  item_type   text,
  item_ref    text,
  quantity    integer,
  durability  integer,
  metadata    jsonb,
  acquired_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  RETURN QUERY
    SELECT ii.id, ii.item_type, ii.item_ref, ii.quantity,
           ii.durability, ii.metadata, ii.acquired_at
      FROM public.inventory_items ii
     WHERE ii.profile_id = p_profile_id
     ORDER BY ii.acquired_at DESC;
END;
$function$;

COMMIT;
