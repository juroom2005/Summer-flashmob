-- sql/pending/2026-08-07_minigame_rhythm_seed.sql
-- ═══════════════════════════════════════════════════════════════════
-- 리듬게임 시드 데이터 : minigames 테이블에 row 1 개 INSERT
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 (세션 M) :
--   세션 L 에서 연습실 3종 완성. 세션 M 은 리듬게임 착수.
--   원안 (v8 §2-3 · §2-4) 을 정확히 반영한다는 방침.
--
-- 리듬게임 = 알바와 다른 트레이드 :
--   ┌──────────────┬──────────┬──────────┬──────────┐
--   │              │ 스탯 exp │  체력 exp │  mobil   │
--   ├──────────────┼──────────┼──────────┼──────────┤
--   │ 카페 알바    │ 5~7      │ 8~10     │ 3000+    │
--   │ 연습실 알바  │ 5~7      │ 8~10     │ 3000+    │
--   │ 리듬게임     │ 18~30    │ 7~12     │ 0        │← 이 파일
--   └──────────────┴──────────┴──────────┴──────────┘
--   알바 = mobil 위주 · 스탯 소량
--   리듬 = mobil 없음 · 스탯 대량 (알바의 3~5배)
--
-- 도입되는 1 종 :
--   · rhythm : 리듬 세션 (category='rhythm_game', 별 3)
--     기본 곡 1 개. 곡 교체 · 추가는 metadata.songs 배열 확장으로.
--     (곡별 row 분리는 추후 재검토, 초안은 단일 row · 곡 배열 방식)
--
-- 스탯 배정 방침 (v8 §2-3 원안) :
--   · 시작 전 스탯 선택 UI (리듬감 / 표현력) → 그 스탯이 대량 상승
--   · RPC 는 p_selected_stat 매개변수 받아 해당 컬럼만 UPDATE
--     (rhythm_exp 또는 expression_exp)
--   · target_stat 컬럼은 기본 'rhythm' 표기 (마스터 조회용).
--     minigame_plays.target_stat 에는 실제 선택된 스탯이 기록됨.
--
-- base_stat_gain / base_mobil_gain 필드 의미 :
--   · base_stat_gain  = 24 (18~30 중앙값, UI 표시용 참고값. 실제는 RPC 구간표)
--   · base_mobil_gain = 0  (원안 : 리듬게임은 mobil 지급 없음)
--
-- metadata 필드 :
--   공통 :
--     · type          : 'rhythm' (게임 유형 태그)
--     · difficulty    : 3 (별 개수, UI 표시용)
--     · mobil_bonus   : 0 (mobil 없음)
--     · description   : GM 화면 · UI 안내용
--
--   리듬게임 고유 :
--     · duration_sec  : 곡 총 재생 시간 (완주 검증용)
--     · note_count    : 노트 총 개수 (참고값)
--     · selected_stat_range : { min: 18, max: 30 }  선택 스탯 exp 구간
--     · physical_range      : { min:  7, max: 12 }  체력 exp 구간
--     · songs               : 곡 목록 배열
--        [{
--          id: 'song_1',
--          title: '기본 곡',
--          audio_url: '/audio/rhythm/song_1.mp3',
--          duration_sec: 30,
--          note_count: 25
--        }]
--
-- RPC 참조 방식 :
--   · v_selected_stat_min = (metadata->'selected_stat_range'->>'min')::int
--   · v_selected_stat_max = (metadata->'selected_stat_range'->>'max')::int
--   · 점수 구간표는 RPC 안에서 계산 (하드코딩 아닌 metadata 기반)
--
-- 스탯 지급표 (RPC 구간표, 참고 · 세부는 RPC 파일에서 확정) :
--   score >= 90 : selected +30, physical +12   ← 원안 상한 (퍼펙트)
--   score >= 70 : selected +26, physical +11
--   score >= 50 : selected +22, physical +9
--   score <  50 : selected +18, physical +7   ← 원안 하한 (완주만)
--
-- 안전장치 :
--   · ON CONFLICT (code) DO NOTHING : 재실행 안전
--   · minigames.code UNIQUE 제약 존재
--   · category CHECK : 선행 마이그레이션에서 'rhythm_game' 허용 확장 필수
--   · target_stat CHECK : { rhythm, physical, expression } 중 'rhythm' 허용
--   · 트랜잭션 감쌈
--
-- 롤백 :
--   DELETE FROM public.minigames WHERE code = 'rhythm';
--   (minigame_plays 는 ON DELETE CASCADE 로 함께 정리됨. 운영 시작 후 신중히)
--
-- 선행 마이그레이션 :
--   sql/pending/2026-08-07_minigame_rhythm_category_check.sql (반드시 먼저 apply)
-- 후행 마이그레이션 :
--   sql/pending/2026-08-07_play_rhythm_minigame.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.minigames
  (code, name, category, subtype, target_stat,
   base_stat_gain, base_mobil_gain, is_active, metadata)
VALUES
  ('rhythm', '리듬 세션', 'rhythm_game', 'rhythm', 'rhythm',
   24, 0, true,
   jsonb_build_object(
     'type',                  'rhythm',
     'difficulty',            3,
     'mobil_bonus',           0,
     'description',           '노트에 맞춰 박자를 치고, 원하는 스탯을 대량으로 성장시킵니다.',
     'duration_sec',          30,
     'note_count',            25,
     'selected_stat_range',   jsonb_build_object('min', 18, 'max', 30),
     'physical_range',        jsonb_build_object('min',  7, 'max', 12),
     'songs',                 jsonb_build_array(
       jsonb_build_object(
         'id',           'song_1',
         'title',        '기본 곡',
         'audio_url',    '/audio/rhythm/song_1.mp3',
         'duration_sec', 30,
         'note_count',   25
       )
     )
   ))
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인
-- ─────────────────────────────────────────────────────────────────────
-- 1) row 확인
--   SELECT code, name, category, subtype, target_stat,
--          base_stat_gain, base_mobil_gain, is_active,
--          metadata->>'difficulty' AS difficulty,
--          metadata->>'mobil_bonus' AS mobil_bonus,
--          metadata->'selected_stat_range' AS sel_range,
--          metadata->'physical_range' AS phys_range,
--          jsonb_array_length(metadata->'songs') AS song_count
--     FROM public.minigames
--    WHERE category = 'rhythm_game';
--
-- 2) 곡 목록 상세
--   SELECT s->>'id' AS song_id,
--          s->>'title' AS title,
--          s->>'audio_url' AS url,
--          s->>'duration_sec' AS dur,
--          s->>'note_count' AS notes
--     FROM public.minigames,
--          jsonb_array_elements(metadata->'songs') AS s
--    WHERE code = 'rhythm';
--
-- 3) 카테고리별 게임 개수 (전체 상황)
--   SELECT category, count(*) FROM public.minigames GROUP BY category ORDER BY category;
-- ═══════════════════════════════════════════════════════════════════
