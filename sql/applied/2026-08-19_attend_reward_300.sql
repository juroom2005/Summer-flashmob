-- sql/pending/2026-08-19_attend_reward_300.sql
-- ═══════════════════════════════════════════════════════════════════
-- 출석 지급 모빌 500 → 300 하향
-- ═══════════════════════════════════════════════════════════════════
--
-- 변경 : attend_today 의 v_reward 상수만 500 → 300.
--        나머지 로직(하루 1회 유니크 · 행 잠금 · 한마디 저장)은 그대로.
--
-- 원본 : 초기 스키마(2026-07-24 이전)에 정의돼 리포에 파일이 없던 함수.
--        summerFlashmob_full_schema_dump_260724.txt 의 정의를 그대로 옮기고
--        보상액만 바꿨다. 이 파일이 이후 attend_today 의 정본 역할을 한다.
--
-- 안정성
--   · CREATE OR REPLACE. 반환 시그니처 동일 → DROP 불필요, 재실행 안전.
--   · 과거 지급 이력(mobil_grants)에는 소급 적용되지 않는다. 이후 출석부터 300.
--
-- 롤백 : 이 파일의 300 을 500 으로 바꿔 다시 실행.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.attend_today(p_message text DEFAULT NULL::text)
RETURNS TABLE(ok boolean, attended_date date, new_mobil integer, reward integer, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid            uuid := auth.uid();
  v_profile_id     uuid;
  v_current_mobil  integer;
  v_next_mobil     integer;
  v_grant_date     date;
  v_reward         constant integer := 300;   -- ← 500 에서 하향
  v_message        text;
BEGIN
  -- (1) 로그인 확인
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, NULL::date, NULL::integer, v_reward, 'not_authenticated'::text;
    RETURN;
  END IF;

  -- (2) 프로필 조회 + 행 잠금
  SELECT id, mobil
    INTO v_profile_id, v_current_mobil
    FROM public.profiles
   WHERE user_id = v_uid
   FOR UPDATE;

  IF v_profile_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::date, NULL::integer, v_reward, 'no_profile'::text;
    RETURN;
  END IF;

  -- (3) 한마디 정규화 : 앞뒤 공백 제거, 빈 문자열은 NULL, 200자 초과분 절단
  v_message := NULLIF(btrim(COALESCE(p_message, '')), '');
  IF v_message IS NOT NULL AND char_length(v_message) > 200 THEN
    v_message := left(v_message, 200);
  END IF;

  -- (4) mobil_grants INSERT (유니크 인덱스가 하루 1회 강제)
  BEGIN
    INSERT INTO public.mobil_grants
      (profile_id, grant_type, amount, note, granted_by)
    VALUES
      (v_profile_id, 'daily_login', v_reward, NULL, v_uid)
    RETURNING grant_date INTO v_grant_date;
  EXCEPTION WHEN unique_violation THEN
    -- 이미 출석 상태이면 한마디도 저장하지 않는다
    RETURN QUERY SELECT
      false,
      ((now() AT TIME ZONE 'Asia/Seoul'))::date,
      v_current_mobil,
      v_reward,
      'already_attended'::text;
    RETURN;
  END;

  -- (5) 한마디 저장 : 값이 있는 경우에만
  IF v_message IS NOT NULL THEN
    INSERT INTO public.attendance_messages (profile_id, message)
    VALUES (v_profile_id, v_message);
  END IF;

  -- (6) 모빌 지급
  v_next_mobil := v_current_mobil + v_reward;

  UPDATE public.profiles
     SET mobil = v_next_mobil
   WHERE id = v_profile_id;

  RETURN QUERY SELECT true, v_grant_date, v_next_mobil, v_reward, NULL::text;
END;
$function$;

COMMIT;
