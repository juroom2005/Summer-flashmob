-- sql/pending/2026-08-27_session_chat.sql
-- ═══════════════════════════════════════════════════════════════════
-- 세션 채팅 : GM 스크립트(마크다운) + 방별 실시간 채팅 + 주사위
-- ═══════════════════════════════════════════════════════════════════
--
-- 목적:
--   GM 이 방을 만들고 참가 유저를 지정하면, GM 과 그 유저들만 들어갈 수 있는
--   실시간 채팅방이 생긴다. 한 방 안에는
--     · 스크립트 스트림(GM 이 마크다운으로 적는 진행문, 큰 화면)
--     · 채팅 스트림(유저·GM 대화, 오른쪽)
--     · 주사위(1d100 / 성공·실패 50:50, 서버 난수)
--   가 있다. 두 스트림은 같은 테이블(session_messages)에 kind 로 구분해 저장.
--
-- ★ 중요 — 기존 자산 무변경 ★
--   · KEYHOLE 잔재 테이블(chat_rooms / chat_room_members / chat_messages)은
--     손대지 않는다. 이름이 겹치지 않도록 전부 session_ 접두어를 쓴다.
--   · gm_conversations(1:1 문의 채팅)와도 무관. 기존 RPC 를 CREATE OR REPLACE
--     로 덮어쓰지 않는다. 이 파일은 "추가"만 한다.
--   · site_settings 에는 컬럼 1개만 ADD COLUMN IF NOT EXISTS 로 추가.
--   · 이 파일의 모든 CREATE OR REPLACE FUNCTION 은 session_ 접두어 신규 함수다.
--
-- 권한 모델:
--   · GM       : 모든 방 열람·발언·스크립트 작성·방 관리. 멤버 행 없이 항상 접근.
--   · 유저     : session_room_members 에 있는 방만 열람·발언. 다른 방은 목록에
--                이름만 보이고 내용은 RLS 로 차단.
--   · 노출 토글 : site_settings.session_chat_enabled. false 면 유저의 발언·
--                주사위 RPC 가 거부된다(입장 버튼 숨김은 프론트, 차단은 서버).
--                GM 은 토글과 무관하게 동작(테스트·준비용).
--
-- 쓰기 경로:
--   · 세 테이블 모두 직접 INSERT/UPDATE/DELETE 정책 없음. SECURITY DEFINER RPC 만.
--   · 메시지 삭제는 소프트 삭제(deleted_at). Realtime DELETE 이벤트는 RLS 를
--     거치지 않고 old row 가 전 구독자에게 나가므로 물리 삭제를 쓰지 않는다.
--     UPDATE 이벤트는 RLS 를 따른다.
--
-- Realtime:
--   · 마지막 절에서 supabase_realtime publication 에 세 테이블을 추가한다.
--     (이미 들어 있으면 건너뜀)
--
-- 되돌리기(사고 시):
--   · 테이블·함수 모두 신규라 DROP 만 하면 원상복구. 기존 기능 영향 없음.
--   · site_settings.session_chat_enabled 컬럼은 남겨도 무해.
--
-- pending 에 둔다. 검증 후 applied 로 이동.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- 0) site_settings 토글 컬럼
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS session_chat_enabled boolean NOT NULL DEFAULT false;


-- ───────────────────────────────────────────────────────────────────
-- 1) 테이블
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.session_rooms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- 열림: 유저가 발언 가능. 닫힘: 열람만 가능(기록 유지).
  is_open      boolean NOT NULL DEFAULT true,
  -- 보관: 목록에서 숨김(소프트 삭제). 복구 가능.
  is_archived  boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.session_room_members (
  room_id     uuid NOT NULL REFERENCES public.session_rooms(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, profile_id)
);

CREATE TABLE IF NOT EXISTS public.session_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id            uuid NOT NULL REFERENCES public.session_rooms(id) ON DELETE CASCADE,
  sender_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_role        text NOT NULL CHECK (sender_role IN ('user', 'gm', 'system')),
  -- 발신자 이름 스냅샷(작성 시점). 조인·profiles 정책 의존 없이 렌더.
  sender_name        text NOT NULL DEFAULT '',
  -- chat   : 채팅 스트림(유저·GM)
  -- script : 스크립트 스트림(GM 마크다운)
  -- roll   : 주사위 결과(채팅 스트림에 표시)
  -- system : 시스템 안내(채팅 스트림에 표시)
  kind               text NOT NULL CHECK (kind IN ('chat', 'script', 'roll', 'system')),
  content            text NOT NULL,
  -- roll 부가 정보: {"roll_type":"d100","value":57} / {"roll_type":"coin","result":"success"}
  meta               jsonb,
  edited_at          timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_messages_room_created_idx
  ON public.session_messages (room_id, created_at);
CREATE INDEX IF NOT EXISTS session_room_members_profile_idx
  ON public.session_room_members (profile_id);
CREATE INDEX IF NOT EXISTS session_rooms_active_idx
  ON public.session_rooms (created_at DESC) WHERE (is_archived = false);

-- updated_at 트리거 (기존 set_updated_at() 재사용)
DROP TRIGGER IF EXISTS session_rooms_set_updated_at ON public.session_rooms;
CREATE TRIGGER session_rooms_set_updated_at
  BEFORE UPDATE ON public.session_rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ───────────────────────────────────────────────────────────────────
-- 2) RLS  — SELECT 만 정책. 쓰기는 RPC 전용.
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.session_rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_messages     ENABLE ROW LEVEL SECURITY;

-- 방 목록: 로그인 유저 전체 열람(사양: 다른 방도 "보이기는" 함)
DROP POLICY IF EXISTS session_rooms_select_authenticated ON public.session_rooms;
CREATE POLICY session_rooms_select_authenticated
  ON public.session_rooms FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS session_room_members_select_authenticated ON public.session_room_members;
CREATE POLICY session_room_members_select_authenticated
  ON public.session_room_members FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 메시지: GM 또는 해당 방 멤버만. Realtime postgres_changes 도 이 정책을 따른다.
DROP POLICY IF EXISTS session_messages_select_member_or_gm ON public.session_messages;
CREATE POLICY session_messages_select_member_or_gm
  ON public.session_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid() AND p.is_gm = true
    )
    OR EXISTS (
      SELECT 1
        FROM public.session_room_members m
        JOIN public.profiles p ON p.id = m.profile_id
       WHERE m.room_id = session_messages.room_id
         AND p.user_id = auth.uid()
    )
  );


-- ───────────────────────────────────────────────────────────────────
-- 3) 내부 헬퍼 (신규)
-- ───────────────────────────────────────────────────────────────────

-- 호출자 프로필 행 반환. 없으면 예외.
CREATE OR REPLACE FUNCTION public._session_caller_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  SELECT * INTO v_p FROM public.profiles WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;
  IF v_p.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'account_deactivated';
  END IF;
  RETURN v_p;
END;
$$;

-- 표시 이름 스냅샷. GM 은 'GM', 유저는 성+이름.
CREATE OR REPLACE FUNCTION public._session_display_name(p public.profiles)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p.is_gm THEN 'GM'
    ELSE COALESCE(p.family_name, '') || COALESCE(p.given_name, '')
  END;
$$;

-- 발언 가능 여부 검증(유저·GM 공통). 통과하면 프로필 반환.
--   · 방 존재, 미보관, 열림
--   · 유저는 site_settings.session_chat_enabled = true 이고 멤버여야 함
--   · GM 은 토글·멤버십 무관
CREATE OR REPLACE FUNCTION public._session_assert_can_post(p_room_id uuid)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p    public.profiles;
  v_room public.session_rooms;
  v_on   boolean;
BEGIN
  v_p := public._session_caller_profile();

  SELECT * INTO v_room FROM public.session_rooms WHERE id = p_room_id;
  IF NOT FOUND OR v_room.is_archived THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  IF NOT v_p.is_gm THEN
    SELECT session_chat_enabled INTO v_on FROM public.site_settings WHERE id = 1;
    IF COALESCE(v_on, false) = false THEN
      RAISE EXCEPTION 'session_chat_disabled';
    END IF;
    IF NOT v_room.is_open THEN
      RAISE EXCEPTION 'room_closed';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.session_room_members
       WHERE room_id = p_room_id AND profile_id = v_p.id
    ) THEN
      RAISE EXCEPTION 'not_a_member';
    END IF;
  END IF;

  RETURN v_p;
END;
$$;


-- ───────────────────────────────────────────────────────────────────
-- 4) 조회 RPC
-- ───────────────────────────────────────────────────────────────────

-- 방 목록(모든 방) + 멤버 이름 + 내가 들어갈 수 있는지.
-- 보관된 방은 GM 에게만 보인다(p_include_archived=true 일 때).
CREATE OR REPLACE FUNCTION public.session_list_rooms(p_include_archived boolean DEFAULT false)
RETURNS TABLE (
  id            uuid,
  name          text,
  is_open       boolean,
  is_archived   boolean,
  created_at    timestamptz,
  updated_at    timestamptz,
  can_enter     boolean,
  member_count  integer,
  members       jsonb,
  last_message_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p public.profiles;
BEGIN
  v_p := public._session_caller_profile();

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.is_open,
    r.is_archived,
    r.created_at,
    r.updated_at,
    (v_p.is_gm OR EXISTS (
      SELECT 1 FROM public.session_room_members m
       WHERE m.room_id = r.id AND m.profile_id = v_p.id
    )) AS can_enter,
    (SELECT count(*)::int FROM public.session_room_members m WHERE m.room_id = r.id) AS member_count,
    COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'profile_id', m.profile_id,
                 'name', public._session_display_name(p)
               ) ORDER BY m.added_at
             )
        FROM public.session_room_members m
        JOIN public.profiles p ON p.id = m.profile_id
       WHERE m.room_id = r.id
    ), '[]'::jsonb) AS members,
    (SELECT max(sm.created_at) FROM public.session_messages sm
      WHERE sm.room_id = r.id AND sm.deleted_at IS NULL) AS last_message_at
  FROM public.session_rooms r
  WHERE (r.is_archived = false) OR (p_include_archived AND v_p.is_gm)
  ORDER BY r.is_archived ASC, r.created_at DESC;
END;
$$;

-- 현재 토글 상태(누구나 조회 가능. site_settings_select_all 과 동일 범위)
CREATE OR REPLACE FUNCTION public.session_get_enabled()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT COALESCE((SELECT session_chat_enabled FROM public.site_settings WHERE id = 1), false);
$$;


-- ───────────────────────────────────────────────────────────────────
-- 5) 발언 RPC (유저·GM)
-- ───────────────────────────────────────────────────────────────────

-- 채팅 메시지 전송
CREATE OR REPLACE FUNCTION public.session_send_message(p_room_id uuid, p_content text)
RETURNS public.session_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p   public.profiles;
  v_txt text;
  v_row public.session_messages;
BEGIN
  v_p   := public._session_assert_can_post(p_room_id);
  v_txt := btrim(COALESCE(p_content, ''));
  IF length(v_txt) = 0 THEN
    RAISE EXCEPTION 'empty_content';
  END IF;
  IF length(v_txt) > 2000 THEN
    RAISE EXCEPTION 'content_too_long';
  END IF;

  INSERT INTO public.session_messages
    (room_id, sender_profile_id, sender_role, sender_name, kind, content)
  VALUES
    (p_room_id, v_p.id, CASE WHEN v_p.is_gm THEN 'gm' ELSE 'user' END,
     public._session_display_name(v_p), 'chat', v_txt)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 주사위. p_roll_type: 'd100' | 'coin'
--   d100 → 1..100 균등 / coin → 성공·실패 50:50. 난수는 서버에서만 생성.
CREATE OR REPLACE FUNCTION public.session_roll(p_room_id uuid, p_roll_type text)
RETURNS public.session_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p      public.profiles;
  v_name   text;
  v_value  integer;
  v_result text;
  v_text   text;
  v_meta   jsonb;
  v_row    public.session_messages;
BEGIN
  v_p    := public._session_assert_can_post(p_room_id);
  v_name := public._session_display_name(v_p);

  IF p_roll_type = 'd100' THEN
    v_value := floor(random() * 100)::int + 1;   -- 1..100
    v_text  := v_name || ' 1d100 → ' || v_value::text;
    v_meta  := jsonb_build_object('roll_type', 'd100', 'value', v_value);
  ELSIF p_roll_type = 'coin' THEN
    v_result := CASE WHEN random() < 0.5 THEN 'success' ELSE 'fail' END;
    v_text   := v_name || ' 판정 → ' || CASE WHEN v_result = 'success' THEN '성공' ELSE '실패' END;
    v_meta   := jsonb_build_object('roll_type', 'coin', 'result', v_result);
  ELSE
    RAISE EXCEPTION 'invalid_roll_type';
  END IF;

  INSERT INTO public.session_messages
    (room_id, sender_profile_id, sender_role, sender_name, kind, content, meta)
  VALUES
    (p_room_id, v_p.id, CASE WHEN v_p.is_gm THEN 'gm' ELSE 'user' END,
     v_name, 'roll', v_text, v_meta)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


-- ───────────────────────────────────────────────────────────────────
-- 6) GM 전용 RPC
-- ───────────────────────────────────────────────────────────────────

-- 노출 토글
CREATE OR REPLACE FUNCTION public.session_gm_set_enabled(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_caller_is_gm();
  UPDATE public.site_settings
     SET session_chat_enabled = COALESCE(p_enabled, false),
         updated_by = auth.uid()
   WHERE id = 1;
  RETURN COALESCE(p_enabled, false);
END;
$$;

-- 방 생성 + 멤버 지정. 방 id 반환.
--   멤버는 profiles.id 배열. GM·비활성·미가입(shell) 프로필은 걸러서 넣지 않는다.
CREATE OR REPLACE FUNCTION public.session_gm_create_room(p_name text, p_member_profile_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gm   public.profiles;
  v_name text;
  v_id   uuid;
BEGIN
  PERFORM public.assert_caller_is_gm();
  SELECT * INTO v_gm FROM public.profiles WHERE user_id = auth.uid();

  v_name := btrim(COALESCE(p_name, ''));
  IF length(v_name) < 1 OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'invalid_room_name';
  END IF;

  INSERT INTO public.session_rooms (name, created_by)
  VALUES (v_name, v_gm.id)
  RETURNING id INTO v_id;

  INSERT INTO public.session_room_members (room_id, profile_id)
  SELECT v_id, p.id
    FROM public.profiles p
   WHERE p.id = ANY (COALESCE(p_member_profile_ids, ARRAY[]::uuid[]))
     AND p.is_gm = false
     AND p.user_id IS NOT NULL
     AND p.deactivated_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.session_messages (room_id, sender_role, sender_name, kind, content)
  VALUES (v_id, 'system', '', 'system', '방이 생성되었습니다.');

  RETURN v_id;
END;
$$;

-- 멤버 목록 교체(추가·제외 모두 이걸로). 잘못 만든 방 수정용.
CREATE OR REPLACE FUNCTION public.session_gm_set_members(p_room_id uuid, p_member_profile_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ids   uuid[];
  v_count integer;
BEGIN
  PERFORM public.assert_caller_is_gm();
  IF NOT EXISTS (SELECT 1 FROM public.session_rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  v_ids := COALESCE(p_member_profile_ids, ARRAY[]::uuid[]);

  DELETE FROM public.session_room_members
   WHERE room_id = p_room_id AND NOT (profile_id = ANY (v_ids));

  INSERT INTO public.session_room_members (room_id, profile_id)
  SELECT p_room_id, p.id
    FROM public.profiles p
   WHERE p.id = ANY (v_ids)
     AND p.is_gm = false
     AND p.user_id IS NOT NULL
     AND p.deactivated_at IS NULL
  ON CONFLICT DO NOTHING;

  -- updated_at 갱신 → 목록 Realtime 갱신 트리거 역할
  UPDATE public.session_rooms SET updated_at = now() WHERE id = p_room_id;

  SELECT count(*)::int INTO v_count
    FROM public.session_room_members WHERE room_id = p_room_id;
  RETURN v_count;
END;
$$;

-- 방 이름·열림 상태 변경. NULL 인 인자는 유지.
CREATE OR REPLACE FUNCTION public.session_gm_update_room(p_room_id uuid, p_name text, p_is_open boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_room public.session_rooms;
  v_name text;
BEGIN
  PERFORM public.assert_caller_is_gm();
  SELECT * INTO v_room FROM public.session_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  v_name := v_room.name;
  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) < 1 OR length(v_name) > 60 THEN
      RAISE EXCEPTION 'invalid_room_name';
    END IF;
  END IF;

  UPDATE public.session_rooms
     SET name    = v_name,
         is_open = COALESCE(p_is_open, is_open)
   WHERE id = p_room_id;

  IF p_is_open IS NOT NULL AND p_is_open IS DISTINCT FROM v_room.is_open THEN
    INSERT INTO public.session_messages (room_id, sender_role, sender_name, kind, content)
    VALUES (p_room_id, 'system', '', 'system',
            CASE WHEN p_is_open THEN '방이 열렸습니다.' ELSE '방이 닫혔습니다.' END);
  END IF;
END;
$$;

-- 보관/복구 (소프트 삭제)
CREATE OR REPLACE FUNCTION public.session_gm_set_archived(p_room_id uuid, p_archived boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_caller_is_gm();
  UPDATE public.session_rooms
     SET is_archived = COALESCE(p_archived, true)
   WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;
END;
$$;

-- 스크립트 게시 (GM 마크다운)
CREATE OR REPLACE FUNCTION public.session_gm_post_script(p_room_id uuid, p_content text)
RETURNS public.session_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gm  public.profiles;
  v_txt text;
  v_row public.session_messages;
BEGIN
  PERFORM public.assert_caller_is_gm();
  SELECT * INTO v_gm FROM public.profiles WHERE user_id = auth.uid();
  IF NOT EXISTS (SELECT 1 FROM public.session_rooms WHERE id = p_room_id AND is_archived = false) THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  v_txt := COALESCE(p_content, '');
  IF length(btrim(v_txt)) = 0 THEN
    RAISE EXCEPTION 'empty_content';
  END IF;
  IF length(v_txt) > 20000 THEN
    RAISE EXCEPTION 'content_too_long';
  END IF;

  INSERT INTO public.session_messages
    (room_id, sender_profile_id, sender_role, sender_name, kind, content)
  VALUES (p_room_id, v_gm.id, 'gm', 'GM', 'script', v_txt)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- 스크립트 수정 (GM). script kind 만 수정 가능.
CREATE OR REPLACE FUNCTION public.session_gm_update_script(p_message_id uuid, p_content text)
RETURNS public.session_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_txt text;
  v_row public.session_messages;
BEGIN
  PERFORM public.assert_caller_is_gm();
  v_txt := COALESCE(p_content, '');
  IF length(btrim(v_txt)) = 0 THEN
    RAISE EXCEPTION 'empty_content';
  END IF;
  IF length(v_txt) > 20000 THEN
    RAISE EXCEPTION 'content_too_long';
  END IF;

  UPDATE public.session_messages
     SET content = v_txt, edited_at = now()
   WHERE id = p_message_id AND kind = 'script' AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_not_found';
  END IF;
  RETURN v_row;
END;
$$;

-- 메시지 소프트 삭제 (GM). 어느 kind 든 가능(운영·오타 정리용).
CREATE OR REPLACE FUNCTION public.session_gm_delete_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.assert_caller_is_gm();
  UPDATE public.session_messages
     SET deleted_at = now()
   WHERE id = p_message_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_not_found';
  END IF;
END;
$$;


-- ───────────────────────────────────────────────────────────────────
-- 7) 권한
-- ───────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._session_caller_profile()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._session_assert_can_post(uuid)            FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.session_list_rooms(boolean)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_get_enabled()                           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_send_message(uuid, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_roll(uuid, text)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_gm_set_enabled(boolean)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_gm_create_room(text, uuid[])            TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_gm_set_members(uuid, uuid[])            TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_gm_update_room(uuid, text, boolean)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_gm_set_archived(uuid, boolean)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_gm_post_script(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_gm_update_script(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_gm_delete_message(uuid)                 TO authenticated;


-- ───────────────────────────────────────────────────────────────────
-- 8) Realtime publication (이미 포함돼 있으면 건너뜀)
--    site_settings 도 포함: GM 이 토글을 바꾸면 유저 화면의 입장 버튼이
--    새로고침 없이 나타나거나 사라진다. (site_settings 는 select_all 이라
--    이벤트로 새는 정보 없음 — 기능 플래그 4개뿐)
-- ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['session_rooms', 'session_room_members', 'session_messages', 'site_settings'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;


-- ───────────────────────────────────────────────────────────────────
-- 되돌리기 (필요 시 수동 실행)
-- ───────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.session_gm_delete_message(uuid);
-- DROP FUNCTION IF EXISTS public.session_gm_update_script(uuid, text);
-- DROP FUNCTION IF EXISTS public.session_gm_post_script(uuid, text);
-- DROP FUNCTION IF EXISTS public.session_gm_set_archived(uuid, boolean);
-- DROP FUNCTION IF EXISTS public.session_gm_update_room(uuid, text, boolean);
-- DROP FUNCTION IF EXISTS public.session_gm_set_members(uuid, uuid[]);
-- DROP FUNCTION IF EXISTS public.session_gm_create_room(text, uuid[]);
-- DROP FUNCTION IF EXISTS public.session_gm_set_enabled(boolean);
-- DROP FUNCTION IF EXISTS public.session_roll(uuid, text);
-- DROP FUNCTION IF EXISTS public.session_send_message(uuid, text);
-- DROP FUNCTION IF EXISTS public.session_get_enabled();
-- DROP FUNCTION IF EXISTS public.session_list_rooms(boolean);
-- DROP FUNCTION IF EXISTS public._session_assert_can_post(uuid);
-- DROP FUNCTION IF EXISTS public._session_display_name(public.profiles);
-- DROP FUNCTION IF EXISTS public._session_caller_profile();
-- DROP TABLE IF EXISTS public.session_messages;
-- DROP TABLE IF EXISTS public.session_room_members;
-- DROP TABLE IF EXISTS public.session_rooms;
-- ALTER TABLE public.site_settings DROP COLUMN IF EXISTS session_chat_enabled;
