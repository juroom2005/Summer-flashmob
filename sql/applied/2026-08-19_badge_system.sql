-- sql/pending/2026-08-19_badge_system.sql
-- ═══════════════════════════════════════════════════════════════════
-- 뱃지 시스템 : badges seed(6행) + Lv5 최초 도달 자동 부여 트리거
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 : v9 §4-4 / v10 §5 기획.
--   · 각 스탯(리듬감·체력·표현력)당 Lv5 최초 도달자 3명에게 순위권 뱃지.
--       1등 금 / 2등 은 / 3등 동  (badge_awards.rank = 1/2/3)
--   · 4등부터는 일반 뱃지 (badge_awards.rank = NULL, 무제한).
--   · 뱃지는 닉네임 옆 자동 표시. 넣고 빼기 기능은 후속.
--
-- 스키마 (이미 존재. 이 마이그레이션은 seed + 트리거만 추가)
--   badges
--     id · code(UNIQUE) · name · description · icon · is_ranked · metadata · created_at
--   badge_awards
--     id · badge_id · profile_id · rank · awarded_at
--     CHECK (rank IN (1,2,3))                         ← 일반은 NULL(통과)
--     UNIQUE (badge_id, profile_id)                   ← 한 유저 한 뱃지 1회
--     UNIQUE (badge_id, rank) WHERE rank IS NOT NULL  ← 금/은/동 각 1명 (핵심 안전망)
--
-- 설계 결정 근거 (기존 코드 실측)
--   · profiles.{rhythm,physical,expression}_level 은 GENERATED STORED 컬럼
--     (exp 0~450 → level 0~5). exp 를 쓰는 경로가 여러 개(미니게임 RPC ·
--     GM 조정 · 초대 세팅)라, 앱 로직마다 뱃지 부여를 심으면 누락 위험이 있다.
--     → profiles AFTER UPDATE 트리거 하나로 모든 경로를 잡는다. (기획 권고와 동일)
--   · 트리거 함수는 SECURITY DEFINER. badge_awards INSERT 정책이 없어
--     (RLS: select_all 만) 일반 경로로는 못 넣기 때문. 트리거만 유일한 쓰기 경로.
--   · code 는 스탯별 순위권/일반 2행 = 스탯 3종 × 2 = 6행.
--     금은동 구분은 badge_awards.rank 로. (badges 를 12행으로 쪼개지 않음)
--
-- 동시성 방침 (안정성 최우선)
--   · 순위 확정 전에 해당 순위권 badge 행을 SELECT ... FOR UPDATE 로 잠근다.
--     같은 스탯의 두 유저가 거의 동시에 Lv5 에 도달해도 순번이 직렬화된다.
--   · 그럼에도 만약 rank 중복 INSERT 가 시도되면 부분 유니크 인덱스가 막고,
--     트리거는 unique_violation 을 잡아 일반 뱃지로 폴백한다. (이중 안전장치)
--   · 유저가 이미 그 뱃지를 보유하면 (badge_id, profile_id) 유니크로 걸리므로
--     ON CONFLICT DO NOTHING 으로 조용히 skip.
--
-- 안정성 방침
--   · 전체 트랜잭션(BEGIN/COMMIT). 실패 시 전체 롤백.
--   · idempotent : seed 는 ON CONFLICT (code) DO UPDATE, 함수/트리거는
--     CREATE OR REPLACE / DROP IF EXISTS.
--   · 트리거는 exp 를 절대 건드리지 않는다(무한 루프 방지). badge_awards 에만 INSERT.
--   · icon 은 아이콘 파일 경로 규칙만 저장. 실제 표시(반짝이/색)는 프론트가
--     rank + stat 으로 파일명을 조립한다. (public/svg/badges/badge-{sym}-{grade}.svg)
--
-- 롤백 (필요 시)
--   DROP TRIGGER IF EXISTS trg_badge_award_on_level5 ON public.profiles;
--   DROP FUNCTION IF EXISTS public.award_badge_on_level5();
--   DROP FUNCTION IF EXISTS public.grant_stat_badge(uuid, text);
--   -- seed 로 넣은 badges 행 삭제는 신중히(수여 이력이 CASCADE 로 함께 삭제됨).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1) seed : badges 6행
--
--   code 규칙        : {stat}_rank / {stat}_common
--   stat             : rhythm / physical / performance
--                      (주의) 표현력 스탯의 내부 컬럼명은 expression_* 이지만,
--                      뱃지 심볼은 "퍼포먼스(별)" 이므로 code 는 performance_* 로 둔다.
--                      트리거에서 expression_level → performance code 로 매핑한다.
--   is_ranked        : 순위권 true / 일반 false
--   icon             : 대표 아이콘 경로. 프론트는 rank 에 따라 grade 를 바꿔 조립하되,
--                      이 값은 폴백/기본 표시에 쓴다.
--   metadata.stat    : 트리거·프론트가 스탯을 식별하는 키 (rhythm/physical/performance)
--   metadata.symbol  : 파일명 심볼 (note/heart/star)
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.badges (code, name, description, icon, is_ranked, metadata)
VALUES
  ('rhythm_rank',       '리듬감 순위권',   '리듬감 Lv5 최초 도달 1·2·3등에게 주어지는 금·은·동 뱃지.',
     '/svg/badges/badge-note-gold.svg',    true,
     '{"stat":"rhythm","symbol":"note"}'::jsonb),
  ('rhythm_common',     '리듬감',          '리듬감 Lv5 도달자에게 주어지는 뱃지.',
     '/svg/badges/badge-note-common.svg',  false,
     '{"stat":"rhythm","symbol":"note"}'::jsonb),
  ('physical_rank',     '체력 순위권',     '체력 Lv5 최초 도달 1·2·3등에게 주어지는 금·은·동 뱃지.',
     '/svg/badges/badge-heart-gold.svg',   true,
     '{"stat":"physical","symbol":"heart"}'::jsonb),
  ('physical_common',   '체력',            '체력 Lv5 도달자에게 주어지는 뱃지.',
     '/svg/badges/badge-heart-common.svg', false,
     '{"stat":"physical","symbol":"heart"}'::jsonb),
  ('performance_rank',  '퍼포먼스 순위권', '표현력 Lv5 최초 도달 1·2·3등에게 주어지는 금·은·동 뱃지.',
     '/svg/badges/badge-star-gold.svg',    true,
     '{"stat":"performance","symbol":"star"}'::jsonb),
  ('performance_common','퍼포먼스',        '표현력 Lv5 도달자에게 주어지는 뱃지.',
     '/svg/badges/badge-star-common.svg',  false,
     '{"stat":"performance","symbol":"star"}'::jsonb)
ON CONFLICT (code) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      icon        = EXCLUDED.icon,
      is_ranked   = EXCLUDED.is_ranked,
      metadata    = EXCLUDED.metadata;


-- ────────────────────────────────────────────────────────────────────
-- 2) 부여 헬퍼 : grant_stat_badge(profile_id, stat)
--
--   한 스탯에 대한 뱃지 1개를 부여한다. 순위권 자리가 남으면 금/은/동,
--   차면 일반. 이미 보유 시 skip. 트리거에서 스탯별로 호출한다.
--
--   stat 인자 : 'rhythm' | 'physical' | 'performance'
--   SECURITY DEFINER : badge_awards 쓰기 권한 확보 (RLS 우회).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_stat_badge(
  p_profile_id uuid,
  p_stat       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rank_badge_id   uuid;
  v_common_badge_id uuid;
  v_taken           integer;
  v_next_rank       integer;
BEGIN
  -- 스탯의 순위권/일반 badge id 조회
  SELECT id INTO v_rank_badge_id
    FROM public.badges
   WHERE code = p_stat || '_rank';

  SELECT id INTO v_common_badge_id
    FROM public.badges
   WHERE code = p_stat || '_common';

  -- seed 누락 방어 : 대상 badge 가 없으면 조용히 종료(트랜잭션 깨지 않음)
  IF v_rank_badge_id IS NULL OR v_common_badge_id IS NULL THEN
    RAISE WARNING 'grant_stat_badge: badge rows missing for stat=%', p_stat;
    RETURN;
  END IF;

  -- 순위권 자리(rank 1~3)를 잠그고 카운트. 동시 도달 직렬화의 핵심.
  --   해당 순위권 뱃지의 rank 부여 행을 FOR UPDATE 로 잠근다.
  SELECT count(*) INTO v_taken
    FROM public.badge_awards
   WHERE badge_id = v_rank_badge_id
     AND rank IS NOT NULL
   FOR UPDATE;

  IF v_taken < 3 THEN
    -- 금/은/동 자리 남음 → 다음 순번 부여 시도
    v_next_rank := v_taken + 1;

    BEGIN
      INSERT INTO public.badge_awards (badge_id, profile_id, rank)
      VALUES (v_rank_badge_id, p_profile_id, v_next_rank)
      ON CONFLICT (badge_id, profile_id) DO NOTHING;
      -- (badge_id, profile_id) 충돌 = 이미 이 순위권 뱃지 보유 → skip
    EXCEPTION
      WHEN unique_violation THEN
        -- (badge_id, rank) 부분 유니크 충돌 = 경합으로 순번이 이미 채워짐.
        -- 안전망 발동 : 일반 뱃지로 폴백.
        INSERT INTO public.badge_awards (badge_id, profile_id, rank)
        VALUES (v_common_badge_id, p_profile_id, NULL)
        ON CONFLICT (badge_id, profile_id) DO NOTHING;
    END;
  ELSE
    -- 순위권 마감 → 일반 뱃지
    INSERT INTO public.badge_awards (badge_id, profile_id, rank)
    VALUES (v_common_badge_id, p_profile_id, NULL)
    ON CONFLICT (badge_id, profile_id) DO NOTHING;
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────────────
-- 3) 트리거 함수 : award_badge_on_level5()
--
--   profiles UPDATE 후, 방금 Lv5 로 올라간 스탯마다 grant_stat_badge 호출.
--   OLD.*_level < 5 AND NEW.*_level = 5 조건으로 "최초 도달 순간" 만 잡는다.
--   (이미 Lv5 인 상태의 다른 컬럼 UPDATE 에는 재발동하지 않음)
--
--   expression_level → performance code 매핑 주의.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_badge_on_level5()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 리듬감
  IF NEW.rhythm_level = 5 AND COALESCE(OLD.rhythm_level, 0) < 5 THEN
    PERFORM public.grant_stat_badge(NEW.id, 'rhythm');
  END IF;

  -- 체력
  IF NEW.physical_level = 5 AND COALESCE(OLD.physical_level, 0) < 5 THEN
    PERFORM public.grant_stat_badge(NEW.id, 'physical');
  END IF;

  -- 표현력(심볼: 퍼포먼스/별)
  IF NEW.expression_level = 5 AND COALESCE(OLD.expression_level, 0) < 5 THEN
    PERFORM public.grant_stat_badge(NEW.id, 'performance');
  END IF;

  RETURN NULL;  -- AFTER 트리거. 반환값은 사용되지 않음.
END;
$$;


-- ────────────────────────────────────────────────────────────────────
-- 4) 트리거 부착 : profiles AFTER UPDATE
--
--   level 컬럼은 GENERATED 라 직접 UPDATE 대상이 될 수 없다.
--   exp 가 바뀌면 level 이 재계산되므로, exp 컬럼 변화만 감지하면 충분하다.
--   WHEN 절로 exp 변화가 있을 때만 함수 진입 → 불필요한 발동 최소화.
-- ────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_badge_award_on_level5 ON public.profiles;

CREATE TRIGGER trg_badge_award_on_level5
AFTER UPDATE OF rhythm_exp, physical_exp, expression_exp
ON public.profiles
FOR EACH ROW
WHEN (
  OLD.rhythm_exp     IS DISTINCT FROM NEW.rhythm_exp     OR
  OLD.physical_exp   IS DISTINCT FROM NEW.physical_exp   OR
  OLD.expression_exp IS DISTINCT FROM NEW.expression_exp
)
EXECUTE FUNCTION public.award_badge_on_level5();


-- ────────────────────────────────────────────────────────────────────
-- 5) 검증 쿼리 (실행 후 눈으로 확인용. 주석 해제하여 개별 실행)
-- ────────────────────────────────────────────────────────────────────
-- 5-1) seed 6행 확인
-- SELECT code, name, is_ranked, icon, metadata FROM public.badges ORDER BY code;
--
-- 5-2) 트리거 부착 확인
-- SELECT tgname, tgrelid::regclass, tgenabled
--   FROM pg_trigger
--  WHERE tgname = 'trg_badge_award_on_level5';
--
-- 5-3) 부여 로직 수동 테스트 (테스트 계정에서만!)
--   특정 유저의 rhythm_exp 를 450 으로 올려 Lv5 도달 → 뱃지 자동 부여 확인:
-- UPDATE public.profiles SET rhythm_exp = 450 WHERE id = '<test-profile-id>';
-- SELECT ba.rank, b.code
--   FROM public.badge_awards ba JOIN public.badges b ON b.id = ba.badge_id
--  WHERE ba.profile_id = '<test-profile-id>';

COMMIT;
