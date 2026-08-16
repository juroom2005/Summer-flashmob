-- sql/pending/2026-08-16_member_nametag_fields.sql
-- ═══════════════════════════════════════════════════════════════════
-- member_profiles 에 네임태그용 tag_last / tag_first 추가 + GM RPC 반영
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경
--   네임태그(시안)는 상단 띠=성(영문 대문자, Impact), 가운데=이름(영문, 손글씨).
--   시스템에 영문명 필드가 없어 name(한글)로는 못 만든다 → 전용 필드로 직접 입력.
--     · tag_last  : 상단 띠 성(영문). 예 'CHISE'
--     · tag_first : 가운데 이름(영문). 예 'HARUYUKI'
--   둘 다 비어도 됨(빈 문자열). 네임태그는 있는 값만 표시.
--
-- 변경
--   1) member_profiles 에 tag_last / tag_first (text NOT NULL DEFAULT '') 추가.
--   2) gm_create / gm_update_member_profile 재정의(두 필드 반영).
--      · create: COALESCE(payload, '')
--      · update: COALESCE(payload, 기존값)  (미변경 시 유지)
--
-- 안정성
--   · ADD COLUMN IF NOT EXISTS + DEFAULT '' → 기존 행 자동 채움, 코드 영향 없음.
--   · CREATE OR REPLACE FUNCTION 시그니처 동일 → 교체 안전.
--   · 이 마이그레이션은 theme_color 마이그레이션 이후 실행 가정
--     (RPC 본문에 theme_color 도 포함해 최신 상태로 재정의).
--
-- 롤백
--   ALTER TABLE public.member_profiles DROP COLUMN IF EXISTS tag_last;
--   ALTER TABLE public.member_profiles DROP COLUMN IF EXISTS tag_first;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1) 컬럼 추가
ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS tag_last  text NOT NULL DEFAULT '';
ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS tag_first text NOT NULL DEFAULT '';


-- 2-1) gm_create_member_profile (theme_color + tag_last/first 포함)
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
    tag_last, tag_first
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
    COALESCE(p_data->>'tag_first',     '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


-- 2-2) gm_update_member_profile (theme_color + tag_last/first 포함)
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
         tag_first     = COALESCE(p_data->>'tag_first', m.tag_first)
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
--    WHERE table_name='member_profiles' AND column_name IN ('tag_last','tag_first');
-- (2) GM 계정으로 프로필 생성/수정 시 tag_last/tag_first 저장 확인.
-- ═══════════════════════════════════════════════════════════════════
