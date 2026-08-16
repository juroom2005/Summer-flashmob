-- sql/pending/2026-08-16_member_profiles.sql
-- ═══════════════════════════════════════════════════════════════════
-- MEMBER 게시판 : member_profiles 테이블 + RLS + GM CRUD RPC
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 : flashmob_ui_renewal_2026-08-16.md §6 (설계 확정, 미구현)
--   · GM 이 각 유저의 프로필을 대신 작성/수정/삭제한다.
--   · GM 이 owner 를 특정 유저(예: 키사라기 모브)로 찍어 생성하면,
--     그 유저 로그인 시 본인 owner_id 행이라 RLS 로 직접 수정 가능해진다.
--     ("GM 이 올린 걸 해당 유저가 수정" 의 핵심 고리)
--   · 다른 유저는 타인 프로필을 열람만 가능(수정 불가).
--
-- 설계 결정 근거 (기존 코드 실측)
--   · owner_id 는 profiles(id) 를 참조한다.
--     daily_board_items 가 이미 owner_id uuid REFERENCES profiles(id) 관례를
--     쓰므로 동일하게 맞춘다. auth 와의 연결은 RLS 서브쿼리로 다리를 놓는다:
--       owner_id IN (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
--   · photo_url 은 dataURL 을 text 컬럼에 저장(형식 CHECK).
--     profiles.avatar_url 선례(2026-08-15_profile_avatar_image.sql)와 동일.
--   · GM RPC 는 assert_caller_is_gm() + SECURITY DEFINER + search_path 관례.
--
-- 유저-GM 권한 분리 요약
--   · SELECT  : 전체 공개(게시판)
--   · UPDATE  : 유저는 본인 owner_id 행만
--   · INSERT  : 유저 직접 INSERT 정책 없음. 생성은 GM RPC 로만.
--   · DELETE  : 유저 직접 DELETE 정책 없음. 삭제는 GM RPC 로만.
--   · GM      : RPC(SECURITY DEFINER)로 전체 CRUD. (RLS 우회)
--
-- 안정성 방침
--   · 전체 트랜잭션(BEGIN/COMMIT)으로 감싸 실패 시 롤백.
--   · IF NOT EXISTS / DROP POLICY IF EXISTS 로 재실행 안전(idempotent).
--   · 한 유저당 프로필 1행 원칙 → owner_id UNIQUE.
--
-- 롤백 (필요 시)
--   DROP FUNCTION IF EXISTS public.gm_create_member_profile(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.gm_update_member_profile(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.gm_delete_member_profile(uuid);
--   DROP TABLE    IF EXISTS public.member_profiles;   -- 데이터도 삭제됨. 주의.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) member_profiles 테이블
--    프론트 MemberProfile 타입(components/noticeboard/panels/MemberPanel.tsx)
--    필드와 1:1. 모든 텍스트 필드는 미입력 허용(기본 빈 문자열).
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_profiles (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  name           text        NOT NULL DEFAULT '',
  date_of_birth  text        NOT NULL DEFAULT '',
  age            text        NOT NULL DEFAULT '',
  grade          text        NOT NULL DEFAULT '',
  height         text        NOT NULL DEFAULT '',
  rhythm         text        NOT NULL DEFAULT '',
  stamina        text        NOT NULL DEFAULT '',
  performance    text        NOT NULL DEFAULT '',
  personality    text        NOT NULL DEFAULT '',
  etc            text        NOT NULL DEFAULT '',
  photo_url      text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- 한 유저당 프로필 1행.
  CONSTRAINT member_profiles_owner_unique UNIQUE (owner_id),

  -- photo_url : NULL 이거나, dataURL, 또는 외부 http(s) URL 만 허용.
  --   (profiles.avatar_url 형식 CHECK 와 동일 규칙)
  CONSTRAINT member_profiles_photo_url_format CHECK (
    photo_url IS NULL
    OR photo_url LIKE 'data:image/%'
    OR photo_url LIKE 'http://%'
    OR photo_url LIKE 'https://%'
  )
);

-- 본인 프로필 행 조회(수정 대상 찾기)·게시판 정렬용.
CREATE INDEX IF NOT EXISTS member_profiles_owner_idx
  ON public.member_profiles (owner_id);

-- updated_at 자동 갱신 트리거 (daily_board 와 동일 패턴, 테이블 전용 함수).
CREATE OR REPLACE FUNCTION public._member_profiles_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS member_profiles_touch ON public.member_profiles;
CREATE TRIGGER member_profiles_touch
  BEFORE UPDATE ON public.member_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public._member_profiles_touch_updated_at();


-- ────────────────────────────────────────────────────────────────────
-- 2) RLS
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

-- 2-1) 전체 열람 (공용 게시판) — 로그인 여부 무관 SELECT 허용.
DROP POLICY IF EXISTS member_profiles_select_all ON public.member_profiles;
CREATE POLICY member_profiles_select_all
  ON public.member_profiles
  FOR SELECT
  USING (true);

-- 2-2) 유저 : 본인 owner_id 행만 UPDATE.
--   USING       : 대상 행이 내 프로필인지 (수정 전 조건)
--   WITH CHECK  : 수정 후에도 owner_id 가 여전히 내 프로필인지 (owner 바꿔치기 방지)
DROP POLICY IF EXISTS member_profiles_update_own ON public.member_profiles;
CREATE POLICY member_profiles_update_own
  ON public.member_profiles
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

--   ※ 유저용 INSERT / DELETE 정책은 두지 않는다.
--     생성·삭제는 GM RPC(SECURITY DEFINER)로만 수행 → RLS 를 우회하므로
--     아래 GM 정책이나 별도 유저 정책 없이도 RPC 내부에서 동작한다.

-- 2-3) GM : owner 무관 전체 CRUD (RLS 레벨 허용).
--   RPC 는 SECURITY DEFINER 라 RLS 를 우회하지만, 혹시 GM 이 일반 클라이언트
--   경로로 직접 접근할 경우까지 대비해 정책으로도 열어 둔다(이중).
DROP POLICY IF EXISTS member_profiles_gm_all ON public.member_profiles;
CREATE POLICY member_profiles_gm_all
  ON public.member_profiles
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
-- 3) GM RPC : 생성 / 수정 / 삭제
--    필드가 많아 개별 파라미터 대신 jsonb 하나로 받는다(daily_board content
--    관례와 동일). 화이트리스트 키만 반영해 예상 밖 컬럼 주입을 막는다.
-- ────────────────────────────────────────────────────────────────────

-- 3-0) 공용 : jsonb → member_profiles 필드 적용 헬퍼는 두지 않고,
--      각 RPC 안에서 COALESCE(p_data->>'key', 기존값) 형태로 처리한다.
--      (별도 헬퍼 함수 추가 없이 명시적으로 두어 추적성 우선)

-- 3-1) GM : 프로필 생성
--   p_owner_id : 이 프로필의 주인이 될 유저의 profiles.id
--   p_data     : 프로필 필드 jsonb (없는 키는 기본 빈 문자열/NULL)
--   반환       : 생성된 프로필 행
DROP FUNCTION IF EXISTS public.gm_create_member_profile(uuid, jsonb);
CREATE FUNCTION public.gm_create_member_profile(
  p_owner_id uuid,
  p_data     jsonb DEFAULT '{}'::jsonb
)
RETURNS public.member_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.member_profiles;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'invalid_owner_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_owner_id) THEN
    RAISE EXCEPTION 'owner_profile_not_found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.member_profiles WHERE owner_id = p_owner_id) THEN
    RAISE EXCEPTION 'member_profile_already_exists';
  END IF;

  INSERT INTO public.member_profiles (
    owner_id, name, date_of_birth, age, grade, height,
    rhythm, stamina, performance, personality, etc, photo_url
  )
  VALUES (
    p_owner_id,
    COALESCE(p_data->>'name',          ''),
    COALESCE(p_data->>'date_of_birth', ''),
    COALESCE(p_data->>'age',           ''),
    COALESCE(p_data->>'grade',         ''),
    COALESCE(p_data->>'height',        ''),
    COALESCE(p_data->>'rhythm',        ''),
    COALESCE(p_data->>'stamina',       ''),
    COALESCE(p_data->>'performance',   ''),
    COALESCE(p_data->>'personality',   ''),
    COALESCE(p_data->>'etc',           ''),
    NULLIF(p_data->>'photo_url', '')   -- 빈 문자열은 NULL 로(형식 CHECK 통과)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- 3-2) GM : 프로필 수정
--   p_id   : member_profiles.id
--   p_data : 바꿀 필드만 담은 jsonb. 키가 없으면 기존값 유지.
--            photo_url 키를 명시적으로 null 로 보내면 사진 삭제.
--   반환   : 수정된 프로필 행
DROP FUNCTION IF EXISTS public.gm_update_member_profile(uuid, jsonb);
CREATE FUNCTION public.gm_update_member_profile(
  p_id   uuid,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS public.member_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.member_profiles;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invalid_profile_id';
  END IF;

  UPDATE public.member_profiles m
     SET name          = COALESCE(p_data->>'name',          m.name),
         date_of_birth = COALESCE(p_data->>'date_of_birth', m.date_of_birth),
         age           = COALESCE(p_data->>'age',           m.age),
         grade         = COALESCE(p_data->>'grade',         m.grade),
         height        = COALESCE(p_data->>'height',        m.height),
         rhythm        = COALESCE(p_data->>'rhythm',        m.rhythm),
         stamina       = COALESCE(p_data->>'stamina',       m.stamina),
         performance   = COALESCE(p_data->>'performance',   m.performance),
         personality   = COALESCE(p_data->>'personality',   m.personality),
         etc           = COALESCE(p_data->>'etc',           m.etc),
         -- photo_url : 키 자체가 없으면 유지, 있으면 그 값(빈 문자열→NULL).
         photo_url     = CASE
                           WHEN p_data ? 'photo_url'
                             THEN NULLIF(p_data->>'photo_url', '')
                           ELSE m.photo_url
                         END
   WHERE m.id = p_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_profile_not_found';
  END IF;

  RETURN v_row;
END;
$function$;

-- 3-3) GM : 프로필 삭제
DROP FUNCTION IF EXISTS public.gm_delete_member_profile(uuid);
CREATE FUNCTION public.gm_delete_member_profile(
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invalid_profile_id';
  END IF;

  DELETE FROM public.member_profiles
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_profile_not_found';
  END IF;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 검증
-- ═══════════════════════════════════════════════════════════════════
--
-- (1) 테이블·정책 확인
--   SELECT tablename, policyname, cmd
--     FROM pg_policies
--    WHERE tablename = 'member_profiles'
--    ORDER BY policyname;
--
-- (2) RPC 시그니처 확인
--   SELECT p.proname, pg_get_function_arguments(p.oid) AS args,
--          pg_get_function_result(p.oid) AS returns
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('gm_create_member_profile',
--                        'gm_update_member_profile',
--                        'gm_delete_member_profile')
--    ORDER BY p.proname;
--
-- (3) 대시보드 SQL Editor 는 supabase_admin 세션이라 auth.uid() 가 NULL →
--     assert_caller_is_gm() 이 실패한다. RPC 실제 동작 검증은 GM 계정으로
--     프론트를 통해 수행할 것. (기존 GM RPC 파일들과 동일한 주의)
-- ═══════════════════════════════════════════════════════════════════
