-- sql/pending/2026-08-15_daily_board.sql
-- ═══════════════════════════════════════════════════════════════════
-- 연습일지 (공용 데일리 보드) : daily_board_items 테이블 + RLS + GM RPC
--                              + 사진기(camera) 아이템 타입 신설
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 / 기획 :
--   메인홈 "연습일지" 버튼으로 여는 공용 화이트보드. 날짜별로 분리되며
--   (KST 자정 기준 새 보드), 과거 날짜 열람 가능. 모두가 같은 날짜 보드에
--   글·드로잉·스티커·폴라로이드를 올린다.
--
--   권한 :
--     · 일반 유저 : 본인이 올린 아이템만 등록/수정/삭제. 남의 것은 열람만.
--     · GM        : 전 유저 아이템 CRUD.
--   → 아이템 단위(행마다 owner_id)로 저장해야 RLS 로 "본인 행만 수정" 을
--     서버에서 강제할 수 있다. 보드를 통째 JSON 으로 저장하면 소유권을 행
--     단위로 못 걸어 권한 강제가 불가하므로 아이템 단위로 설계한다.
--
--   아이템 게이팅(프론트가 판정, 서버는 방어적 재확인 가능) :
--     · 타이핑(text)      : 무제한, 아이템 불필요
--     · 드로잉(drawing)   : marker(사인펜) 보유 필요
--     · 스티커(sticker)   : sticker 아이템 보유 필요
--     · 폴라로이드(photo) : camera(사진기) 보유 필요 — 이 아이템은 여기서 신설
--
-- 이 마이그레이션이 하는 일 :
--   1) inventory_items.item_type CHECK 에 'camera' 추가 (동적 탐색 후 재생성).
--   2) daily_board_items 테이블 신설 + 인덱스.
--   3) RLS : 전체 SELECT / 본인 소유 CUD / GM 전체 CUD.
--   4) GM 전용 RPC : gm_delete_board_item, gm_update_board_item_content.
--      (일반 유저의 자기 아이템 CUD 는 RLS 로 직접 처리하므로 RPC 불필요.
--       GM 이 남의 것을 수정/삭제할 때만 SECURITY DEFINER RPC 로 처리.)
--   5) 사진기 shop 아이템 seed (item_type='camera'). 구매→인벤토리 지급은
--      purchase_shop_item 이 camera 를 sticker 와 동일 규칙(무제한·중복거부)
--      으로 처리하도록 확장.
--
-- 안정성 방침 :
--   · 전체 트랜잭션. 실패 시 롤백.
--   · RLS PERMISSIVE 정책은 OR 결합 → 유저 정책 + GM 정책 공존.
--   · content 는 jsonb. 구조 검증은 최소(프론트 책임). 서버는 kind 화이트리스트만.
--   · board_date 기본값은 KST 오늘. 과거/미래 날짜 지정도 허용(열람·GM 보정).
--
-- 롤백(수동) : 파일 하단 참조.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) inventory_items.item_type CHECK 확장 : 'camera' 추가
--    (기존 슬롯 마이그레이션과 동일한 동적 탐색 방식)
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
     AND rel.relname = 'inventory_items'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%item_type%'
   LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.inventory_items DROP CONSTRAINT %I', v_conname);
  END IF;

  ALTER TABLE public.inventory_items
    ADD CONSTRAINT inventory_items_item_type_check
    CHECK (item_type IN (
      'marker', 'sticker', 'wallpaper', 'other',
      'doll', 'coupon', 'junk',
      'camera'
    ));
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 2) daily_board_items 테이블
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_board_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_date  date        NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  owner_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  content     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT daily_board_items_kind_check
    CHECK (kind IN ('text', 'drawing', 'sticker', 'photo'))
);

-- 날짜별 보드 조회가 핵심 접근 경로.
CREATE INDEX IF NOT EXISTS daily_board_items_date_idx
  ON public.daily_board_items (board_date);
-- 본인 아이템 필터(수정/삭제 대상 찾기)용.
CREATE INDEX IF NOT EXISTS daily_board_items_owner_idx
  ON public.daily_board_items (owner_id);

-- updated_at 자동 갱신 트리거 (기존 프로젝트에 공용 트리거가 있으면 대체 가능)
CREATE OR REPLACE FUNCTION public._daily_board_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS daily_board_items_touch ON public.daily_board_items;
CREATE TRIGGER daily_board_items_touch
  BEFORE UPDATE ON public.daily_board_items
  FOR EACH ROW
  EXECUTE FUNCTION public._daily_board_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- 3) RLS
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.daily_board_items ENABLE ROW LEVEL SECURITY;

-- 3-1) 전체 열람 (공용 보드)
DROP POLICY IF EXISTS daily_board_items_select_all ON public.daily_board_items;
CREATE POLICY daily_board_items_select_all
  ON public.daily_board_items
  FOR SELECT
  USING (true);

-- 3-2) 본인 소유 INSERT
--   WITH CHECK : 넣으려는 행의 owner_id 가 "내 프로필" 이어야 함.
DROP POLICY IF EXISTS daily_board_items_insert_own ON public.daily_board_items;
CREATE POLICY daily_board_items_insert_own
  ON public.daily_board_items
  FOR INSERT
  WITH CHECK (
    owner_id IN (
      SELECT p.id FROM public.profiles p
       WHERE p.user_id = auth.uid()
    )
  );

-- 3-3) 본인 소유 UPDATE
DROP POLICY IF EXISTS daily_board_items_update_own ON public.daily_board_items;
CREATE POLICY daily_board_items_update_own
  ON public.daily_board_items
  FOR UPDATE
  USING (
    owner_id IN (
      SELECT p.id FROM public.profiles p
       WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    owner_id IN (
      SELECT p.id FROM public.profiles p
       WHERE p.user_id = auth.uid()
    )
  );

-- 3-4) 본인 소유 DELETE
DROP POLICY IF EXISTS daily_board_items_delete_own ON public.daily_board_items;
CREATE POLICY daily_board_items_delete_own
  ON public.daily_board_items
  FOR DELETE
  USING (
    owner_id IN (
      SELECT p.id FROM public.profiles p
       WHERE p.user_id = auth.uid()
    )
  );

-- 3-5) GM 전체 CUD (PERMISSIVE → 위 유저 정책과 OR 결합)
--   GM 은 owner 무관 전체 수정/삭제 가능. INSERT 는 GM 이 대리 등록할 일이
--   드물지만 정책상 허용(owner_id 를 지정해 남 대신 넣을 수 있게).
DROP POLICY IF EXISTS daily_board_items_gm_all ON public.daily_board_items;
CREATE POLICY daily_board_items_gm_all
  ON public.daily_board_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.is_gm = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.is_gm = true
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 4) GM 전용 RPC
--   유저의 자기 아이템 CUD 는 RLS 로 supabase 클라가 직접 처리한다.
--   GM 이 "남의" 아이템을 수정/삭제할 때, RLS gm_all 정책만으로도 클라
--   직접 UPDATE/DELETE 가 되지만, 명시적 GM 액션은 RPC 로 감싸 의도를
--   분명히 하고 에러 코드를 정규화한다. (프로젝트 기존 GM 액션 관례와 일치)
-- ────────────────────────────────────────────────────────────────────

-- 4-1) GM : 아이템 삭제
CREATE OR REPLACE FUNCTION public.gm_delete_board_item(
  p_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'invalid_item_id';
  END IF;

  DELETE FROM public.daily_board_items
   WHERE id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'board_item_not_found';
  END IF;
END;
$function$;

-- 4-2) GM : 아이템 content 수정 (위치/내용 보정)
CREATE OR REPLACE FUNCTION public.gm_update_board_item_content(
  p_item_id uuid,
  p_content jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'invalid_item_id';
  END IF;
  IF p_content IS NULL THEN
    RAISE EXCEPTION 'invalid_content';
  END IF;

  UPDATE public.daily_board_items
     SET content = p_content
   WHERE id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'board_item_not_found';
  END IF;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ⚠ 후속 마이그레이션 필수 : 2026-08-15_purchase_camera.sql
--   이 파일은 camera item_type 을 CHECK 에 허용만 했다. 실제 사진기
--   shop 아이템 seed + purchase_shop_item 의 camera 분기(구매→지급)는
--   후속 마이그레이션에서 처리한다(함수 재정의라 분리). 순서 : 이 파일 →
--   purchase_camera 파일.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- 롤백(수동) :
--   DROP FUNCTION IF EXISTS public.gm_update_board_item_content(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.gm_delete_board_item(uuid);
--   DROP TABLE IF EXISTS public.daily_board_items;      -- 트리거·정책 함께 제거
--   DROP FUNCTION IF EXISTS public._daily_board_touch_updated_at();
--   -- item_type CHECK 에서 'camera' 되돌리려면 위 1) 블록을 camera 없이 재실행.
-- ═══════════════════════════════════════════════════════════════════
