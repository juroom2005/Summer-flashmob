-- sql/pending/2026-08-20_profile_sprite_image.sql
-- ═══════════════════════════════════════════════════════════════════
-- 리듬게임 캐릭터 스프라이트 : profiles.sprite_url 추가 + GM 전용 설정/조회 RPC
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   리듬게임 캐릭터 스프라이트를 유저별로 지정한다. 두상(avatar_url)과 동일하게
--   유저 본인은 못 넣고 GM 이 유저관리 탭에서 넣어주는 정책이다. 따라서 본인
--   UPDATE(RLS)로는 처리 불가 → GM 전용 RPC(SECURITY DEFINER)로 남의 행 UPDATE.
--   이 마이그레이션은 2026-08-15_profile_avatar_image.sql(두상)을 그대로 복제해
--   컬럼·RPC 이름만 sprite 로 바꾼 것이다.
--
-- 저장 방식 :
--   두상과 동일. dataURL 을 text 컬럼(sprite_url)에 직접 저장한다. 별도 파일
--   스토리지(버킷) 없음. 프론트가 업로드 시 리사이즈해 과대 용량을 예방하고,
--   서버는 형식만 최소 방어(data:image/ 또는 http 로 시작).
--   ※ 스프라이트는 투명 PNG 라 프론트에서 JPEG 평탄화 없이 PNG dataURL 로 만든다.
--     (서버 CHECK 는 'data:image/%' 라 png/jpeg 무관하게 통과)
--
-- 이 마이그레이션이 하는 일 :
--   1) profiles 에 sprite_url(text, nullable) 컬럼 추가. 미설정 시 NULL.
--      · CHECK: NULL 이거나 'data:image/' 또는 'http' 로 시작.
--   2) gm_set_user_sprite(p_profile_id, p_sprite_url) RPC 신설.
--      · GM 가드 + SECURITY DEFINER 로 남의 행 UPDATE. NULL → 삭제.
--   3) gm_get_user_sprite(p_profile_id) RPC 신설.
--      · GM 관리 UI 단건 미리보기용.
--
-- 본인 조회 :
--   리듬게임(RhythmGame)은 세션 유저 본인의 스프라이트를 읽어 캐릭터로 쓴다.
--   이는 GM RPC 가 아니라 profiles_select_* RLS 로 본인 행을 직접 SELECT 하는
--   경로(getMyPanelProfile 과 동일)로 프론트에서 처리한다. 서버 추가 작업 없음.
--
-- 안정성 방침 :
--   · 전체 트랜잭션. 실패 시 롤백.
--   · SECURITY DEFINER + SET search_path='public' (기존 GM RPC 와 동일).
--   · 에러 코드 규약 재사용(invalid_profile_id/invalid_sprite_data/profile_not_found).
--   · sprite_url 은 nullable 이라 기존 행/코드에 영향 없음(추가만). 재실행 안전.
--
-- 롤백(수동) :
--   DROP FUNCTION IF EXISTS public.gm_set_user_sprite(uuid, text);
--   DROP FUNCTION IF EXISTS public.gm_get_user_sprite(uuid);
--   ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_sprite_url_format;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS sprite_url;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) profiles.sprite_url 컬럼 + 형식 CHECK
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sprite_url text;

-- 이미 있으면 중복 추가 방지. (재실행 안전)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'profiles_sprite_url_format'
       AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_sprite_url_format
      CHECK (
        sprite_url IS NULL
        OR sprite_url LIKE 'data:image/%'
        OR sprite_url LIKE 'http%'
      );
  END IF;
END$$;

-- ────────────────────────────────────────────────────────────────────
-- 2) gm_set_user_sprite : GM 이 대상 유저 스프라이트 설정/삭제
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_set_user_sprite(
  p_profile_id uuid,
  p_sprite_url text DEFAULT NULL
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
  IF p_sprite_url IS NOT NULL
     AND p_sprite_url NOT LIKE 'data:image/%'
     AND p_sprite_url NOT LIKE 'http%' THEN
    RAISE EXCEPTION 'invalid_sprite_data';
  END IF;

  SELECT true INTO v_exists
    FROM public.profiles
   WHERE id = p_profile_id
   FOR UPDATE;

  IF v_exists IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  UPDATE public.profiles
     SET sprite_url = p_sprite_url
   WHERE id = p_profile_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 3) gm_get_user_sprite : GM 관리 UI 단건 미리보기 조회
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gm_get_user_sprite(
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

  SELECT sprite_url INTO v_url
    FROM public.profiles
   WHERE id = p_profile_id;

  RETURN v_url;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 적용 후 확인 (참고, 수동 실행) :
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='profiles' AND column_name='sprite_url';
--   SELECT public.gm_get_user_sprite('<profile_uuid>');  -- GM 세션에서
-- ═══════════════════════════════════════════════════════════════════
