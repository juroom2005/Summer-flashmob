-- sql/pending/2026-08-26_purchase_recovery_daily_cap.sql
-- ═══════════════════════════════════════════════════════════════════
-- 2026-08-26  회복 아이템(행동 충전 등) : 사람별 하루 1개 구매 제한
-- ═══════════════════════════════════════════════════════════════════
--
-- 요구사항 : 회복 카테고리 아이템은 "한 명이 하루에 한 개"만 구매 가능.
--            (사용 여부와 무관하게, 그날 이미 샀으면 더 못 산다.)
--            전체에서 하루 한 명만 사는 게 아니라, 사람마다 하루 1개.
--
-- 설계 원칙 (회귀 방지) :
--   · 중앙 RPC purchase_shop_item 은 절대 건드리지 않는다.
--   · 회복 아이템 전용 래퍼 RPC purchase_recovery_item 을 새로 만들어,
--     ① 대상이 회복 아이템인지 확인
--     ② 오늘(KST) 이 사람이 이 아이템을 이미 샀는지 shop_purchases 로 확인
--     ③ 통과 시 기존 purchase_shop_item 을 그대로 내부 호출(잔액 반환 위임)
--   · 프론트는 "회복 아이템일 때만" 이 RPC 를 호출한다(그 외는 기존 경로).
--   · CREATE OR REPLACE → 재실행(멱등) 가능. 전체 트랜잭션.
--
-- '오늘' 기준 : Asia/Seoul 자정. purchase_shop_item 이 성공 시 shop_purchases
--              에 (profile_id, shop_item_id, purchased_at) 이력을 남기므로
--              별도 집계 테이블 없이 그 이력으로 판정한다.
--
-- 회복 판정 : shop_items.metadata->>'category' = 'recovery'.
--            (프론트 상점 탭 분류와 동일 기준. 표식 없으면 회복 아님.)
--
-- 반환 : 성공 시 purchase_shop_item 과 동일하게 "조정 후 mobil(정수)" 반환.
--        → 프론트 purchaseShopItem 래퍼를 그대로 재사용 가능.
-- 예외 : not_recovery_item / already_bought_today / (그 외는 내부 RPC 예외 전파)
--
-- 롤백(수동) : DROP FUNCTION IF EXISTS public.purchase_recovery_item(uuid);
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.purchase_recovery_item(p_shop_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_today      date;
  v_category   text;
  v_result     integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- 프로필 잠금 : 같은 사람의 동시 이중구매를 직렬화(하루 1개 캡이 새지 않도록).
  -- purchase_shop_item 도 내부에서 같은 프로필을 FOR UPDATE 하는데, 동일 트랜잭션
  -- 내 재획득이라 자기 락은 재진입 가능 → 교착 없음.
  SELECT id INTO v_profile_id
    FROM public.profiles
   WHERE user_id = v_user_id
   FOR UPDATE;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- 대상이 회복 아이템인지 확인 (아니면 이 RPC 로 오면 안 됨)
  SELECT metadata->>'category' INTO v_category
    FROM public.shop_items
   WHERE id = p_shop_item_id;

  IF v_category IS DISTINCT FROM 'recovery' THEN
    RAISE EXCEPTION 'not_recovery_item';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  -- 오늘 이 사람이 이 아이템을 이미 샀는지 (KST 자정 기준)
  IF EXISTS (
    SELECT 1
      FROM public.shop_purchases
     WHERE profile_id   = v_profile_id
       AND shop_item_id = p_shop_item_id
       AND (purchased_at AT TIME ZONE 'Asia/Seoul')::date = v_today
  ) THEN
    RAISE EXCEPTION 'already_bought_today';
  END IF;

  -- 통과 → 기존 구매 RPC 에 위임 (잔액·인벤토리·이력 처리 전부 그쪽이 담당).
  -- 여기서 예외가 나면(잔액부족 등) 이 트랜잭션도 함께 롤백된다.
  v_result := public.purchase_shop_item(p_shop_item_id);

  RETURN v_result;
END;
$function$;

-- 프론트에서 직접 rpc 호출하므로 authenticated 에 실행권 부여 (프로젝트 관례).
GRANT EXECUTE ON FUNCTION public.purchase_recovery_item(uuid) TO authenticated;

COMMIT;
