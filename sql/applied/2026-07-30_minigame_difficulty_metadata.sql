-- sql/pending/2026-07-30_minigame_difficulty_metadata.sql
-- ═══════════════════════════════════════════════════════════════════
-- 카페 미니게임 난이도·가산 메타데이터 심기
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 (세션 J-α) :
--   게임별 난이도 차이를 리워드에 반영. 어려운 게임일수록 mobil 가산 +
--   소량의 스탯 EXP 가산. 스탯 밸런스는 유지해야 하므로 스탯 가산은 미미.
--
-- 확정 배정 :
--   ┌───────────┬────┬───────────┬───────────────────────────────────┐
--   │ 게임      │ 별 │ mobil 가산 │ 스탯 EXP 가산                     │
--   ├───────────┼────┼───────────┼───────────────────────────────────┤
--   │ 설거지    │ ★  │ +0        │ 없음                              │
--   │ 음료 제조 │ ★★ │ +400      │ 표현력 +1                         │
--   │ 주문 받기 │★★★│ +900      │ 표현력 +1, 체력 +1                │
--   └───────────┴────┴───────────┴───────────────────────────────────┘
--
-- 데이터 구조 :
--   minigames.metadata JSONB 필드에 아래 세 키를 추가.
--     · difficulty  : 1/2/3 (별 개수)
--     · mobil_bonus : 완주 시 지급 mobil 에 얹는 가산
--     · stat_bonus  : { "expression": 0..2, "physical": 0..2 }
--
--   기존 metadata 값(type · description · orders_per_round 등) 은 그대로
--   유지되고 위 세 키가 병합(||)된다.
--
-- 안전장치 :
--   · || 연산자로 병합 → 기존 키 보존, 신규 키만 추가/덮어씀
--   · WHERE code = ... 로 대상 명확화. 실수로 다른 row 갱신 방지
--   · 트랜잭션 (BEGIN / COMMIT) : 3 UPDATE 가 모두 성공 or 모두 실패
--
-- 재실행 안전성 :
--   · || 는 idempotent. 같은 값 다시 병합해도 결과 동일. 재실행 안전.
--
-- 롤백 :
--   UPDATE public.minigames
--      SET metadata = metadata - 'difficulty' - 'mobil_bonus' - 'stat_bonus'
--    WHERE code IN ('cafe_order','cafe_mix','cafe_dish');
--
-- 선행 마이그레이션 :
--   sql/applied/2026-07-29_minigame_cafe_seed.sql
-- 후행 마이그레이션 :
--   sql/pending/2026-07-30_play_cafe_minigame_with_difficulty.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 설거지 : ★
UPDATE public.minigames
   SET metadata = metadata || jsonb_build_object(
         'difficulty',  1,
         'mobil_bonus', 0,
         'stat_bonus',  jsonb_build_object('expression', 0, 'physical', 0)
       )
 WHERE code = 'cafe_dish';

-- 음료 제조 : ★★
UPDATE public.minigames
   SET metadata = metadata || jsonb_build_object(
         'difficulty',  2,
         'mobil_bonus', 400,
         'stat_bonus',  jsonb_build_object('expression', 1, 'physical', 0)
       )
 WHERE code = 'cafe_mix';

-- 주문 받기 : ★★★
UPDATE public.minigames
   SET metadata = metadata || jsonb_build_object(
         'difficulty',  3,
         'mobil_bonus', 900,
         'stat_bonus',  jsonb_build_object('expression', 1, 'physical', 1)
       )
 WHERE code = 'cafe_order';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인 (수동 검증용)
-- ─────────────────────────────────────────────────────────────────────
-- SELECT code, name,
--        metadata->>'difficulty'  AS difficulty,
--        metadata->>'mobil_bonus' AS mobil_bonus,
--        metadata->'stat_bonus'   AS stat_bonus
--   FROM public.minigames
--  WHERE code IN ('cafe_order','cafe_mix','cafe_dish')
--  ORDER BY (metadata->>'difficulty')::int;
-- ═══════════════════════════════════════════════════════════════════
