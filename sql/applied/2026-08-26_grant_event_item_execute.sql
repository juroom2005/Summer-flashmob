-- sql/pending/2026-08-26_grant_event_item_execute.sql
-- ═══════════════════════════════════════════════════════════════════
-- 2026-08-26  신규 함수 실행권 보강 (GRANT-only)
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 : 2026-08-26_action_refill_markers_event_items.sql 로 만든 신규 함수
--        use_action_refill / use_event_item 은 프론트가 직접 rpc 로 호출하는데,
--        해당 마이그에 GRANT EXECUTE 가 빠져 있었다. 프로젝트 관례상 직접 호출
--        함수는 authenticated 에 실행권을 명시한다(gift_inbox 등과 동일).
--
-- 안전성 :
--   · GRANT 만 수행. 함수 정의·본문은 일절 건드리지 않음 → 회귀 없음.
--   · 이미 권한이 있어도 GRANT 재실행은 무해(멱등).
--   · 기존 미니게임 RPC(play_*, get_today_*, gm_get_*)는 CREATE OR REPLACE 가
--     기존 권한을 보존하므로 손대지 않는다(여기서 GRANT 하지 않음).
--   · minigame_daily_limit 는 다른 RPC 가 내부 호출만 하지만, 혹시 모를 직접
--     참조·디버깅을 위해 authenticated 에도 실행권을 준다(부작용 없음).
--
-- 롤백(수동, 보통 불필요) :
--   REVOKE EXECUTE ON FUNCTION public.use_action_refill()        FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION public.use_event_item(text)       FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION public.minigame_daily_limit(uuid,date) FROM authenticated;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.use_action_refill()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_event_item(text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.minigame_daily_limit(uuid, date)     TO authenticated;

COMMIT;
