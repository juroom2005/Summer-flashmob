-- sql/pending/2026-08-15_consume_marker_ink.sql
-- ═══════════════════════════════════════════════════════════════════
-- 사인펜 잉크 소모 : consume_marker_ink RPC
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   연습일지 보드 드로잉은 사인펜(marker) 보유자만 쓸 수 있고, 그릴 때
--   잉크(inventory_items.durability)를 소모해야 소모품 설계가 의미를 갖는다.
--   (inventory-helpers.ts 주석의 "사인펜 사용 시 durability 감소 … 일지 드로잉
--    붙일 때 함께" 예고분을 이 마이그레이션에서 구현.)
--
--   밸런스(기획 확정) :
--     · 소모량 = 선 길이 비례. (프론트가 stroke 픽셀 길이 → 소모량 산출해 전달)
--     · 잉크 0 이 되면 그 사인펜은 삭제하지 않고 durability=0 으로 남긴다.
--       (추후 리필 아이템으로 채울 여지. 팔레트에서만 빠짐 — 프론트 판정.)
--
-- 왜 RPC(SECURITY DEFINER) 인가 :
--   · durability 를 클라가 직접 UPDATE 하게 두면 조작 가능(무한 잉크 등).
--     서버에서 본인 소유 확인 + 하한(0) 보장 + 원자적 차감을 강제한다.
--   · 프로젝트 방침(모든 상태 변경은 RPC 경유)과 일치.
--
-- 이 마이그레이션이 하는 일 :
--   consume_marker_ink(p_inventory_id uuid, p_amount integer) 신설.
--     · 반환 : 차감 후 남은 durability (integer).
--     · 검증 : 로그인 · 대상 행이 "내 marker" · amount 양의 정수.
--     · 차감 : GREATEST(0, durability - amount) 로 0 하한. FOR UPDATE 락.
--     · durability 가 NULL(무한/미설정)인 사인펜은 소모하지 않고 그대로 둔다
--       (NULL 반환). 프론트는 NULL 을 "무한"으로 취급.
--
-- 안정성 :
--   · 전체 트랜잭션. SECURITY DEFINER + search_path='public'.
--   · 남의 행/타입 불일치는 조용히 거부(not_my_marker) — 조작 시도 방어.
--   · 이력 테이블은 두지 않는다(잉크 소모는 고빈도라 이력 부담이 큼). 필요 시
--     후속 라운드에서 추가.
--
-- 롤백(수동) : DROP FUNCTION IF EXISTS public.consume_marker_ink(uuid, integer);
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.consume_marker_ink(
  p_inventory_id uuid,
  p_amount       integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_type       text;
  v_dur        integer;
  v_next       integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'invalid_inventory_id';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT id INTO v_profile_id
    FROM public.profiles
   WHERE user_id = v_user_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- 대상 행 잠금 + 소유·타입 확인
  SELECT item_type, durability
    INTO v_type, v_dur
    FROM public.inventory_items
   WHERE id = p_inventory_id
     AND profile_id = v_profile_id
   FOR UPDATE;

  IF v_type IS NULL THEN
    -- 내 것이 아니거나 존재하지 않음
    RAISE EXCEPTION 'not_my_marker';
  END IF;
  IF v_type <> 'marker' THEN
    RAISE EXCEPTION 'not_my_marker';
  END IF;

  -- durability NULL = 무한/미설정 → 소모하지 않고 NULL 반환
  IF v_dur IS NULL THEN
    RETURN NULL;
  END IF;

  v_next := GREATEST(0, v_dur - p_amount);

  UPDATE public.inventory_items
     SET durability = v_next
   WHERE id = p_inventory_id;

  RETURN v_next;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 적용 후 확인(참고, 브라우저 로그인 세션에서) :
--   SELECT public.consume_marker_ink('<내 marker inventory_id>', 5);
--   → 차감 후 남은 잉크가 반환되면 정상. (SQL Editor 는 auth.uid()=null 이라
--     auth_required 예외가 나는 게 정상)
-- ═══════════════════════════════════════════════════════════════════
