-- sql/pending/2026-08-19_badge_grant_hotfix.sql
-- ═══════════════════════════════════════════════════════════════════
-- 핫픽스 : grant_stat_badge 의 "FOR UPDATE + 집계함수" 오류 수정
-- ═══════════════════════════════════════════════════════════════════
--
-- 증상
--   GM 스탯 조정 등으로 스탯이 Lv5 에 도달하는 순간 트리거가 실패하고,
--   호출한 RPC 까지 400 으로 떨어진다.
--     ERROR: FOR UPDATE is not allowed with aggregate functions
--
-- 원인
--   2026-08-19_badge_system.sql 의 grant_stat_badge 안에서 순위 자리를
--   잠그려고 `SELECT count(*) ... FOR UPDATE` 를 썼다. Postgres 는 집계함수
--   (count) 결과에 FOR UPDATE 를 붙이는 것을 허용하지 않는다.
--
-- 수정
--   행 잠금 대신 트랜잭션 범위 advisory lock 으로 "같은 순위권 badge 에 대한
--   동시 진입" 을 직렬화한다. advisory lock 획득 후에는 잠금 없는 count 로
--   안전하게 순번을 센다. 락은 트랜잭션 종료 시 자동 해제된다.
--
--   · pg_advisory_xact_lock(key bigint) : 같은 key 는 한 트랜잭션만 통과.
--     key 는 순위권 badge_id(uuid) 를 hashtextextended 로 bigint 화해 사용.
--     스탯별로 다른 badge_id → 스탯별로 독립적인 직렬화(서로 안 막음).
--
-- 이중 안전망(그대로 유지)
--   · badge_awards 의 부분 유니크 인덱스 (badge_id, rank) WHERE rank IS NOT NULL
--     이 여전히 최종 방어선. advisory lock 이 어떤 이유로 무력해도 rank 중복은
--     인덱스가 막고, EXCEPTION 절이 일반 뱃지로 폴백한다.
--   · (badge_id, profile_id) 유니크로 같은 뱃지 중복 보유 방지 → ON CONFLICT skip.
--
-- 안정성
--   · CREATE OR REPLACE FUNCTION 이라 재실행 안전(idempotent). 시그니처 동일.
--   · 트리거(award_badge_on_level5)·트리거 부착은 건드리지 않는다. 이 함수만 교체.
--
-- 롤백
--   원본(2026-08-19_badge_system.sql)의 grant_stat_badge 정의로 되돌리면 되지만,
--   그 버전은 이 버그를 그대로 가지므로 되돌릴 이유는 없다.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

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

  -- 동시 도달 직렬화 : 이 순위권 badge 에 대한 트랜잭션 advisory lock.
  --   같은 스탯의 두 유저가 거의 동시에 Lv5 에 도달해도 순번 계산이 직렬화된다.
  --   서로 다른 스탯은 badge_id 가 달라 key 가 달라지므로 상호 차단하지 않는다.
  --   락은 트랜잭션 끝에 자동 해제.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_rank_badge_id::text, 0));

  -- 순위권 자리(rank 1~3) 카운트. (이제 잠금 없이 안전 — 집계 + FOR UPDATE 조합 없음)
  SELECT count(*) INTO v_taken
    FROM public.badge_awards
   WHERE badge_id = v_rank_badge_id
     AND rank IS NOT NULL;

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

COMMIT;

-- ────────────────────────────────────────────────────────────────────
-- 적용 후 확인
--   테스트 계정 스탯을 Lv5 로 올려 오류 없이 뱃지가 부여되는지:
-- UPDATE public.profiles SET rhythm_exp = 450 WHERE id = '<test-profile-id>';
-- SELECT ba.rank, b.code
--   FROM public.badge_awards ba JOIN public.badges b ON b.id = ba.badge_id
--  WHERE ba.profile_id = '<test-profile-id>';
-- ────────────────────────────────────────────────────────────────────
