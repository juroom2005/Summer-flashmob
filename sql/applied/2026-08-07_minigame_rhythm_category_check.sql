-- sql/pending/2026-08-07_minigame_rhythm_category_check.sql
-- ═══════════════════════════════════════════════════════════════════
-- minigames.category CHECK 제약 확장 : 'rhythm_game' 허용값 추가
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 (세션 M) :
--   세션 L 종료 시점 category CHECK 는 { stat_up, cafe, practice_room } 만
--   허용. 리듬게임 seed 진입 전 이 제약 확장 필요.
--
-- 리듬게임을 practice_room 카테고리 안에 통합하지 않고 별도 카테고리로
-- 두는 이유 :
--   · 원안 (v8 §2-1) 상 3분류 (카페 · 연습실 · 리듬) 로 명시 · 유지
--   · 스탯 지급 방식이 근본 차이 (알바=고정 스탯, 리듬=선택 스탯)
--   · mobil 지급 방식 근본 차이 (알바=3000+, 리듬=0)
--   · RPC 분리로 안정성 확보 (세션 L 확립한 원칙)
--
-- 변경 내용 :
--   기존 : CHECK (category = ANY (ARRAY['stat_up', 'cafe', 'practice_room']))
--   신규 : CHECK (category = ANY (ARRAY['stat_up', 'cafe', 'practice_room', 'rhythm_game']))
--
-- 후행 마이그레이션 :
--   sql/pending/2026-08-07_minigame_rhythm_seed.sql  (이 파일 apply 후 진행)
--   sql/pending/2026-08-07_play_rhythm_minigame.sql
--
-- 안전장치 :
--   · 트랜잭션 (BEGIN/COMMIT) 감쌈
--   · 기존 제약 DROP CONSTRAINT IF EXISTS 로 재실행 안전
--   · 기존 row (cafe / practice_room) 는 새 제약 하에서도 유효 → 데이터 영향 없음
--
-- 롤백 :
--   ALTER TABLE public.minigames DROP CONSTRAINT IF EXISTS minigames_category_check;
--   ALTER TABLE public.minigames ADD CONSTRAINT minigames_category_check
--     CHECK (category = ANY (ARRAY['stat_up'::text, 'cafe'::text, 'practice_room'::text]));
--   ※ 롤백 전 rhythm_game 카테고리 row 존재 여부 확인 필수
--     (있으면 삭제 or 다른 카테고리로 이관 선행)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.minigames
  DROP CONSTRAINT IF EXISTS minigames_category_check;

ALTER TABLE public.minigames
  ADD CONSTRAINT minigames_category_check
  CHECK (
    category = ANY (
      ARRAY['stat_up'::text, 'cafe'::text, 'practice_room'::text, 'rhythm_game'::text]
    )
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인
-- ─────────────────────────────────────────────────────────────────────
-- 1) 제약 재확인
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.minigames'::regclass
--      AND conname = 'minigames_category_check';
--
-- 2) 기존 row 무해 확인
--   SELECT category, count(*)
--     FROM public.minigames
--    GROUP BY category
--    ORDER BY category;
-- ═══════════════════════════════════════════════════════════════════
