-- sql/pending/2026-08-15_slot_reward_emoji.sql
-- ═══════════════════════════════════════════════════════════════════
-- 슬롯 보상 이모지 : spin_slot() 반환 JSON 에 emoji 필드 추가
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   슬롯 보상 표시를 "이미지 → 커스텀 이모지 → 종류 기본 이모지" 순으로
--   하기 위해, shop_items.metadata.emoji 를 스핀 결과에 실어 보낸다.
--   등록 UI(ShopItemCreatePanel)에서 슬롯 아이템에 이모지를 지정할 수 있고,
--   프론트(SlotZone)는 imageUrl 이 없을 때 이 emoji 를 쓴다.
--
-- 이 마이그레이션이 하는 일 :
--   · spin_slot() 을 CREATE OR REPLACE 로 갱신. 반환 rewards 각 항목에
--     'emoji' 키 추가 (metadata->>'emoji', 없으면 null).
--
-- 안전장치 :
--   · 함수 로직(잔액 잠금·차감·판정·지급·롤백)은 2026-08-14_slot_machine.sql
--     원본과 100% 동일. rewards JSON 조립에만 emoji 한 필드씩 추가했다.
--   · _slot_pick_weighted · _slot_give_item · slot_config 은 건드리지 않는다.
--   · image_url 과 무관 — emoji 는 표시용 부가 정보일 뿐, 지급/차감에 영향 없음.
--   · 전체 BEGIN / COMMIT.
--
-- 복구 (롤백) :
--   · 2026-08-14_slot_machine.sql 의 spin_slot() 정의를 다시 실행하면
--     emoji 없는 원본으로 되돌아간다. (아래 [롤백 스니펫] 참고)
--
-- 선행 : 2026-08-14_slot_machine.sql (spin_slot · slot_config · 내부 함수)
-- 후행 : lib/slot-helpers.ts (emoji 파싱) · SlotZone.tsx (표시 우선순위)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

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
      'name', v_doll.name, 'image_url', v_doll.image_url,
      'emoji', v_doll.metadata->>'emoji'
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
      || jsonb_build_object('kind','coupon','item_ref',v_coupon.item_ref,'name',v_coupon.name,'image_url',v_coupon.image_url,'emoji',v_coupon.metadata->>'emoji')
      || jsonb_build_object('kind','junk',  'item_ref',v_junk.item_ref,  'name',v_junk.name,  'image_url',v_junk.image_url,  'emoji',v_junk.metadata->>'emoji');
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
--   2026-08-14_slot_machine.sql 안의 spin_slot() 정의(CREATE OR REPLACE)를
--   그대로 다시 실행하면 emoji 없는 원본으로 되돌아간다.
--
-- [검증 쿼리]
-- 1) 이모지 지정된 슬롯 아이템 확인 :
--    SELECT item_ref, name, metadata->>'slot_kind' AS kind,
--           metadata->>'emoji' AS emoji, image_url
--      FROM public.shop_items
--     WHERE COALESCE((metadata->>'slot_reward')::boolean,false) = true;
-- 2) 스핀 (유저 세션에서) : SELECT public.spin_slot();
--    → rewards 각 항목에 emoji 키가 있는지 확인 (없으면 null).
-- ═══════════════════════════════════════════════════════════════════
