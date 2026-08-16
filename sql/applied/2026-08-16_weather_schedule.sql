-- sql/pending/2026-08-16_weather_schedule.sql
-- ═══════════════════════════════════════════════════════════════════
-- 날씨 위젯 : weather_schedule 테이블 + GM RPC + 오늘 날씨 조회(없으면 랜덤 확정)
-- ═══════════════════════════════════════════════════════════════════
--
-- 요구사항
--   · GM 만 날씨/온도/체감온도를 날짜별로 지정(미래 예약 가능).
--   · KST(=JST, UTC+9) 자정이 지나면 그 날짜의 지정값으로 바뀐다(세션 무관 공통).
--   · 지정이 없는 날은 랜덤으로 뽑되, 한 번 정해지면 그 날은 고정(이력 남음).
--     이후 GM 이 덮어쓰면 바뀐 값 사용.
--
-- 랜덤 확정 트리거(크론 없이)
--   · 위젯이 "오늘 날씨"를 조회할 때 행이 없으면 그 자리에서 랜덤 생성+저장.
--     (get_or_create_today_weather RPC. ON CONFLICT 로 동시 접속 중복 방지)
--   · 누가 먼저 접속하든 그 순간 그 날 날씨가 확정 → 이후 모두 동일하게 봄.
--
-- 온도 고증 (8월 도쿄 여름 기준)
--   · 평균 최고 32℃ / 최저 23℃, 역대 최고 39.5℃(열섬), 비 확률 ~38%, 습도 높음.
--   · 날씨종류별 현실적 온도·체감 범위를 아래 CASE 로 지정.
--   · 랜덤 풀은 여름에 맞게 sunny/cloudy/sun-shower/rainy/thunder-storm 5종.
--     (flurries[눈]은 8월 비현실적 → 랜덤 제외. GM 이 원하면 수동 지정만 가능)
--     가중치: 맑음·흐림 높게, 비 계열 낮게(비 확률 반영).
--
-- 안정성
--   · BEGIN/COMMIT. idempotent(IF NOT EXISTS / OR REPLACE).
--   · GM RPC 는 assert_caller_is_gm() + SECURITY DEFINER + search_path.
--   · 조회 RPC(get_or_create_today_weather)는 누구나 호출 가능(공용 위젯).
--     단 INSERT 는 이 RPC 내부(SECURITY DEFINER)에서만 → 유저가 임의 조작 불가.
--
-- 롤백
--   DROP FUNCTION IF EXISTS public.get_or_create_today_weather();
--   DROP FUNCTION IF EXISTS public.gm_set_weather(date, text, integer, integer);
--   DROP FUNCTION IF EXISTS public.gm_delete_weather(date);
--   DROP FUNCTION IF EXISTS public.gm_list_weather(date, date);
--   DROP FUNCTION IF EXISTS public._random_weather_for(date);
--   DROP TABLE    IF EXISTS public.weather_schedule;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) weather_schedule 테이블
--    weather_date 를 PK 로 → 날짜당 1행.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weather_schedule (
  weather_date  date        PRIMARY KEY,
  kind          text        NOT NULL,
  temp_c        integer     NOT NULL,
  real_feel_c   integer     NOT NULL,
  -- 랜덤 자동생성분과 GM 지정분 구분(운영 파악용).
  source        text        NOT NULL DEFAULT 'gm',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT weather_kind_check CHECK (
    kind IN ('sunny','cloudy','rainy','sun-shower','thunder-storm','flurries')
  ),
  CONSTRAINT weather_source_check CHECK (source IN ('gm','random')),
  -- 상식 밖 값 방지(위젯 표시 안정).
  CONSTRAINT weather_temp_range CHECK (temp_c   BETWEEN -30 AND 50),
  CONSTRAINT weather_feel_range CHECK (real_feel_c BETWEEN -40 AND 60)
);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public._weather_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS weather_schedule_touch ON public.weather_schedule;
CREATE TRIGGER weather_schedule_touch
  BEFORE UPDATE ON public.weather_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public._weather_touch_updated_at();


-- ────────────────────────────────────────────────────────────────────
-- 2) RLS
--    SELECT 전체공개(위젯). INSERT/UPDATE/DELETE 는 정책 없음
--    → RPC(SECURITY DEFINER)로만 변경. 유저 직접 조작 불가.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.weather_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weather_select_all ON public.weather_schedule;
CREATE POLICY weather_select_all
  ON public.weather_schedule
  FOR SELECT
  USING (true);


-- ────────────────────────────────────────────────────────────────────
-- 3) 랜덤 날씨 생성 헬퍼 (내부용)
--    주어진 날짜에 대해 (kind, temp_c, real_feel_c) 를 고증 범위로 뽑는다.
--    가중 랜덤: 맑음40 / 흐림30 / 여우비10 / 비12 / 뇌우8 (합 100)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._random_weather_for(p_date date)
RETURNS TABLE(kind text, temp_c integer, real_feel_c integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  r        double precision := random();  -- 0~1
  v_kind   text;
  v_temp   integer;
  v_feel   integer;
BEGIN
  -- 가중 선택
  IF r < 0.40 THEN
    v_kind := 'sunny';
  ELSIF r < 0.70 THEN
    v_kind := 'cloudy';
  ELSIF r < 0.80 THEN
    v_kind := 'sun-shower';
  ELSIF r < 0.92 THEN
    v_kind := 'rainy';
  ELSE
    v_kind := 'thunder-storm';
  END IF;

  -- 날씨종류별 고증 온도/체감(8월 도쿄). floor(random()*(hi-lo+1))+lo
  CASE v_kind
    WHEN 'sunny' THEN
      v_temp := floor(random() * (37 - 31 + 1))::int + 31;  -- 31~37
      v_feel := v_temp + floor(random() * (7 - 4 + 1))::int + 4;  -- +4~7
    WHEN 'cloudy' THEN
      v_temp := floor(random() * (33 - 28 + 1))::int + 28;  -- 28~33
      v_feel := v_temp + floor(random() * (5 - 3 + 1))::int + 3;  -- +3~5
    WHEN 'sun-shower' THEN
      v_temp := floor(random() * (31 - 27 + 1))::int + 27;  -- 27~31
      v_feel := v_temp + floor(random() * (6 - 4 + 1))::int + 4;  -- +4~6
    WHEN 'rainy' THEN
      v_temp := floor(random() * (29 - 24 + 1))::int + 24;  -- 24~29
      v_feel := v_temp + floor(random() * (4 - 2 + 1))::int + 2;  -- +2~4
    ELSE  -- thunder-storm
      v_temp := floor(random() * (30 - 25 + 1))::int + 25;  -- 25~30
      v_feel := v_temp + floor(random() * (5 - 3 + 1))::int + 3;  -- +3~5
  END CASE;

  kind := v_kind; temp_c := v_temp; real_feel_c := v_feel;
  RETURN NEXT;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────
-- 4) 오늘 날씨 조회 (없으면 랜덤 확정) — 공용
--    위젯이 호출. KST 기준 오늘 행이 있으면 반환, 없으면 랜덤 생성+저장 후 반환.
--    ON CONFLICT DO NOTHING 로 동시 접속 중복 INSERT 방지.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_or_create_today_weather()
RETURNS public.weather_schedule
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_row   public.weather_schedule;
  v_rand  record;
BEGIN
  -- 이미 있으면 반환
  SELECT * INTO v_row FROM public.weather_schedule WHERE weather_date = v_today;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- 없으면 랜덤 생성
  SELECT * INTO v_rand FROM public._random_weather_for(v_today);

  INSERT INTO public.weather_schedule (weather_date, kind, temp_c, real_feel_c, source)
  VALUES (v_today, v_rand.kind, v_rand.temp_c, v_rand.real_feel_c, 'random')
  ON CONFLICT (weather_date) DO NOTHING;

  -- 동시성으로 다른 세션이 먼저 넣었을 수도 있으니 다시 조회해 반환
  SELECT * INTO v_row FROM public.weather_schedule WHERE weather_date = v_today;
  RETURN v_row;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────
-- 5) GM : 날짜별 날씨 지정/수정 (upsert)
--    미래 날짜 예약도 이 함수로. source='gm' 로 기록.
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.gm_set_weather(date, text, integer, integer);
CREATE FUNCTION public.gm_set_weather(
  p_date        date,
  p_kind        text,
  p_temp_c      integer,
  p_real_feel_c integer
)
RETURNS public.weather_schedule
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.weather_schedule;
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'invalid_date';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN
     ('sunny','cloudy','rainy','sun-shower','thunder-storm','flurries') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  IF p_temp_c IS NULL OR p_real_feel_c IS NULL THEN
    RAISE EXCEPTION 'invalid_temp';
  END IF;

  INSERT INTO public.weather_schedule
    (weather_date, kind, temp_c, real_feel_c, source)
  VALUES
    (p_date, p_kind, p_temp_c, p_real_feel_c, 'gm')
  ON CONFLICT (weather_date) DO UPDATE
    SET kind = EXCLUDED.kind,
        temp_c = EXCLUDED.temp_c,
        real_feel_c = EXCLUDED.real_feel_c,
        source = 'gm'
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────
-- 6) GM : 날짜 지정 삭제
--    삭제하면 그 날은 다시 "미지정" → 오늘이면 조회 시 랜덤 재확정.
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.gm_delete_weather(date);
CREATE FUNCTION public.gm_delete_weather(p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'invalid_date';
  END IF;

  DELETE FROM public.weather_schedule WHERE weather_date = p_date;
  -- 없어도 에러로 보지 않음(이미 미지정 상태면 성공으로 취급).
END;
$function$;


-- ────────────────────────────────────────────────────────────────────
-- 7) GM : 기간 조회 (관리 UI 목록)
--    p_from ~ p_to 범위의 지정 행을 반환(예약 현황 확인).
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.gm_list_weather(date, date);
CREATE FUNCTION public.gm_list_weather(p_from date, p_to date)
RETURNS SETOF public.weather_schedule
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_caller_is_gm();

  RETURN QUERY
  SELECT * FROM public.weather_schedule
   WHERE weather_date BETWEEN p_from AND p_to
   ORDER BY weather_date ASC;
END;
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 검증
-- ═══════════════════════════════════════════════════════════════════
-- (1) 오늘 날씨 조회(없으면 랜덤 확정). 대시보드에서도 호출 가능(공용).
--   SELECT * FROM public.get_or_create_today_weather();
--
-- (2) GM 지정(대시보드는 supabase_admin 이라 assert 실패 → 프론트 GM 계정에서 검증).
--   SELECT * FROM public.gm_set_weather('2026-08-17','rainy',27,30);
--
-- (3) 랜덤 함수 단독 확인(여러 번 실행해 분포 감각):
--   SELECT * FROM public._random_weather_for(current_date);
--
-- (4) 정책/테이블 확인:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename='weather_schedule';
-- ═══════════════════════════════════════════════════════════════════
