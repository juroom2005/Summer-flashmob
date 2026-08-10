// lib/community-events-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// 공용 운영 일정 (community_events) 헬퍼
// ═══════════════════════════════════════════════════════════════════
//
// 모든 유저의 마이패널 달력에 표시되는 공용 일정.
// CRUD 는 supabase.from("community_events") 로 직접 처리한다.
// RLS 가 접근 통제 담당:
//   - SELECT : 익명 포함 누구나
//   - INSERT/UPDATE/DELETE : profiles.is_gm = true 유저만
//
// 서버 스키마: sql/pending/2026-08-07_calendar_tables.sql
//
// notices-helpers.ts 와 동일한 방어/에러 처리 패턴을 따른다.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// ────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────
export const MAX_EVENT_TITLE_LEN = 100;
export const MAX_EVENT_BODY_LEN  = 2000;
export const MAX_EVENT_ICON_LEN  = 8;   // DB CHECK 와 동일

/** 이 캘린더가 다루는 연도. 26년 한 해로 고정 (요구사항). */
export const CALENDAR_YEAR = 2026;

/** 아이콘 미지정 시 기본값 (DB DEFAULT 와 일치) */
export const DEFAULT_EVENT_ICON = "📌";

// ────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────
export type CommunityEvent = {
  id:        string;
  eventDate: string;   // "YYYY-MM-DD" (date 컬럼)
  title:     string;
  icon:      string;
  body:      string;
  authorId:  string | null;
  createdAt: string;
  updatedAt: string;
};

type CommunityEventRow = {
  id:         string;
  event_date: string;
  title:      string;
  icon:       string;
  body:       string;
  author_id:  string | null;
  created_at: string;
  updated_at: string;
};

export type CommunityEventInput = {
  eventDate: string;   // "YYYY-MM-DD"
  title:     string;
  icon:      string;
  body:      string;
};

export type CommunityEventMutationResult =
  | { ok: true; event: CommunityEvent }
  | { ok: false; reason: "validation" | "unauthorized" | "unknown"; message: string };

export type CommunityEventDeleteResult =
  | { ok: true }
  | { ok: false; message: string };

// ────────────────────────────────────────────────────────────────────
// 내부 유틸
// ────────────────────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toEvent(row: CommunityEventRow | null | undefined): CommunityEvent | null {
  if (!row) return null;
  if (typeof row.id !== "string" || row.id.length === 0) return null;
  if (typeof row.event_date !== "string" || !DATE_RE.test(row.event_date)) return null;
  if (typeof row.title !== "string") return null;
  return {
    id:        row.id,
    eventDate: row.event_date,
    title:     row.title,
    icon:      typeof row.icon === "string" && row.icon.length > 0 ? row.icon : DEFAULT_EVENT_ICON,
    body:      typeof row.body === "string" ? row.body : "",
    authorId:  row.author_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** "YYYY-MM-DD" 형식·실제 유효 날짜 여부 검증 */
function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  // 실제 존재하는 날짜인지 (예: 2026-02-30 배제)
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validate(input: CommunityEventInput): string | null {
  if (!isValidDateStr(input.eventDate)) {
    return "날짜 형식이 올바르지 않습니다.";
  }
  const title = input.title.trim();
  if (title.length < 1)                 return "제목을 입력해 주십시오.";
  if (title.length > MAX_EVENT_TITLE_LEN) return `제목은 ${MAX_EVENT_TITLE_LEN}자 이하로 입력해 주십시오.`;
  const icon = input.icon.trim();
  if (icon.length < 1)                  return "아이콘을 입력해 주십시오.";
  if (icon.length > MAX_EVENT_ICON_LEN) return `아이콘은 ${MAX_EVENT_ICON_LEN}자 이하로 입력해 주십시오.`;
  if (input.body.length > MAX_EVENT_BODY_LEN) {
    return `내용은 ${MAX_EVENT_BODY_LEN}자 이하로 입력해 주십시오.`;
  }
  return null;
}

function isRlsError(err: { code?: string; message?: string }): boolean {
  const code = err?.code ?? "";
  const msg  = (err?.message ?? "").toLowerCase();
  return code === "42501" || msg.includes("row-level security") || msg.includes("policy");
}

const SELECT_COLS =
  "id, event_date, title, icon, body, author_id, created_at, updated_at";

// ────────────────────────────────────────────────────────────────────
// 조회
// ────────────────────────────────────────────────────────────────────
/**
 * 지정 연도의 모든 공용 일정을 날짜 오름차순으로 반환.
 * 26년 한 해 고정이므로 기본값은 CALENDAR_YEAR.
 * 오류 시 빈 배열 + 콘솔 경고 (달력이 통째로 깨지지 않도록).
 */
export async function listCommunityEventsByYear(
  year: number = CALENDAR_YEAR,
): Promise<CommunityEvent[]> {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const { data, error } = await supabase
    .from("community_events")
    .select(SELECT_COLS)
    .gte("event_date", start)
    .lte("event_date", end)
    .order("event_date", { ascending: true });

  if (error) {
    console.warn("[community_events] list failed:", error);
    return [];
  }
  if (!Array.isArray(data)) return [];

  const result: CommunityEvent[] = [];
  for (const r of data as CommunityEventRow[]) {
    const e = toEvent(r);
    if (e) result.push(e);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────
// 생성 (GM)
// ────────────────────────────────────────────────────────────────────
export async function createCommunityEvent(
  input: CommunityEventInput,
): Promise<CommunityEventMutationResult> {
  const err = validate(input);
  if (err) return { ok: false, reason: "validation", message: err };

  // author_id 는 참고용. RLS 가 별도로 is_gm 검증.
  const { data: authData } = await supabase.auth.getUser();
  const authorId = authData?.user?.id ?? null;

  const { data, error } = await supabase
    .from("community_events")
    .insert({
      event_date: input.eventDate,
      title:      input.title.trim(),
      icon:       input.icon.trim(),
      body:       input.body.trim(),
      author_id:  authorId,
    })
    .select(SELECT_COLS)
    .single();

  if (error) {
    console.warn("[community_events] create failed:", error);
    if (isRlsError(error)) {
      return { ok: false, reason: "unauthorized", message: "권한이 없습니다." };
    }
    return { ok: false, reason: "unknown", message: "저장에 실패했습니다. 잠시 후 다시 시도해 주십시오." };
  }

  const event = toEvent(data as CommunityEventRow);
  if (!event) {
    return { ok: false, reason: "unknown", message: "저장은 완료되었으나 응답이 유효하지 않습니다." };
  }
  return { ok: true, event };
}

// ────────────────────────────────────────────────────────────────────
// 수정 (GM)
// ────────────────────────────────────────────────────────────────────
export async function updateCommunityEvent(
  id: string,
  input: CommunityEventInput,
): Promise<CommunityEventMutationResult> {
  const err = validate(input);
  if (err) return { ok: false, reason: "validation", message: err };

  const { data, error } = await supabase
    .from("community_events")
    .update({
      event_date: input.eventDate,
      title:      input.title.trim(),
      icon:       input.icon.trim(),
      body:       input.body.trim(),
    })
    .eq("id", id)
    .select(SELECT_COLS)
    .single();

  if (error) {
    console.warn("[community_events] update failed:", error);
    if (isRlsError(error)) {
      return { ok: false, reason: "unauthorized", message: "권한이 없습니다." };
    }
    return { ok: false, reason: "unknown", message: "수정에 실패했습니다." };
  }

  const event = toEvent(data as CommunityEventRow);
  if (!event) {
    return { ok: false, reason: "unknown", message: "수정은 완료되었으나 응답이 유효하지 않습니다." };
  }
  return { ok: true, event };
}

// ────────────────────────────────────────────────────────────────────
// 삭제 (GM)
// ────────────────────────────────────────────────────────────────────
export async function deleteCommunityEvent(
  id: string,
): Promise<CommunityEventDeleteResult> {
  const { error } = await supabase
    .from("community_events")
    .delete()
    .eq("id", id);

  if (error) {
    console.warn("[community_events] delete failed:", error);
    if (isRlsError(error)) {
      return { ok: false, message: "권한이 없습니다." };
    }
    return { ok: false, message: "삭제에 실패했습니다." };
  }
  return { ok: true };
}
