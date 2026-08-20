-- ═══════════════════════════════════════════════════════════════════
-- member_profiles.sprite_url 추가 + GM RPC(create/update) 반영
-- (2026-08-20)
-- ═══════════════════════════════════════════════════════════════════
--
-- 목적:
--   리듬게임 캐릭터 스프라이트를 유저별로 저장한다.
--   두상(photo_url)과 동일하게 dataURL(투명 PNG) 또는 외부 http(s) URL 을
--   text 컬럼에 그대로 담는다. 별도 파일 스토리지(버킷) 없음.
--
-- 이 마이그레이션이 하는 일:
--   1) member_profiles 에 sprite_url(text, nullable) 추가 + 형식 CHECK.
--   2) gm_create_member_profile / gm_update_member_profile 재정의
--      (sprite_url 반영). RETURNS 는 member_profiles 전체 행이라 컬럼 추가는
--      자동 반영되지만, INSERT/UPDATE 목록에 sprite_url 을 넣어야 값이 저장됨.
--
-- 전제:
--   · 2026-08-16_member_nametag_fields.sql(theme_color + tag_last/first 포함)
--     이 이미 적용된 상태에서 실행한다. 아래 RPC 는 그 최신 본문에
--     sprite_url 한 줄만 얹은 것이다.
--
-- 안전성:
--   · ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION → 재실행 안전.
--   · sprite_url 은 NULL 허용(미등록 = 리듬게임 기본 이미지 폴백).
--   · 기존 photo_url 배선을 그대로 복제 → 새 실패 지점 없음.
--
-- 실행: Supabase 대시보드 SQL Editor 에서 이 파일 전체 실행.
--       실행 후 sql/pending → sql/applied 로 이동 권장.
--
-- 롤백(필요 시):
--   ALTER TABLE public.member_profiles DROP CONSTRAINT IF EXISTS member_profiles_sprite_url_format;
--   ALTER TABLE public.member_profiles DROP COLUMN IF EXISTS sprite_url;
--   그리고 두 RPC 를 2026-08-16_member_nametag_fields.sql 버전으로 되돌린다.
-- ═══════════════════════════════════════════════════════════════════

-- 1) 컬럼 추가 --------------------------------------------------------
ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS sprite_url text;

-- 2) 형식 CHECK (photo_url 규칙과 동일: NULL / dataURL / http(s)) ------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_profiles_sprite_url_format'
  ) THEN
    ALTER TABLE public.member_profiles
      ADD CONSTRAINT member_profiles_sprite_url_format CHECK (
        sprite_url IS NULL
        OR sprite_url LIKE 'data:image/%'
        OR sprite_url LIKE 'http://%'
        OR sprite_url LIKE 'https://%'
      );
  END IF;
END $$;

-- 3) gm_create_member_profile 재정의 (sprite_url 포함) ----------------
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
    rhythm, stamina, performance, personality, etc, photo_url, theme_color,
    tag_last, tag_first, sprite_url
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
    NULLIF(p_data->>'theme_color', ''),
    COALESCE(p_data->>'tag_last',      ''),
    COALESCE(p_data->>'tag_first',     ''),
    NULLIF(p_data->>'sprite_url', '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


-- 4) gm_update_member_profile 재정의 (sprite_url 포함, 3-상태) --------
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
                         END,
         tag_last      = COALESCE(p_data->>'tag_last',  m.tag_last),
         tag_first     = COALESCE(p_data->>'tag_first', m.tag_first),
         sprite_url    = CASE
                           WHEN p_data ? 'sprite_url'
                             THEN NULLIF(p_data->>'sprite_url', '')
                           ELSE m.sprite_url
                         END
   WHERE m.id = p_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_profile_not_found';
  END IF;

  RETURN v_row;
END;
$function$;

-- 확인 --------------------------------------------------------------
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='member_profiles' AND column_name='sprite_url';
