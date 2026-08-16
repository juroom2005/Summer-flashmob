-- sql/pending/2026-08-16_member_theme_color.sql
-- ═══════════════════════════════════════════════════════════════════
-- member_profiles.theme_color 추가 + GM RPC(create/update) 반영
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경
--   네임태그(멤버 프로필 카드)의 테마색을 캐릭터별로 지정한다.
--   · GM 이 프로필 생성/수정 시 색 지정.
--   · 본인도 프로필 편집으로 색 변경 가능(기존 updateMyMemberProfile 경로).
--   · 색은 hex 코드(#RGB 또는 #RRGGBB). 네임태그 SVG 의 테마색(.st1)에 주입.
--
-- 변경
--   1) member_profiles 에 theme_color(text, nullable) 추가 + 형식 CHECK.
--      · NULL 허용(미지정 시 프론트 기본색 사용).
--   2) gm_create_member_profile / gm_update_member_profile 재정의
--      (theme_color 반영). RETURNS 는 member_profiles 전체 행이라 컬럼 추가는
--      자동 반영되지만, INSERT/UPDATE 목록에 theme_color 를 넣어야 값이 저장됨.
--
-- 안정성
--   · ALTER ADD COLUMN IF NOT EXISTS → 기존 행/코드에 영향 없음(추가만).
--   · CREATE OR REPLACE FUNCTION → 시그니처 동일(uuid, jsonb)이라 교체 안전.
--   · BEGIN/COMMIT 트랜잭션.
--
-- 롤백
--   (RPC 는 이전 정의로 되돌리려면 원본 마이그레이션 재실행)
--   ALTER TABLE public.member_profiles DROP CONSTRAINT IF EXISTS member_profiles_theme_color_format;
--   ALTER TABLE public.member_profiles DROP COLUMN IF EXISTS theme_color;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1) 컬럼 + 형식 CHECK (#RGB 또는 #RRGGBB, 대소문자 hex)
ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS theme_color text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_profiles_theme_color_format'
  ) THEN
    ALTER TABLE public.member_profiles
      ADD CONSTRAINT member_profiles_theme_color_format
      CHECK (
        theme_color IS NULL
        OR theme_color ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'
      );
  END IF;
END $$;


-- 2-1) gm_create_member_profile 재정의 (theme_color 포함)
CREATE OR REPLACE FUNCTION public.gm_create_member_profile(
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
    rhythm, stamina, performance, personality, etc, photo_url, theme_color
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
    NULLIF(p_data->>'photo_url', ''),
    NULLIF(p_data->>'theme_color', '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


-- 2-2) gm_update_member_profile 재정의 (theme_color 포함, 3-상태)
CREATE OR REPLACE FUNCTION public.gm_update_member_profile(
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
         photo_url     = CASE
                           WHEN p_data ? 'photo_url'
                             THEN NULLIF(p_data->>'photo_url', '')
                           ELSE m.photo_url
                         END,
         theme_color   = CASE
                           WHEN p_data ? 'theme_color'
                             THEN NULLIF(p_data->>'theme_color', '')
                           ELSE m.theme_color
                         END
   WHERE m.id = p_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_profile_not_found';
  END IF;

  RETURN v_row;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 검증
-- ═══════════════════════════════════════════════════════════════════
-- (1) 컬럼 확인
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='member_profiles' AND column_name='theme_color';
-- (2) 형식 CHECK: 잘못된 값은 거부돼야 함(GM 계정 통해 테스트)
--   유효: '#f00', '#3f88f9'  /  무효: 'red', '3f88f9', '#12'
-- ═══════════════════════════════════════════════════════════════════
