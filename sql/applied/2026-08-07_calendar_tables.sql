-- sql/pending/2026-08-07_calendar_tables.sql
-- ═══════════════════════════════════════════════════════════════════
-- 마이패널 캘린더 실기능화 : community_events + personal_memos 신설
-- ═══════════════════════════════════════════════════════════════════
--
-- 배경 :
--   현재 MyPanel 달력은 전부 더미다.
--     · 공용 일정(events)  : DEFAULT_EVENTS 하드코딩
--     · 개인 메모(memos)   : 컴포넌트 생명주기 로컬 state (새로고침 시 소멸)
--   이를 DB 이관한다. 두 성격이 완전히 다르므로 테이블·정책을 분리한다.
--
--   (A) community_events — 웹사이트 운영 일정
--       · 모든 유저의 마이패널 달력에 표시되는 공용 일정
--       · GM 탭(일정 관리)에서 GM 이 CRUD
--       · 성격상 공개 정보 → notices 패턴 그대로 (public read, GM write)
--
--   (B) personal_memos — 개인 일정 / 혼잣말
--       · 유저 개인이 자기 달력에만 남기는 메모
--       · "운영자가 쉽게 들여다보면 안 된다" 요구
--       · 방침 : DB 평문 저장 + RLS 로 본인만 접근 (합의된 옵션 1)
--         - anon / authenticated 경로로는 본인 auth.uid() 행만 조회 가능
--         - notices / shop_items 와 달리 GM 우회 정책을 붙이지 않는다
--           → GM 이라도 앱 경로로는 타인의 메모를 볼 수 없다
--         - 한계 : service_role (DB 콘솔 직접 접근) 은 RLS 우회 → 사전 합의됨
--
-- 방침 (세션 G notices 정책 방식 계승) :
--   · RLS 로만 접근 통제 (별도 RPC 없이 .from() 직접 CRUD)
--   · community_events : public SELECT + GM (is_gm=true) write
--   · personal_memos   : owner-only (auth.uid() = 소유 profile 의 user_id)
--
-- 안전장치 :
--   · CREATE POLICY 는 IF NOT EXISTS 미지원 → 재실행 대비 DROP 선행
--   · CREATE TABLE IF NOT EXISTS 로 재실행 안전
--   · 트랜잭션 (BEGIN / COMMIT) 으로 부분 적용 방지
--   · updated_at 자동 갱신은 기존 set_updated_at() 트리거 함수 재사용
--
-- 선행 마이그레이션 : 없음
-- 후행 영향 :
--   · lib/community-events-helpers.ts (신설) 이 community_events 위에서 동작
--   · lib/personal-memos-helpers.ts   (신설) 이 personal_memos 위에서 동작
--   · components/gm/events/GmEventsTab.tsx (신설) — GM 일정 관리 탭
--   · components/noticeboard/panels/MyPanel.tsx (수정) — 달력 DB 연동
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- (A) community_events — 공용 운영 일정
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.community_events (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_date  date        NOT NULL,
  title       text        NOT NULL,
  icon        text        NOT NULL DEFAULT '📌',
  body        text        NOT NULL DEFAULT '',
  author_id   uuid        NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT community_events_pkey PRIMARY KEY (id),
  CONSTRAINT community_events_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL,

  -- 길이 제약 : notices 와 동일 계열 (title 100, body 2000)
  CONSTRAINT community_events_title_len_check
    CHECK (char_length(title) >= 1 AND char_length(title) <= 100),
  CONSTRAINT community_events_body_len_check
    CHECK (char_length(body) >= 0 AND char_length(body) <= 2000),
  -- icon : 이모지 1~4자 정도 허용 (grapheme 정밀검증은 클라이언트 몫)
  CONSTRAINT community_events_icon_len_check
    CHECK (char_length(icon) >= 1 AND char_length(icon) <= 8)
);

-- 조회 인덱스 : 월 범위 조회 (event_date BETWEEN ... AND ...) 대응
CREATE INDEX IF NOT EXISTS community_events_date_idx
  ON public.community_events USING btree (event_date);

ALTER TABLE public.community_events ENABLE ROW LEVEL SECURITY;

-- 재실행 대비 DROP
DROP POLICY IF EXISTS community_events_public_read ON public.community_events;
DROP POLICY IF EXISTS community_events_gm_insert   ON public.community_events;
DROP POLICY IF EXISTS community_events_gm_update    ON public.community_events;
DROP POLICY IF EXISTS community_events_gm_delete    ON public.community_events;

-- 공개 조회 (익명 포함)
CREATE POLICY community_events_public_read
  ON public.community_events
  FOR SELECT
  TO public
  USING (true);

-- GM 생성
CREATE POLICY community_events_gm_insert
  ON public.community_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_gm = true
    )
  );

-- GM 수정
CREATE POLICY community_events_gm_update
  ON public.community_events
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_gm = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_gm = true
    )
  );

-- GM 삭제
CREATE POLICY community_events_gm_delete
  ON public.community_events
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_gm = true
    )
  );

-- updated_at 자동 갱신 트리거 (기존 함수 재사용)
DROP TRIGGER IF EXISTS community_events_set_updated_at ON public.community_events;
CREATE TRIGGER community_events_set_updated_at
  BEFORE UPDATE ON public.community_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ════════════════════════════════════════════════════════════════════
-- (B) personal_memos — 개인 메모 (owner-only)
-- ════════════════════════════════════════════════════════════════════
--   소유 판정은 profile_id → profiles.user_id = auth.uid() 로 한다.
--   (mobil_grants_own_select 와 동일한 방식: profile_id IN (내 profile))
--   하루에 여러 메모 허용 (UNIQUE 제약 없음). 삭제/수정은 id 단위.
CREATE TABLE IF NOT EXISTS public.personal_memos (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL,
  memo_date   date        NOT NULL,
  body        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT personal_memos_pkey PRIMARY KEY (id),
  CONSTRAINT personal_memos_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT personal_memos_body_len_check
    CHECK (char_length(body) >= 1 AND char_length(body) <= 1000)
);

-- 조회 인덱스 : 특정 유저의 월 범위 메모 조회
CREATE INDEX IF NOT EXISTS personal_memos_profile_date_idx
  ON public.personal_memos USING btree (profile_id, memo_date);

ALTER TABLE public.personal_memos ENABLE ROW LEVEL SECURITY;

-- 재실행 대비 DROP
DROP POLICY IF EXISTS personal_memos_own_select ON public.personal_memos;
DROP POLICY IF EXISTS personal_memos_own_insert ON public.personal_memos;
DROP POLICY IF EXISTS personal_memos_own_update ON public.personal_memos;
DROP POLICY IF EXISTS personal_memos_own_delete ON public.personal_memos;

-- 소유자 조회 (GM 우회 없음: 본인만)
CREATE POLICY personal_memos_own_select
  ON public.personal_memos
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  );

-- 소유자 생성 : 넣는 profile_id 가 본인 것이어야 함
CREATE POLICY personal_memos_own_insert
  ON public.personal_memos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  );

-- 소유자 수정 : 대상·결과 모두 본인 것
CREATE POLICY personal_memos_own_update
  ON public.personal_memos
  FOR UPDATE
  TO authenticated
  USING (
    profile_id IN (
      SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    profile_id IN (
      SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  );

-- 소유자 삭제
CREATE POLICY personal_memos_own_delete
  ON public.personal_memos
  FOR DELETE
  TO authenticated
  USING (
    profile_id IN (
      SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  );

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS personal_memos_set_updated_at ON public.personal_memos;
CREATE TRIGGER personal_memos_set_updated_at
  BEFORE UPDATE ON public.personal_memos
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- 실행 확인 쿼리 (수동 검증용)
-- ─────────────────────────────────────────────────────────────────────
-- SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('community_events', 'personal_memos')
--  ORDER BY tablename, policyname;
--
-- 소유 격리 확인 (유저 A 세션에서 실행 시 타인 메모 0건이어야 함):
-- SELECT count(*) FROM public.personal_memos;   -- 본인 것만 카운트됨
-- ═══════════════════════════════════════════════════════════════════
