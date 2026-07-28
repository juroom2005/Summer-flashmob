-- sql/pending/2026-07-27_shop_gm_policies.sql
-- ═══════════════════════════════════════════════════════════════════
-- shop_items 에 GM 용 RLS 정책 4 종 추가 (SELECT · INSERT · UPDATE · DELETE)
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   현재 shop_items 에는 SELECT 정책 (shop_items_select_all) 만 존재하고
--   그 조건이 is_active = true 이다. 이 때문에 :
--     · 유저는 활성 아이템만 볼 수 있다 (의도)
--     · GM 도 비활성 아이템을 볼 수 없다 (의도치 않은 결과)
--     · GM 을 포함해 아무도 INSERT / UPDATE / DELETE 할 수 없다 (RPC 만 가능)
--
--   본 마이그레이션은 GM 관리 페이지의 상점 탭에서 카탈로그 CRUD 를
--   직접 처리할 수 있도록 정책 4 종을 신설한다. notices 테이블의 GM
--   정책 패턴과 동일한 방식.
--
-- 방침 (v9 §2-4 및 세션 G notices 정책 방식) :
--   · RLS 로만 GM 판정 (별도 RPC 없이 .from() 직접 CRUD)
--   · 판정 : profiles.user_id = auth.uid() AND profiles.is_gm = true
--   · PERMISSIVE 정책은 OR 결합되므로 기존 shop_items_select_all 유지 시
--     - 유저 : is_active = true 만 노출 (기존 그대로)
--     - GM  : 신규 shop_items_gm_select_all 로 전체 노출 (활성/비활성 무관)
--
-- 안전장치 :
--   · CREATE POLICY 는 IF NOT EXISTS 미지원이므로, 재실행 대비 DROP 선행.
--   · 기존 shop_items_select_all 은 손대지 않는다 (유저측 shop 화면 유지).
--   · 트랜잭션 (BEGIN / COMMIT) 으로 감싸 부분 적용 방지.
--
-- 선행 마이그레이션 : 없음
-- 후행 영향 : lib/gm-shop-helpers.ts (신설 예정) 이 본 정책 위에서 동작.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 재실행 대비 DROP (기존에 없으면 IF EXISTS 로 무시)
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS shop_items_gm_select_all ON public.shop_items;
DROP POLICY IF EXISTS shop_items_gm_insert     ON public.shop_items;
DROP POLICY IF EXISTS shop_items_gm_update     ON public.shop_items;
DROP POLICY IF EXISTS shop_items_gm_delete     ON public.shop_items;

-- ────────────────────────────────────────────────────────────────────
-- (a) GM 전체 조회 (활성/비활성 상관없이)
--     기존 shop_items_select_all 과 OR 결합됨.
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY shop_items_gm_select_all
  ON public.shop_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_gm   = true
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- (b) GM 신설
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY shop_items_gm_insert
  ON public.shop_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_gm   = true
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- (c) GM 수정
--     USING     : 어떤 행을 볼 수 있는가 (수정 대상 지정)
--     WITH CHECK: 수정 후 상태가 정책을 만족하는가
--     둘 다 동일 조건으로 두어 GM 만 수정 가능하도록.
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY shop_items_gm_update
  ON public.shop_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_gm   = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_gm   = true
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- (d) GM 삭제
--     shop_purchases.shop_item_id 는 ON DELETE SET NULL 이므로
--     구매 이력은 유지되고 shop_item_id 만 null 처리된다.
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY shop_items_gm_delete
  ON public.shop_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_gm   = true
    )
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인 쿼리 (수동 검증용)
-- ─────────────────────────────────────────────────────────────────────
-- SELECT policyname, cmd, roles, permissive
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename  = 'shop_items'
--  ORDER BY policyname;
-- ═══════════════════════════════════════════════════════════════════
