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
    NULLIF(trim(
      concat_ws(' ',
        NULLIF(trim(COALESCE(fp.family_name, '')), ''),
        NULLIF(trim(COALESCE(fp.given_name, '')), '')
      )
    ), '') AS from_name,
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

