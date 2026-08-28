-- sql/applied/2026-08-28_session_roll_dance.sql
-- ═══════════════════════════════════════════════════════════════════
-- session_roll : 춤추기(dance) 판정 추가 버전 — 라이브 정의 기록
-- ═══════════════════════════════════════════════════════════════════
--
-- 경위:
--   dance 분기는 라이브 DB 의 SQL 에디터에서 직접 적용되었고 repo 에는
--   반영되지 않은 상태였다. 2026-08-28 에 pg_get_functiondef 로 라이브
--   정의를 덤프해 이 파일로 기록한다.
--
-- ★ 사고 방지 — 반드시 읽을 것 ★
--   · sql/applied/2026-08-27_session_chat.sql 의 session_roll 은
--     d100/coin 만 있는 구버전이다. 그 파일을 재실행하면 dance 가
--     사라진다(RPC 덮어쓰기 롤백). 재실행했다면 이 파일을 반드시
--     그 뒤에 다시 실행할 것.
--   · 이 파일 자체는 CREATE OR REPLACE 라 몇 번을 실행해도 무해.
--   · 함수 시그니처(uuid, text)가 동일하므로 기존 GRANT 는 유지된다.
--     별도 GRANT 불필요.
--
-- 덤프 대비 변경점 (동작 동일):
--   · RETURNS session_messages → RETURNS public.session_messages 로
--     스키마 한정. 덤프는 실행 세션의 search_path 에 따라 무한정으로
--     출력됐던 것이며, 다른 search_path 에서 재실행해도 안전하도록
--     한정만 추가했다.
--
-- dance 판정 규칙:
--   종합점수 = (리듬 + 표현) × (5 + 체력), 각 레벨은 0..5 클램프,
--   종합점수는 0..100 클램프. 1d100 을 굴려:
--     · 1                          → 대성공 (critical_success)
--     · 종합 100 이면 대실패 없음. 20 이하 극단적 성공 / 50 이하
--       어려운 성공 / 나머지 성공
--     · 종합 <50 이고 96 이상, 또는 종합 ≥50 이고 100 → 대실패 (fumble)
--     · 종합÷5 이하 → 극단적 성공 / 종합÷2 이하 → 어려운 성공 /
--       종합 이하 → 성공 / 초과 → 실패
--
-- 되돌리기(사고 시):
--   2026-08-27_session_chat.sql 의 session_roll 절만 다시 실행하면
--   d100/coin 버전으로 복귀한다 (프론트 춤추기 버튼은 에러 안내 표시).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.session_roll(p_room_id uuid, p_roll_type text)
 RETURNS public.session_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p      public.profiles;
  v_name   text;
  v_value  integer;
  v_result text;
  v_text   text;
  v_meta   jsonb;
  v_row    public.session_messages;
  v_total  integer;   -- 종합점수 0..100
  v_label  text;      -- 판정 한글 라벨
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
  ELSIF p_roll_type = 'dance' THEN
    -- 종합점수 계산: (리듬 + 표현) × (5 + 체력). 레벨은 0..5 로 클램프.
    v_total := (
      LEAST(5, GREATEST(0, COALESCE(v_p.rhythm_level, 0)))
      + LEAST(5, GREATEST(0, COALESCE(v_p.expression_level, 0)))
    ) * (5 + LEAST(5, GREATEST(0, COALESCE(v_p.physical_level, 0))));
    v_total := LEAST(100, GREATEST(0, v_total));

    v_value := floor(random() * 100)::int + 1;   -- 1..100

    -- 판정 (우선순위대로)
    IF v_value = 1 THEN
      v_result := 'critical_success'; v_label := '대성공';
    ELSIF v_total = 100 THEN
      -- 만점: 대실패 없음. 주사위 1은 위에서 이미 대성공 처리됨.
      IF v_value <= 20 THEN
        v_result := 'extreme_success'; v_label := '극단적 성공';   -- 100÷5 = 20
      ELSIF v_value <= 50 THEN
        v_result := 'hard_success';    v_label := '어려운 성공'; -- 100÷2 = 50
      ELSE
        v_result := 'success';         v_label := '성공';
      END IF;
    ELSIF (v_total < 50 AND v_value >= 96) OR (v_total >= 50 AND v_value = 100) THEN
      v_result := 'fumble'; v_label := '대실패';
    ELSIF v_value <= (v_total / 5) THEN
      v_result := 'extreme_success'; v_label := '극단적 성공';
    ELSIF v_value <= (v_total / 2) THEN
      v_result := 'hard_success';    v_label := '어려운 성공';
    ELSIF v_value <= v_total THEN
      v_result := 'success';         v_label := '성공';
    ELSE
      v_result := 'fail';            v_label := '실패';
    END IF;

    v_text := v_name || ' 춤추기 (종합 ' || v_total::text || ') · 1d100 → '
              || v_value::text || ' · ' || v_label;
    v_meta := jsonb_build_object(
      'roll_type', 'dance',
      'value',     v_value,
      'total',     v_total,
      'result',    v_result
    );
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
$function$;
