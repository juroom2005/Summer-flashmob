-- sql/pending/2026-08-20_member_quote.sql
-- ═══════════════════════════════════════════════════════════════════
-- 멤버 한마디(quote) : member_profiles.quote 추가 + GM RPC(create/update) 반영
-- ═══════════════════════════════════════════════════════════════════
--
-- 목적:
--   멤버 상세 카드(MemberPanel 읽기뷰)의 MEMBER 타이틀 아래에 캐릭터의
--   "한마디"를 인용구처럼 표시한다. 큰따옴표(색상 = 네임태그 테마색 동기화)
--   오른쪽에 한마디 텍스트. 비어 있으면 그 영역 자체가 렌더되지 않는다.
--
-- 저장:
--   member_profiles.quote (text NOT NULL DEFAULT '').
--   personality/etc 와 동일한 "빈 문자열 = 없음" 패턴. 빈 문자열이면 프론트가
--   한마디 영역을 렌더하지 않는다(조건부).
--
-- 이 마이그레이션이 하는 일:
--   1) member_profiles 에 quote(text NOT NULL DEFAULT '') 추가.
--   2) gm_create_member_profile / gm_update_member_profile 재정의(quote 반영).
--      최신 정본(2026-08-16_member_nametag_fields.sql, theme_color + tag 포함)에
--      quote 한 줄만 얹은 것이다.
--
-- 전제:
--   · 2026-08-16_member_nametag_fields.sql 이 이미 적용된 상태에서 실행.
--
-- 안전성:
--   · ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION → 재실행 안전.
--   · NOT NULL DEFAULT '' 라 기존 행은 자동으로 '' 로 채워짐(한마디 없음). 무해.
--
-- 롤백(수동):
--   ALTER TABLE public.member_profiles DROP COLUMN IF EXISTS quote;
--   두 RPC 를 2026-08-16_member_nametag_fields.sql 버전으로 되돌린다.
-- ═══════════════════════════════════════════════════════════════════

-- 1) 컬럼 추가 --------------------------------------------------------
ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS quote text NOT NULL DEFAULT '';

-- 2) gm_create_member_profile 재정의 (quote 포함) ---------------------
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
    tag_last, tag_first, quote
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
    COALESCE(p_data->>'quote',         '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


-- 3) gm_update_member_profile 재정의 (quote 포함) --------------------
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
         quote         = COALESCE(p_data->>'quote',     m.quote)
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
--  WHERE table_name='member_profiles' AND column_name='quote';
