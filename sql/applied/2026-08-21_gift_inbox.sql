-- sql/pending/2026-08-21_gift_inbox.sql
-- ═══════════════════════════════════════════════════════════════════
-- 선물함(gift inbox) : 선물 내역 기록 + 받는 사람 알림 기반
-- ═══════════════════════════════════════════════════════════════════
--
-- 목적:
--   홈페이지 선물(모빌/아이템 양도)에 "받은 사람이 알 수 있는" 통로를 만든다.
--   현재 transfer_mobil / transfer_item 은 재화·아이템만 옮기고 아무 기록도
--   남기지 않아, 받는 사람이 "누가·무엇을·언제" 줬는지 알 방법이 없다.
--   → 선물 1건당 1행을 남기는 gift_transfers 테이블과, 이동+기록을 한
--     트랜잭션으로 처리하는 래퍼 RPC를 추가한다.
--
-- ★ 중요 — 기존 자산 무변경 ★
--   · transfer_mobil / transfer_item : 그대로 둔다(봇도 사용).
--   · _transfer_mobil_core / _transfer_item_core : 그대로 둔다.
--   · bot_transfer_* : 그대로 둔다.
--   이 마이그레이션은 새 테이블 1개 + 새 함수 5개를 "추가"만 한다.
--   기존 RPC를 CREATE OR REPLACE 로 덮어쓰지 않는다. 되돌아가는 사고 없음.
--
-- 원자성:
--   래퍼(send_gift_*)는 내부에서 기존 코어(_transfer_*_core)를 그대로 호출한다.
--   코어가 예외(잔액부족·자기이체·양도불가 등)를 던지면 함수 전체가 롤백되어
--   gift_transfers INSERT 도 함께 취소된다. 즉 "이동 성공 = 기록 존재"가 보장된다.
--
-- 프론트 연동:
--   · 보내기 : send_gift_mobil / send_gift_item (기존 transfer_* 대신 이걸 호출)
--   · 조회   : list_my_gifts(받은 선물), count_unread_gifts(안읽은 개수)
--   · 읽음   : mark_gifts_read (선물함 열람 시)
--
-- 안전성:
--   · 새 테이블 RLS: 본인이 보낸/받은 행만 SELECT. INSERT/UPDATE 는
--     SECURITY DEFINER RPC 로만(직접 쓰기 불가).
--   · pending 에 둔다. 검증 후 applied 로 이동.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- 1) 테이블
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gift_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 보낸/받는 사람 (profiles.id)
  from_profile  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_profile    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 선물 종류
  kind          text NOT NULL CHECK (kind IN ('mobil', 'item')),
  -- 공통 수량 (모빌=금액, 아이템=개수)
  amount        integer NOT NULL CHECK (amount >= 1),
  -- 아이템일 때만 채워지는 스냅샷 (kind='mobil' 이면 NULL)
  item_type     text,
  item_ref      text,
  item_name     text,        -- 표시용 이름 스냅샷(양도 당시). 없으면 NULL.
  -- 읽음 처리 (받는 사람이 선물함을 확인한 시각). NULL = 안 읽음.
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- kind 별 필드 정합성: item 이면 item_type/item_ref 필수, mobil 이면 NULL.
  CONSTRAINT gift_transfers_kind_fields CHECK (
    (kind = 'mobil' AND item_type IS NULL AND item_ref IS NULL)
    OR
    (kind = 'item'  AND item_type IS NOT NULL AND item_ref IS NOT NULL)
  )
);

-- 받은 선물 조회(받는 사람 + 최신순), 안읽음 카운트에 사용.
CREATE INDEX IF NOT EXISTS gift_transfers_to_created_idx
  ON public.gift_transfers (to_profile, created_at DESC);

-- 안읽음만 빠르게(부분 인덱스).
CREATE INDEX IF NOT EXISTS gift_transfers_to_unread_idx
  ON public.gift_transfers (to_profile)
  WHERE read_at IS NULL;

-- 보낸 내역 조회(선택).
CREATE INDEX IF NOT EXISTS gift_transfers_from_created_idx
  ON public.gift_transfers (from_profile, created_at DESC);


-- ───────────────────────────────────────────────────────────────────
-- 2) RLS
--    · SELECT : 본인이 보냈거나 받은 행만.
--    · INSERT/UPDATE/DELETE : 정책 없음 → 직접 쓰기 불가.
--      기록/읽음처리는 SECURITY DEFINER RPC 로만 수행한다.
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.gift_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gift_transfers_select_own ON public.gift_transfers;
CREATE POLICY gift_transfers_select_own
  ON public.gift_transfers
  FOR SELECT
  USING (
    from_profile IN (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid())
    OR
    to_profile   IN (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid())
  );


-- ───────────────────────────────────────────────────────────────────
-- 3) 래퍼 RPC : 이동 + 기록 (한 트랜잭션)
-- ───────────────────────────────────────────────────────────────────

-- 3-a) 모빌 선물
CREATE OR REPLACE FUNCTION public.send_gift_mobil(
  p_to_profile_id uuid,
  p_amount        integer
)
RETURNS integer                       -- 조정 후 내 잔액(기존 transfer_mobil 과 동일)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_from    uuid;
  v_next    integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  SELECT id INTO v_from FROM public.profiles WHERE user_id = v_user_id;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'sender_not_found';
  END IF;

  -- 실제 이동은 기존 코어 그대로 사용(검증·잠금·잔액처리 전부 코어가 담당).
  v_next := public._transfer_mobil_core(v_from, p_to_profile_id, p_amount);

  -- 이동이 성공했을 때만 여기 도달. 기록 남긴다.
  INSERT INTO public.gift_transfers
    (from_profile, to_profile, kind, amount)
  VALUES
    (v_from, p_to_profile_id, 'mobil', p_amount);

  RETURN v_next;
END;
$function$;

-- 3-b) 아이템 선물
CREATE OR REPLACE FUNCTION public.send_gift_item(
  p_to_profile_id uuid,
  p_item_type     text,
  p_item_ref      text,
  p_qty           integer,
  p_item_name     text DEFAULT NULL   -- 프론트가 표시용 이름 스냅샷 전달(선택)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_from    uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  SELECT id INTO v_from FROM public.profiles WHERE user_id = v_user_id;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'sender_not_found';
  END IF;

  -- 실제 이동(양도불가 타입 거부·보유검사·스택병합 전부 코어가 담당).
  PERFORM public._transfer_item_core(v_from, p_to_profile_id, p_item_type, p_item_ref, p_qty);

  -- 성공 시에만 기록.
  INSERT INTO public.gift_transfers
    (from_profile, to_profile, kind, amount, item_type, item_ref, item_name)
  VALUES
    (v_from, p_to_profile_id, 'item', p_qty, p_item_type, p_item_ref,
     NULLIF(trim(COALESCE(p_item_name, '')), ''));
END;
$function$;


-- ───────────────────────────────────────────────────────────────────
-- 4) 조회 RPC
-- ───────────────────────────────────────────────────────────────────

-- 4-a) 받은 선물 목록 (최신순). 보낸 사람 표시명 포함.
CREATE OR REPLACE FUNCTION public.list_my_gifts(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id            uuid,
  from_profile  uuid,
  from_name     text,
  kind          text,
  amount        integer,
  item_type     text,
  item_ref      text,
  item_name     text,
  read_at       timestamptz,
  created_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid;
BEGIN
  SELECT p.id INTO v_me FROM public.profiles p WHERE p.user_id = auth.uid();
  IF v_me IS NULL THEN
    RETURN;  -- 로그인 안 됐거나 프로필 없음 → 빈 결과.
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.from_profile,
    NULLIF(trim(COALESCE(fp.family_name, '') || COALESCE(fp.given_name, '')), '') AS from_name,
    g.kind,
    g.amount,
    g.item_type,
    g.item_ref,
    g.item_name,
    g.read_at,
    g.created_at
  FROM public.gift_transfers g
  LEFT JOIN public.profiles fp ON fp.id = g.from_profile
  WHERE g.to_profile = v_me
  ORDER BY g.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$function$;

-- 4-b) 안 읽은 선물 개수 (배지용).
CREATE OR REPLACE FUNCTION public.count_unread_gifts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me    uuid;
  v_count integer;
BEGIN
  SELECT p.id INTO v_me FROM public.profiles p WHERE p.user_id = auth.uid();
  IF v_me IS NULL THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gift_transfers
  WHERE to_profile = v_me AND read_at IS NULL;

  RETURN COALESCE(v_count, 0);
END;
$function$;

-- 4-c) 읽음 처리 (선물함 열람 시 전체 읽음). 처리된 행 수 반환.
CREATE OR REPLACE FUNCTION public.mark_gifts_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me    uuid;
  v_count integer;
BEGIN
  SELECT p.id INTO v_me FROM public.profiles p WHERE p.user_id = auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  WITH upd AS (
    UPDATE public.gift_transfers
       SET read_at = now()
     WHERE to_profile = v_me AND read_at IS NULL
     RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN COALESCE(v_count, 0);
END;
$function$;


-- ───────────────────────────────────────────────────────────────────
-- 5) 권한
-- ───────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.send_gift_mobil(uuid, integer)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_gift_item(uuid, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_gifts(integer)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_unread_gifts()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_gifts_read()                           TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 롤백 (필요 시 수동):
--   DROP FUNCTION IF EXISTS public.mark_gifts_read();
--   DROP FUNCTION IF EXISTS public.count_unread_gifts();
--   DROP FUNCTION IF EXISTS public.list_my_gifts(integer);
--   DROP FUNCTION IF EXISTS public.send_gift_item(uuid, text, text, integer, text);
--   DROP FUNCTION IF EXISTS public.send_gift_mobil(uuid, integer);
--   DROP TABLE IF EXISTS public.gift_transfers;
--   (기존 transfer_* / _transfer_*_core 는 이 마이그레이션이 건드리지 않았으므로
--    롤백해도 기존 선물 이동 기능은 그대로 동작한다.)
-- ═══════════════════════════════════════════════════════════════════
