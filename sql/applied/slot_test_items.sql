-- slot_test_items.sql  (검증용 · sql/pending 에 넣지 말 것 — 1회성 테스트 데이터)
-- ═══════════════════════════════════════════════════════════════════
-- 슬롯 보상 풀 검증용 아이템 삽입
-- ═══════════════════════════════════════════════════════════════════
--
-- spin_slot() 이 실제로 돌려면 인형·잡템·쿠폰 풀에 각각 최소 1개가 있어야 함.
-- 정식 아이템은 나중에 GM 등록 UI 로 넣고, 지금은 RPC 검증용으로 수동 삽입.
--
-- 태깅 규칙 :
--   metadata.slot_reward = true      → 슬롯 보상 대상
--   metadata.slot_kind   = doll|junk|coupon
--   metadata.weight      = 가중치(정수, 클수록 잘 나옴)
--
-- price 는 0 (슬롯 전용이라 상점 판매 안 함), is_active = true (풀 포함 조건).
-- 상점에 노출하기 싫으면 나중에 is_active 는 유지하되 별도 노출 필터를 두거나,
-- 지금은 검증이 목적이라 그대로 둔다.
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO public.shop_items
  (code, name, description, item_type, item_ref, image_url, price, is_active, metadata)
VALUES
  -- ── 인형 (doll) 2종 ──
  ('slot_doll_bunny', '코코 인형', '슬롯 잭팟 한정 인형', 'other', 'doll_bunny',
   '/dolls/bunny.png', 0, true,
   '{"slot_reward": true, "slot_kind": "doll", "weight": 1}'::jsonb),
  ('slot_doll_bear', '곰돌이 인형', '슬롯 잭팟 한정 인형', 'other', 'doll_bear',
   '/dolls/bear.png', 0, true,
   '{"slot_reward": true, "slot_kind": "doll", "weight": 1}'::jsonb),

  -- ── 잡템 (junk) 3종 · 가중치 차등 ──
  ('slot_junk_grass', '잡초 한 포기', '슬롯에서 나온 잡템', 'other', 'junk_grass',
   NULL, 0, true,
   '{"slot_reward": true, "slot_kind": "junk", "weight": 10}'::jsonb),
  ('slot_junk_pebble', '조약돌', '슬롯에서 나온 잡템', 'other', 'junk_pebble',
   NULL, 0, true,
   '{"slot_reward": true, "slot_kind": "junk", "weight": 6}'::jsonb),
  ('slot_junk_acorn', '도토리', '슬롯에서 나온 잡템', 'other', 'junk_acorn',
   NULL, 0, true,
   '{"slot_reward": true, "slot_kind": "junk", "weight": 3}'::jsonb),

  -- ── 쿠폰 (coupon) 1종 ──
  ('slot_coupon_doll', '인형 교환권', '10장 모으면 인형 랜덤 증정', 'other', 'doll_coupon',
   NULL, 0, true,
   '{"slot_reward": true, "slot_kind": "coupon", "weight": 1}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ── 삽입 확인 ──
SELECT item_ref,
       name,
       metadata->>'slot_kind' AS kind,
       metadata->>'weight'    AS weight
  FROM public.shop_items
 WHERE COALESCE((metadata->>'slot_reward')::boolean, false) = true
 ORDER BY metadata->>'slot_kind', item_ref;
