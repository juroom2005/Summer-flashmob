-- sql/pending/2026-07-29_minigame_cafe_seed.sql
-- ═══════════════════════════════════════════════════════════════════
-- 카페알바 미니게임 시드 데이터 : minigames 테이블 row 3 개 INSERT
-- ═══════════════════════════════════════════════════════════════════
--
-- 세션 J 개시. flashmob 첫 미니게임 실구현 (카페알바) 의 마스터 데이터.
--
-- 도입되는 3 종 (모두 category='cafe', target_stat='expression') :
--   · cafe_order : 주문 받기  (기억형 · 손님이 요청한 옵션 순서대로 버튼 클릭)
--   · cafe_mix   : 음료 제조  (순서형 · 레시피 레이어 순서대로 쌓기)
--   · cafe_dish  : 설거지    (시간제한 · 시간 안에 접시 오염도 감소)
--
-- 스탯 배정 방침 (v8 §2-4 원안 유지) :
--   · target_stat = 'expression' 통일. 카페알바는 표현력 + 체력 2 스탯 동시 상승.
--   · minigame_plays.target_stat 은 단일 값 컬럼이므로 주된 스탯인 expression 만
--     기록하고, 체력 exp 는 minigame_plays.result_detail.physical_gained 에
--     별도 저장하도록 후행 RPC 에서 처리.
--
-- base_stat_gain / base_mobil_gain 필드의 의미 :
--   · UI 안내 · GM 관리 화면 표시용 참고값. 실제 지급량은 후행 RPC 에서 계산.
--   · base_stat_gain  = 완주 시 지급되는 표현력 exp (5)
--   · base_mobil_gain = 100 점 만점 시 (퍼펙트 보너스 미포함) mobil 상한 (3000)
--
-- metadata 필드의 의미 (UI 파라미터 참조용) :
--   · type            : 게임 유형 태그 (memory / sequence / timed)
--   · physical_gain   : 완주 시 지급되는 체력 exp (RPC 가 최종 결정. 참고값)
--   · perfect_bonus   : 100 점 도달 시 mobil 보너스 (RPC 가 최종 결정. 참고값)
--   · (미니게임별 고유 파라미터) : orders_per_round · layers_min/max · time_limit_sec
--
-- 안전장치 :
--   · ON CONFLICT (code) DO NOTHING : 같은 code 로 이미 등록된 row 가 있으면
--     새 값으로 덮어쓰지 않고 건너뜀. 재실행 안전.
--     운영 중인 row 를 수정하려면 별도 UPDATE 마이그레이션으로 명시적 진행.
--   · minigames.code UNIQUE 제약 (minigames_code_key) 이 이미 있어 중복 물리적 차단.
--   · category CHECK : {stat_up, cafe, practice_room} 중 하나. 'cafe' 는 허용됨.
--   · target_stat CHECK : {rhythm, physical, expression} 중 하나. 'expression' 허용됨.
--   · 트랜잭션 (BEGIN / COMMIT) 로 감쌈. 3 row 모두 성공하거나 모두 실패.
--
-- 롤백 :
--   DELETE FROM public.minigames
--    WHERE code IN ('cafe_order','cafe_mix','cafe_dish');
--   (minigame_plays 는 ON DELETE CASCADE 로 함께 정리됨. 운영 시작 후에는 신중히.)
--
-- 선행 마이그레이션 : 없음 (minigames 테이블 자체는 2026-07-24 이전 스키마)
-- 후행 마이그레이션 : 2026-07-29_minigame_cafe_rpcs.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- cafe_order : 주문 받기 (기억형)
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.minigames
  (code, name, category, subtype, target_stat,
   base_stat_gain, base_mobil_gain, is_active, metadata)
VALUES
  ('cafe_order', '주문 받기', 'cafe', 'order', 'expression',
   5, 3000, true,
   jsonb_build_object(
     'type', 'memory',
     'physical_gain', 8,
     'perfect_bonus', 300,
     'orders_per_round', 2,
     'description', '손님이 부르는 옵션 순서대로 정확히 버튼을 눌러 주문을 받습니다.'
   ))
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- cafe_mix : 음료 제조 (순서형)
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.minigames
  (code, name, category, subtype, target_stat,
   base_stat_gain, base_mobil_gain, is_active, metadata)
VALUES
  ('cafe_mix', '음료 제조', 'cafe', 'mix', 'expression',
   5, 3000, true,
   jsonb_build_object(
     'type', 'sequence',
     'physical_gain', 8,
     'perfect_bonus', 300,
     'layers_min', 3,
     'layers_max', 5,
     'description', '주어진 레시피 순서대로 재료를 쌓아 음료를 완성합니다. 순서가 어긋난 만큼 점수가 낮아집니다.'
   ))
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- cafe_dish : 설거지 (시간제한)
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.minigames
  (code, name, category, subtype, target_stat,
   base_stat_gain, base_mobil_gain, is_active, metadata)
VALUES
  ('cafe_dish', '설거지', 'cafe', 'dish', 'expression',
   5, 3000, true,
   jsonb_build_object(
     'type', 'timed',
     'physical_gain', 8,
     'perfect_bonus', 300,
     'time_limit_sec', 15,
     'description', '제한 시간 안에 접시의 오염도를 최대한 감소시켜 깨끗하게 닦아냅니다.'
   ))
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인 (수동 검증용)
-- ─────────────────────────────────────────────────────────────────────
-- SELECT code, name, category, subtype, target_stat,
--        base_stat_gain, base_mobil_gain, is_active, metadata
--   FROM public.minigames
--  WHERE category = 'cafe'
--  ORDER BY code;
-- ═══════════════════════════════════════════════════════════════════
