-- ═══════════════════════════════════════════════════════════════════
-- 일일 일지 보상 : 하루 최초로 연습일지(daily_board_items)에 무엇이든
--                 하나 올리면 100 모빌 지급. KST 자정 초기화.
-- ───────────────────────────────────────────────────────────────────
-- 적용일 : 2026-08-17
--
-- 설계(기존 daily_login / 미니게임 보상 RPC 방침 그대로) :
--   · mobil_grants 에 grant_type='daily_journal' 로 지급 기록.
--   · (profile_id, grant_date) WHERE grant_type='daily_journal' UNIQUE
--     인덱스로 "하루 1회"를 DB 레벨에서 원천 보장(daily_login 과 동일 방식).
--     grant_date 기본값이 (now() AT TIME ZONE 'Asia/Seoul')::date 라
--     KST 자정 초기화가 자동으로 된다.
--   · 지급은 grant_daily_journal_reward() RPC 로 원자 처리
--     (mobil_grants insert 성공 시에만 profiles.mobil += 100).
--   · SECURITY DEFINER · search_path='public' · auth.uid() 인증(기존 방침).
--
-- 프론트 :
--   · 일지 항목 최초 추가(addBoardItem) 성공 후 이 RPC 를 호출.
--   · 이미 오늘 받았으면 granted=false 로 조용히 무시.
--
-- 되돌리기(rollback) 는 파일 하단 주석 참고.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) grant_type 에 'daily_journal' 허용 ────────────────────────────
-- 기존 CHECK: grant_type IN ('daily_login','gm_grant','system')
ALTER TABLE public.mobil_grants
  DROP CONSTRAINT IF EXISTS mobil_grants_grant_type_check;

ALTER TABLE public.mobil_grants
  ADD CONSTRAINT mobil_grants_grant_type_check
  CHECK (grant_type = ANY (ARRAY[
    'daily_login'::text,
    'daily_journal'::text,
    'gm_grant'::text,
    'system'::text
  ]));

-- ── 2) 하루 1회 UNIQUE 인덱스 (daily_login 과 동일 패턴) ──────────────
CREATE UNIQUE INDEX IF NOT EXISTS mobil_grants_daily_journal_unique_idx
  ON public.mobil_grants USING btree (profile_id, grant_date)
  WHERE (grant_type = 'daily_journal'::text);

-- ── 3) 지급 RPC ──────────────────────────────────────────────────────
-- 반환:
--   granted     boolean  -- 이번 호출로 지급됐는지(false=이미 오늘 받음)
--   amount      integer  -- 지급액(지급 안 됐으면 0)
--   next_mobil  integer  -- 지급 후 잔액(지급 안 됐으면 현재 잔액)
CREATE OR REPLACE FUNCTION public.grant_daily_journal_reward()
RETURNS TABLE (
  granted     boolean,
  amount      integer,
  next_mobil  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_id   uuid;
  v_profile   uuid;
  v_amount    integer := 100;   -- 일일 일지 보상액
  v_next      integer;
  v_today     date;
  v_exists    boolean;
BEGIN
  -- 인증 확인 (대시보드 직접 호출은 auth.uid()=null → auth_required 예외)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- 프로필 확인 (profiles.id = auth 유저)
  SELECT id INTO v_profile
    FROM public.profiles
   WHERE id = v_user_id;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- 오늘(KST) 날짜. mobil_grants.grant_date 기본값과 동일 계산.
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  -- 오늘 이미 일지 보상을 받았는지 확인.
  SELECT EXISTS (
    SELECT 1 FROM public.mobil_grants
     WHERE profile_id = v_profile
       AND grant_type = 'daily_journal'
       AND grant_date = v_today
  ) INTO v_exists;

  IF v_exists THEN
    -- 이미 받음 → 지급 없이 현재 잔액만 반환.
    SELECT mobil INTO v_next FROM public.profiles WHERE id = v_profile;
    granted    := false;
    amount     := 0;
    next_mobil := v_next;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 지급 기록 insert. grant_date 는 기본값(KST 오늘)이 채워진다.
  -- 동시요청 경합 시엔 UNIQUE 인덱스가 최종 방어 → 중복이면 예외로 롤백된다.
  INSERT INTO public.mobil_grants (profile_id, grant_type, amount, note)
  VALUES (v_profile, 'daily_journal', v_amount, '일일 일지 최초 작성 보상');

  -- 잔액 증가.
  UPDATE public.profiles
     SET mobil = mobil + v_amount
   WHERE id = v_profile
  RETURNING mobil INTO v_next;

  granted    := true;
  amount     := v_amount;
  next_mobil := v_next;
  RETURN NEXT;
END;
$$;

-- 실행 권한 (기존 RPC 방침: authenticated 롤에 EXECUTE)
GRANT EXECUTE ON FUNCTION public.grant_daily_journal_reward() TO authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 검증(선택) :
--   · 로그인 세션(프론트)에서 최초 호출 → granted=true, amount=100
--   · 같은 날 재호출 → granted=false, amount=0
--   · 대시보드 SQL Editor 직접 호출은 auth.uid()=null 이라
--     'auth_required' 예외가 정상(=조작 방지 동작 확인).
--
-- 되돌리기(rollback) :
--   DROP FUNCTION IF EXISTS public.grant_daily_journal_reward();
--   DROP INDEX  IF EXISTS public.mobil_grants_daily_journal_unique_idx;
--   -- grant_type CHECK 를 원복하려면(이미 daily_journal 데이터가 없을 때만):
--   ALTER TABLE public.mobil_grants DROP CONSTRAINT IF EXISTS mobil_grants_grant_type_check;
--   ALTER TABLE public.mobil_grants ADD CONSTRAINT mobil_grants_grant_type_check
--     CHECK (grant_type = ANY (ARRAY['daily_login'::text,'gm_grant'::text,'system'::text]));
-- ═══════════════════════════════════════════════════════════════════
