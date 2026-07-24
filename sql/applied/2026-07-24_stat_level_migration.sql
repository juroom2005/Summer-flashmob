-- sql/2026-07-24_stat_level_migration.sql
-- ═══════════════════════════════════════════════════════════════════
-- 스탯 시스템 개편 : 0~100 단일 스탯 → 경험치 누적(0~450) + 레벨 파생
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 : summer_flashmob_handoff_v8.md §2-4, §4-1
--
-- 변경 요약
--   1) profiles.rhythm_stat     → profiles.rhythm_exp
--      profiles.physical_stat   → profiles.physical_exp
--      profiles.expression_stat → profiles.expression_exp
--      (기존 값 그대로 이월. 0~100 값이 exp 로 그대로 들어감)
--   2) CHECK 0~100 → 0~450 으로 교체
--   3) rhythm_level / physical_level / expression_level (int, STORED)
--      GENERATED 컬럼 3개 신설. 구간 : 0/30/80/160/280/450
--   4) stamina_factor / performance_total 은 앱(lib/stat-helpers.ts)에서 계산.
--      DB 에는 배치하지 않는다. (핸드오프 결정 A안)
--
-- 실행 순서 함정
--   - CHECK constraint 는 컬럼과 함께 자동으로 리네임되지 않지만, 참조하는
--     컬럼은 RENAME COLUMN 시 자동으로 갱신된다.
--   - 그러나 CHECK(0~100) 이 남아 있으면 exp 를 100 이상으로 올릴 수 없다.
--   - 따라서 순서는 : (1) 옛 CHECK DROP → (2) 컬럼 RENAME → (3) 새 CHECK ADD
--     → (4) GENERATED 컬럼 ADD.
--
-- 안전장치
--   - 전체를 BEGIN/COMMIT 트랜잭션으로 감싼다.
--     중간 실패 시 자동 ROLLBACK 되어 스키마 절반 변경 상태로 남지 않는다.
--   - 실행 후 검증 SELECT 를 맨 아래에 붙여둔다.
--
-- 재실행 불가
--   - 이 파일은 1회성 마이그레이션이다. 성공 후 재실행하면 컬럼/제약이
--     이미 존재해 에러가 난다. sql/ 폴더에 실행 완료 표시를 별도로 관리한다.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) 옛 CHECK constraint 제거
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_rhythm_stat_check;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_physical_stat_check;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_expression_stat_check;

-- ────────────────────────────────────────────────────────────────────
-- 2) 컬럼 리네임 (_stat → _exp)
--    값은 그대로 이월된다. 0~100 값이 그대로 exp 값으로 들어간다.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  RENAME COLUMN rhythm_stat TO rhythm_exp;

ALTER TABLE public.profiles
  RENAME COLUMN physical_stat TO physical_exp;

ALTER TABLE public.profiles
  RENAME COLUMN expression_stat TO expression_exp;

-- ────────────────────────────────────────────────────────────────────
-- 3) 새 CHECK constraint 추가 (0 ~ 450)
--    상한 450 = Lv5 도달선. 그 이상은 컷.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_rhythm_exp_check
  CHECK (rhythm_exp >= 0 AND rhythm_exp <= 450);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_physical_exp_check
  CHECK (physical_exp >= 0 AND physical_exp <= 450);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_expression_exp_check
  CHECK (expression_exp >= 0 AND expression_exp <= 450);

-- ────────────────────────────────────────────────────────────────────
-- 4) GENERATED 레벨 컬럼 3종 추가 (STORED)
--
--    구간 정의 :
--      Lv0 :   0 ~  29
--      Lv1 :  30 ~  79
--      Lv2 :  80 ~ 159
--      Lv3 : 160 ~ 279
--      Lv4 : 280 ~ 449
--      Lv5 : 450 (상한)
--
--    STORED 만 지원됨 (PG17 이하는 VIRTUAL 미지원). 저장 공간 미미.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN rhythm_level integer
  GENERATED ALWAYS AS (
    CASE
      WHEN rhythm_exp >= 450 THEN 5
      WHEN rhythm_exp >= 280 THEN 4
      WHEN rhythm_exp >= 160 THEN 3
      WHEN rhythm_exp >=  80 THEN 2
      WHEN rhythm_exp >=  30 THEN 1
      ELSE 0
    END
  ) STORED;

ALTER TABLE public.profiles
  ADD COLUMN physical_level integer
  GENERATED ALWAYS AS (
    CASE
      WHEN physical_exp >= 450 THEN 5
      WHEN physical_exp >= 280 THEN 4
      WHEN physical_exp >= 160 THEN 3
      WHEN physical_exp >=  80 THEN 2
      WHEN physical_exp >=  30 THEN 1
      ELSE 0
    END
  ) STORED;

ALTER TABLE public.profiles
  ADD COLUMN expression_level integer
  GENERATED ALWAYS AS (
    CASE
      WHEN expression_exp >= 450 THEN 5
      WHEN expression_exp >= 280 THEN 4
      WHEN expression_exp >= 160 THEN 3
      WHEN expression_exp >=  80 THEN 2
      WHEN expression_exp >=  30 THEN 1
      ELSE 0
    END
  ) STORED;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 검증 쿼리 (트랜잭션 밖. 위 COMMIT 성공 후 확인용)
-- ═══════════════════════════════════════════════════════════════════

-- 컬럼 구조 확인 : _exp 3종 + _level 3종 이 모두 존재하고
-- _level 은 is_generated = 'ALWAYS' 이어야 한다.
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default,
  is_generated,
  generation_expression
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'profiles'
  AND column_name IN (
    'rhythm_exp',    'physical_exp',    'expression_exp',
    'rhythm_level',  'physical_level',  'expression_level'
  )
ORDER BY column_name;

-- CHECK constraint 확인 : *_exp_check 3개가 있어야 하고
-- *_stat_check 는 하나도 없어야 한다.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND contype  = 'c'
  AND conname LIKE 'profiles_%_check'
ORDER BY conname;

-- 실제 데이터 확인 : 리네임된 exp 값과 그로부터 파생된 level 값 샘플
SELECT
  id,
  family_name,
  given_name,
  rhythm_exp,     rhythm_level,
  physical_exp,   physical_level,
  expression_exp, expression_level
FROM public.profiles
ORDER BY created_at DESC
LIMIT 10;
