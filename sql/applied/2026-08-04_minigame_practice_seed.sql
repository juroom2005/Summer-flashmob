-- sql/pending/2026-08-04_minigame_practice_seed.sql
-- ═══════════════════════════════════════════════════════════════════
-- 연습실알바 미니게임 시드 데이터 : minigames 테이블 row 3 개 INSERT
-- ═══════════════════════════════════════════════════════════════════
--
-- 세션 L 개시. 카페알바 3종 (세션 J·K) 완성 후 연습실알바 3종 착수.
--
-- 도입되는 3 종 (모두 category='practice_room', target_stat='rhythm') :
--   · practice_clean : 청소       (반복형 · 별 1)
--                       카페 설거지 (cafe_dish) 로직 재사용 예정
--                       (드래그 재진입 채점 · 조기 종료 · 시간 초과 자동 채점)
--   · practice_stock : 재고 정리   (기억형 · 별 2)
--                       카페 음료 제조와 대칭 (물품·수량 정확도 채점)
--   · practice_setup : 장비 세팅   (순서·정밀형 · 별 3)
--                       카페 주문 받기와 대칭 (슬라이더 목표값 조정)
--
-- 카테고리 명명 :
--   minigames.category CHECK 제약이 'practice_room' 을 허용.
--   ('practice' 아님. 문서상 축약 표기가 있었으나 실제 값은 'practice_room')
--
-- 스탯 배정 방침 (v11 §2-2 · v12 §8-1 원안) :
--   · target_stat = 'rhythm' 통일. 연습실알바는 리듬감 + 체력 2 스탯 동시 상승.
--   · minigame_plays.target_stat 은 단일 값 컬럼이므로 주된 스탯인 rhythm 만
--     기록하고, 체력 exp 는 minigame_plays.result_detail.physical_gained 에
--     별도 저장 (카페 방식과 동일).
--
-- base_stat_gain / base_mobil_gain 필드의 의미 (UI 표시용 · 실제 지급은 RPC) :
--   · base_stat_gain  = 완주 시 지급되는 리듬감 exp (5) — 카페와 동일
--   · base_mobil_gain = 100 점 만점 시 (퍼펙트 보너스 미포함) mobil 상한
--     별 1 (clean)         : 2500  ← 축소 스케일 (아래 metadata 참조)
--     별 2 (stock) · 별 3 (setup) : 3000
--
-- metadata 필드 (RPC 가 참조) :
--   공통 :
--     · type            : 게임 유형 태그 (timed / memory / precision)
--     · physical_gain   : 완주 시 지급되는 체력 exp (참고값, RPC 최종 결정)
--     · perfect_bonus   : 100 점 도달 시 mobil 보너스 (참고값, RPC 최종 결정)
--     · description     : GM 화면 · UI 안내용
--     · difficulty      : 1/2/3 (별 개수, 리워드 계산 기준)
--     · mobil_bonus     : 완주 시 mobil 에 얹는 난이도 가산
--     · stat_bonus      : { "rhythm": 0..2, "physical": 0..2 }
--
--   게임별 고유 :
--     · time_limit_sec (clean · setup)
--     · items_min / items_max (stock)
--     · sliders_min / sliders_max (setup)
--
-- 난이도·리워드 배정 (카페와 대칭) :
--   ┌──────────────┬────┬───────────┬─────────────────────────────┐
--   │ 게임         │ 별 │ mobil 가산 │ 스탯 EXP 가산               │
--   ├──────────────┼────┼───────────┼─────────────────────────────┤
--   │ practice_clean │ ★  │ +0        │ 없음                        │
--   │ practice_stock │ ★★ │ +400      │ 리듬감 +1                   │
--   │ practice_setup │★★★│ +900      │ 리듬감 +1, 체력 +1          │
--   └──────────────┴────┴───────────┴─────────────────────────────┘
--
-- 만점 (100점) 시 최종 리워드 예상 (RPC 배포 후 실제 값) :
--   practice_clean (★)  : 2200 + 300(퍼펙트) + 0(난이도)    = 2500
--   practice_stock (★★) : 3000 + 300(퍼펙트) + 400(난이도)  = 3700
--   practice_setup (★★★): 3000 + 300(퍼펙트) + 900(난이도)  = 4200
--
--   카페 3종과 동일한 리워드 계층. 다음 마이그레이션 (2026-08-04_play_practice_minigame.sql)
--   의 RPC 가 practice_clean 별도 mobil 구간표 (설거지와 동일 축소) 적용.
--
-- 안전장치 :
--   · ON CONFLICT (code) DO NOTHING : 같은 code 로 이미 등록된 row 가 있으면
--     새 값으로 덮어쓰지 않고 건너뜀. 재실행 안전.
--     운영 중인 row 를 수정하려면 별도 UPDATE 마이그레이션으로 명시적 진행.
--   · minigames.code UNIQUE 제약 (minigames_code_key) 이 이미 있어 중복 물리적 차단.
--   · category CHECK : {stat_up, cafe, practice_room} 중 하나. 'practice_room' 은 허용됨.
--   · target_stat CHECK : {rhythm, physical, expression} 중 하나. 'rhythm' 허용됨.
--   · 트랜잭션 (BEGIN / COMMIT) 로 감쌈. 3 row 모두 성공하거나 모두 실패.
--
-- 롤백 :
--   DELETE FROM public.minigames
--    WHERE code IN ('practice_clean','practice_stock','practice_setup');
--   (minigame_plays 는 ON DELETE CASCADE 로 함께 정리됨. 운영 시작 후에는 신중히.)
--
-- 선행 마이그레이션 :
--   sql/applied/2026-07-24_stat_level_migration.sql (profiles.rhythm_exp 컬럼)
-- 후행 마이그레이션 :
--   sql/pending/2026-08-04_play_practice_minigame.sql (연습실 전용 RPC)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- practice_clean : 청소 (반복형 · 별 1)
--   카페 설거지와 대칭. 클라이언트 로직도 CafeDishGame 재사용 예정.
--   실질 상한 : mobil 2,500 (RPC 에서 축소 구간표 적용)
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.minigames
  (code, name, category, subtype, target_stat,
   base_stat_gain, base_mobil_gain, is_active, metadata)
VALUES
  ('practice_clean', '연습실 청소', 'practice_room', 'clean', 'rhythm',
   5, 2500, true,
   jsonb_build_object(
     'type',           'timed',
     'physical_gain',  8,
     'perfect_bonus',  300,
     'time_limit_sec', 15,
     'difficulty',     1,
     'mobil_bonus',    0,
     'stat_bonus',     jsonb_build_object('rhythm', 0, 'physical', 0),
     'description',    '연습실 바닥의 먼지 뭉치를 제한 시간 안에 깨끗이 청소합니다.'
   ))
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- practice_stock : 재고 정리 (기억형 · 별 2)
--   카페 음료 제조와 대칭. 물품·수량 정확도 채점.
--   세부 스펙 (품목 리스트 · 채점 방식) 은 세션 L 중반에 확정.
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.minigames
  (code, name, category, subtype, target_stat,
   base_stat_gain, base_mobil_gain, is_active, metadata)
VALUES
  ('practice_stock', '재고 정리', 'practice_room', 'stock', 'rhythm',
   5, 3000, true,
   jsonb_build_object(
     'type',          'memory',
     'physical_gain', 8,
     'perfect_bonus', 300,
     'items_min',     3,
     'items_max',     5,
     'difficulty',    2,
     'mobil_bonus',   400,
     'stat_bonus',    jsonb_build_object('rhythm', 1, 'physical', 0),
     'description',   '재고 노트의 물품 목록을 확인하고 선반에서 정확한 수량을 정리합니다.'
   ))
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- practice_setup : 장비 세팅 (정밀형 · 별 3)
--   카페 주문 받기와 대칭. 슬라이더 여러 개를 목표값으로 조정.
--   세부 스펙 (슬라이더 개수 · 오차 채점) 은 세션 L 후반에 확정.
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.minigames
  (code, name, category, subtype, target_stat,
   base_stat_gain, base_mobil_gain, is_active, metadata)
VALUES
  ('practice_setup', '장비 세팅', 'practice_room', 'setup', 'rhythm',
   5, 3000, true,
   jsonb_build_object(
     'type',          'precision',
     'physical_gain', 8,
     'perfect_bonus', 300,
     'sliders_min',   3,
     'sliders_max',   5,
     'difficulty',    3,
     'mobil_bonus',   900,
     'stat_bonus',    jsonb_build_object('rhythm', 1, 'physical', 1),
     'description',   '음향·조명 슬라이더를 제한 시간 안에 목표값에 맞춰 조정합니다.'
   ))
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인 (수동 검증용)
-- ─────────────────────────────────────────────────────────────────────
-- SELECT code, name, category, subtype, target_stat,
--        base_stat_gain, base_mobil_gain, is_active,
--        metadata->>'difficulty'  AS difficulty,
--        metadata->>'mobil_bonus' AS mobil_bonus,
--        metadata->'stat_bonus'   AS stat_bonus
--   FROM public.minigames
--  WHERE category = 'practice_room'
--  ORDER BY (metadata->>'difficulty')::int;
-- ═══════════════════════════════════════════════════════════════════
