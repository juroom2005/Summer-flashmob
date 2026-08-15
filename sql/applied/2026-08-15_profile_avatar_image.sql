-- sql/pending/2026-08-15_profile_avatar_image.sql
-- ═══════════════════════════════════════════════════════════════════
-- 학생증 두상 이미지 : profiles.avatar_url 추가 + GM 전용 설정/조회 RPC
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   마이패널 학생증(components/noticeboard/panels/MyPanel.tsx)에는 이미 두상
--   이미지를 렌더하는 슬롯(displayProfile.avatarUrl)이 구현돼 있으나, 정작
--   profiles 에 이미지 컬럼이 없어 항상 placeholder("캐릭터 두상")만 떴다.
--   두상 이미지는 유저가 직접 못 넣고 GM 이 유저관리 탭에서 넣어주는 정책이라,
--   본인 UPDATE(RLS profiles_update_own)로는 처리할 수 없다. → GM 전용 RPC 필요.
--
-- 저장 방식 :
--   프로젝트에 Supabase Storage 셋업이 없고, 기존 서명(signature_data)이
--   dataURL 을 text 컬럼에 직접 저장하는 검증된 패턴을 쓰고 있다. 두상도 동일
--   하게 avatar_url(text) 에 dataURL 을 저장한다. (프론트가 업로드 시 리사이즈·
--   압축하여 과대 용량을 예방한다. 서버는 형식만 최소 방어.)
--
-- 이 마이그레이션이 하는 일 :
--   1) profiles 에 avatar_url(text, nullable) 컬럼 추가. 미설정 시 NULL.
--      · CHECK: NULL 이거나, 'data:image/' 로 시작하거나, 'http' 로 시작(외부
--        URL 도 미래에 허용) — 명백한 오염만 막는 느슨한 방어.
--   2) gm_set_user_avatar(p_profile_id, p_avatar_url) RPC 신설.
--      · GM 가드(assert_caller_is_gm) + SECURITY DEFINER 로 남의 행 UPDATE.
--      · p_avatar_url = NULL → 두상 삭제(placeholder 로 복귀).
--   3) gm_get_user_avatar(p_profile_id) RPC 신설.
--      · GM 관리 UI 가 "현재 두상"을 미리 보여주기 위한 단건 조회.
--      · gm_list_users 반환 TABLE 을 건드리지 않기 위해 별도 조회로 격리
--        (목록 RPC 시그니처 변경은 파급이 크고 위험하므로 회피).
--
-- 안정성 방침 :
--   · 전체 트랜잭션. 실패 시 롤백.
--   · SECURITY DEFINER + SET search_path='public' (기존 GM RPC 와 동일).
--   · 에러 코드는 기존 규약 재사용(auth_required/gm_only/profile_not_found).
--   · avatar_url 은 nullable 이라 기존 행/코드에 영향 없음(추가만).
--
-- 롤백(수동) :
--   DROP FUNCTION IF EXISTS public.gm_set_user_avatar(uuid, text);
--   DROP FUNCTION IF EXISTS public.gm_get_user_avatar(uuid);
--   ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_format;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_url;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) profiles.avatar_url 컬럼 + 형식 CHECK
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- 이미 있으면 중복 추가 방지. (재실행 안전)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'profiles_avatar_url_format'
       AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_avatar_url_format
      CHECK (
        avatar_url IS NULL
        OR avatar_url LIKE 'data:image/%'
        OR avatar_url LIKE 'http%'
      );
  END IF;
END$$;

-- ────────────────────────────────────────────────────────────────────
-- 2) gm_set_user_avatar : GM 이 대상 유저 두상 설정/삭제
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_set_user_avatar(
  p_profile_id uuid,
  p_avatar_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exists boolean;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_profile_id';
  END IF;

  -- 형식 최소 방어 (컬럼 CHECK 와 동일 기준). NULL 은 삭제로 허용.
  IF p_avatar_url IS NOT NULL
     AND p_avatar_url NOT LIKE 'data:image/%'
     AND p_avatar_url NOT LIKE 'http%' THEN
    RAISE EXCEPTION 'invalid_avatar_data';
  END IF;

  SELECT true INTO v_exists
    FROM public.profiles
   WHERE id = p_profile_id
   FOR UPDATE;

  IF v_exists IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  UPDATE public.profiles
     SET avatar_url = p_avatar_url
   WHERE id = p_profile_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 3) gm_get_user_avatar : GM 관리 UI 단건 미리보기 조회
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_get_user_avatar(
  p_profile_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_profile_id';
  END IF;

  SELECT avatar_url INTO v_url
    FROM public.profiles
   WHERE id = p_profile_id;

  -- 행이 없으면 v_url 은 NULL 로 남는다. 존재 확인이 필요하면 별도 처리하지만
  -- 여기서는 "두상 없음"과 "유저 없음"을 굳이 구분하지 않아도 무방(미리보기).
  RETURN v_url;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 적용 후 확인 (참고, 수동 실행) :
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='profiles' AND column_name='avatar_url';
--   SELECT public.gm_get_user_avatar('<profile_uuid>');  -- GM 세션에서
-- ═══════════════════════════════════════════════════════════════════
