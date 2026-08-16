-- sql/pending/2026-08-16_fix_gm_conv_msg_sender_cascade.sql
-- ═══════════════════════════════════════════════════════════════════
-- 유저 영구삭제 실패 수정 : gm_conversation_messages.sender_profile_id
--   FK 를 ON DELETE SET NULL → ON DELETE CASCADE 로 변경
-- ═══════════════════════════════════════════════════════════════════
--
-- 증상
--   GM 관리 → 유저 영구삭제(edge function gm-delete-user)가 500 으로 실패.
--   auth.admin.deleteUser() → profiles CASCADE 연쇄 도중 아래에서 막힘:
--     ERROR 23514: violates check constraint "gm_conv_msg_sender_shape"
--     CONTEXT: UPDATE ... SET sender_profile_id = NULL ...
--
-- 원인 (두 제약의 정면 충돌)
--   · FK  gm_conversation_messages_sender_profile_id_fkey :
--       ON DELETE SET NULL  → 유저 삭제 시 sender_profile_id 를 NULL 로 만듦.
--   · CHECK gm_conv_msg_sender_shape :
--       sender_role IN ('user','gm') 이면 sender_profile_id 는 NOT NULL 이어야 함.
--   → SET NULL 이 CHECK 를 위반 → 삭제 트랜잭션 전체 롤백 → 500.
--
-- 해결 (방법 A : FK 를 CASCADE 로)
--   유저가 삭제되면 그 유저가 보낸 메시지도 함께 삭제한다.
--   · 같은 테이블의 conversation_id FK 가 이미 ON DELETE CASCADE 이고,
--     부모 gm_conversations.user_profile_id 도 CASCADE 이다.
--     → 유저 삭제 시 대화방이 통째로 지워지므로, 그 안의 메시지도 함께
--       지워지는 것이 일관적이다(메시지만 남으면 고아 데이터).
--   · CHECK 위반도 사라진다(행을 NULL 로 바꾸는 대신 삭제하므로).
--
-- 영향 / 주의
--   · 삭제된 유저가 보낸 GM 채팅 메시지는 복구 불가로 함께 제거된다.
--     (기존에도 대화방 자체가 CASCADE 로 삭제되고 있었음 — 의미 변화 없음)
--   · 기존 데이터는 변경하지 않는다(제약 정의만 교체).
--   · edge function(gm-delete-user) 코드 변경 불필요.
--
-- 롤백 (원복이 필요하면)
--   ALTER TABLE public.gm_conversation_messages
--     DROP CONSTRAINT gm_conversation_messages_sender_profile_id_fkey;
--   ALTER TABLE public.gm_conversation_messages
--     ADD CONSTRAINT gm_conversation_messages_sender_profile_id_fkey
--     FOREIGN KEY (sender_profile_id) REFERENCES public.profiles(id)
--     ON DELETE SET NULL;
--   ※ 단, 원복하면 유저 삭제 실패 문제가 다시 발생한다.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 기존 SET NULL FK 제거
ALTER TABLE public.gm_conversation_messages
  DROP CONSTRAINT IF EXISTS gm_conversation_messages_sender_profile_id_fkey;

-- CASCADE 로 재생성 (컬럼·참조 대상은 동일, 삭제 규칙만 변경)
ALTER TABLE public.gm_conversation_messages
  ADD CONSTRAINT gm_conversation_messages_sender_profile_id_fkey
  FOREIGN KEY (sender_profile_id)
  REFERENCES public.profiles(id)
  ON DELETE CASCADE;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 검증
-- ═══════════════════════════════════════════════════════════════════
--
-- (1) FK 가 CASCADE 로 바뀌었는지 확인
--   SELECT conname, pg_get_constraintdef(oid) AS definition
--     FROM pg_constraint
--    WHERE conrelid = 'public.gm_conversation_messages'::regclass
--      AND contype = 'f';
--   → sender_profile_id_fkey 가 ON DELETE CASCADE 로 나오면 정상.
--
-- (2) 삭제 시뮬레이션(실제 삭제 없이 롤백). 막히지 않으면 성공.
--   BEGIN;
--     DELETE FROM profiles WHERE id = '056b3293-3e0b-42cd-b91a-0fc0385fc18c';
--   ROLLBACK;
--   → 에러 없이 "DELETE 1" 이면 해결. (여전히 auth.users 쪽에서 막히면
--     별도 조사 필요하나, 이번 원인은 이 FK 로 확인됨)
--
-- (3) 실제 삭제는 GM 관리 UI(gm-delete-user)를 통해 수행/검증할 것.
-- ═══════════════════════════════════════════════════════════════════
