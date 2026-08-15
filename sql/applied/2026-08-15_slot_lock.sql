-- sql/pending/2026-08-15_slot_lock.sql
-- ═══════════════════════════════════════════════════════════════════
-- 슬롯 잠금 : slot_config.is_locked 추가 + spin_slot 잠금 체크
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   GM 이 실시간 패치·점검 중 슬롯을 잠시 막을 수 있어야 한다. 이 잠금은
--   서버에서 강제해야 실효가 있으므로(클라만 막으면 우회 가능) slot_config
--   에 is_locked 를 두고 spin_slot 이 검사한다.
--
--   · is_locked = true  → spin_slot 이 slot_locked 예외로 즉시 거부.
--     (프로필 잠금·차감 전에 막아 재화에 영향 없음)
--   · lock_message      → 잠금 시 유저에게 보여줄 안내문(선택). 프론트가 사용.
--
--   참고 : slot_config.lock_seconds 는 이미 존재하며(기본 50), "슬롯 진입 후
--   첫 스핀까지의 오클릭 방지 대기 초"로 프론트가 쓰는 값이다. 서버 재화
--   로직과는 무관하다. 이 마이그레이션은 lock_seconds 를 건드리지 않는다.
--
-- 이 마이그레이션이 하는 일 :
--   1) slot_config 에 is_locked(boolean) · lock_message(text) 컬럼 추가.
--      · is_locked 기본 false (기존 단일 행에도 자동 채워짐).
--   2) spin_slot() 재정의 — 설정 읽은 직후 is_locked 검사.
--      · 나머지 로직(name·image_url·emoji 스냅샷, 판정, 차감, 롤백)은
--        2026-08-15_inventory_name_snapshot.sql 의 spin_slot 과 동일.
--
-- 안전장치 :
--   · 잠금 검사는 프로필 FOR UPDATE·차감 이전 → 잠금 상태에서 재화 변화 없음.
--   · 컬럼 추가는 DEFAULT 로 기존 행 자동 채움 → 단일 행 정합성 유지.
--   · 전체 BEGIN / COMMIT.
--
-- 복구 (롤백) :
--   · ALTER TABLE public.slot_config DROP COLUMN is_locked, DROP COLUMN lock_message;
--   · spin_slot 은 2026-08-15_inventory_name_snapshot.sql 정의로 되돌림.
--
-- 선행 : 2026-08-14_slot_machine.sql · 2026-08-15_inventory_name_snapshot.sql
-- 후행 : lib/slot-helpers.ts (설정 조회/갱신) · GM 슬롯 설정 UI
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) slot_config 컬럼 추가
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.slot_config
  ADD COLUMN IF NOT EXISTS is_locked    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_message text    NOT NULL DEFAULT '';

-- ────────────────────────────────────────────────────────────────────
-- 2) spin_slot() 재정의 : 설정 읽은 직후 is_locked 검사
--    (스냅샷·판정·차감 로직은 직전 마이그레이션과 동일)
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
  v_locked     boolean;
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

  -- 설정 읽기 (+ 잠금 여부)
  SELECT spin_cost, jackpot_rate, is_locked
    INTO v_cost, v_rate, v_locked
    FROM public.slot_config WHERE id = 1;
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'slot_config_missing';
  END IF;

  -- 잠금 상태면 프로필 잠금·차감 전에 즉시 거부 (재화 영향 없음)
  IF v_locked THEN
    RAISE EXCEPTION 'slot_locked';
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

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- [롤백 스니펫] (문제 시 수동 실행)
-- BEGIN;
--   ALTER TABLE public.slot_config
--     DROP COLUMN IF EXISTS is_locked,
--     DROP COLUMN IF EXISTS lock_message;
--   -- spin_slot 은 2026-08-15_inventory_name_snapshot.sql 정의를 다시 실행.
-- COMMIT;
--
-- [검증 쿼리]
-- 1) 잠금 켜기 (GM) : UPDATE public.slot_config SET is_locked = true WHERE id = 1;
-- 2) 스핀 (유저)    : SELECT public.spin_slot();  → slot_locked 예외 · 모빌 변화 없음
-- 3) 잠금 끄기       : UPDATE public.slot_config SET is_locked = false WHERE id = 1;
-- ═══════════════════════════════════════════════════════════════════
