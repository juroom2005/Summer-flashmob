// lib/attendance-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// 출석 커맨드 헬퍼
// ═══════════════════════════════════════════════════════════════════
//
// RPC 래퍼:
//   - checkTodayAttended       : 오늘(KST) 이미 출석했는지 조회
//   - attendToday(message?)    : 출석 실행. 성공 시 500 모빌 지급
//                                한마디 message 가 있으면 attendance_messages 에 저장
//   - listAttendanceMessages() : 한마디 리스트를 최신순으로 조회
//
// 서버 RPC 정의:
//   - sql/2026-07-23_attendance.sql
//   - sql/2026-07-23_attendance_messages.sql
// KST 날짜 계산은 서버 default 에 위임. 클라이언트에서 시간대를 다루지 않음.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// ────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────
export type AttendFailReason =
  | "not_authenticated"
  | "already_attended"
  | "no_profile"
  | "unknown";

export type AttendSuccess = {
  ok: true;
  attendedDate: string; // "YYYY-MM-DD" (KST)
  newMobil: number;
  reward: number;
};

export type AttendFailure = {
  ok: false;
  reason: AttendFailReason;
  currentMobil?: number;
  reward: number;
};

export type AttendResult = AttendSuccess | AttendFailure;

export type AttendanceMessage = {
  id: string;
  profileId: string;
  displayName: string | null; // GM 처럼 이름이 비어있으면 null
  message: string;
  createdAt: string;          // ISO 문자열
};

export type AttendanceDate = {
  date: string;      // "YYYY-MM-DD" (KST)
  msgCount: number;
};

// RPC 응답 원본 (안전한 파싱을 위한 좁은 타입)
type AttendTodayRow = {
  ok: boolean | null;
  attended_date: string | null;
  new_mobil: number | null;
  reward: number | null;
  reason: string | null;
};

type ListAttendanceRow = {
  id: string;
  profile_id: string;
  display_name: string | null;
  message: string;
  created_at: string;
};

const DEFAULT_REWARD = 500;
const ALLOWED_REASONS: readonly AttendFailReason[] = [
  "not_authenticated",
  "already_attended",
  "no_profile",
  "unknown",
] as const;

function normalizeReason(raw: string | null | undefined): AttendFailReason {
  if (!raw) return "unknown";
  return (ALLOWED_REASONS as readonly string[]).includes(raw)
    ? (raw as AttendFailReason)
    : "unknown";
}

// ────────────────────────────────────────────────────────────────────
// 조회 : 오늘(KST) 출석 여부
// ────────────────────────────────────────────────────────────────────
export async function checkTodayAttended(): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_today_attendance");
  if (error) {
    console.warn("[attendance] check_today_attendance failed:", error);
    return false;
  }
  return Boolean(data);
}

// ────────────────────────────────────────────────────────────────────
// 실행 : 출석 + 모빌 지급 (+ 선택적 한마디 저장)
// ────────────────────────────────────────────────────────────────────
/**
 * 오늘 출석을 실행한다. 성공 시 500 모빌이 지급된다.
 *
 * @param message  한마디. undefined/빈 문자열/공백만 있는 경우 저장되지 않는다.
 *                 200자 초과분은 서버에서 안전하게 절단된다.
 */
export async function attendToday(message?: string): Promise<AttendResult> {
  const trimmed = (message ?? "").trim();
  const payload = trimmed.length > 0 ? trimmed.slice(0, 200) : null;

  const { data, error } = await supabase.rpc("attend_today", {
    p_message: payload,
  });

  if (error) {
    console.warn("[attendance] attend_today failed:", error);
    return { ok: false, reason: "unknown", reward: DEFAULT_REWARD };
  }

  const row: AttendTodayRow | null = Array.isArray(data)
    ? ((data[0] as AttendTodayRow | undefined) ?? null)
    : ((data as AttendTodayRow | null | undefined) ?? null);

  if (!row) {
    return { ok: false, reason: "unknown", reward: DEFAULT_REWARD };
  }

  const reward = row.reward ?? DEFAULT_REWARD;

  if (row.ok && row.attended_date && row.new_mobil !== null) {
    return {
      ok: true,
      attendedDate: row.attended_date,
      newMobil: row.new_mobil,
      reward,
    };
  }

  return {
    ok: false,
    reason: normalizeReason(row.reason),
    currentMobil: row.new_mobil ?? undefined,
    reward,
  };
}

// ────────────────────────────────────────────────────────────────────
// 조회 : 한마디 리스트
// ────────────────────────────────────────────────────────────────────
/**
 * 한마디 리스트를 최신순으로 조회한다.
 * 오류 시 빈 배열 반환 + 콘솔 경고.
 *
 * @param opts.date   "YYYY-MM-DD" 형식. 주어지면 KST 기준 그날의 한마디만 반환.
 *                    생략 시 전체(제한 있음).
 * @param opts.limit  최대 개수. 기본 200. 서버에서 1~500 으로 clamp.
 */
export async function listAttendanceMessages(
  opts?: { date?: string | null; limit?: number },
): Promise<AttendanceMessage[]> {
  const { data, error } = await supabase.rpc("list_attendance_messages", {
    p_date: opts?.date ?? null,
    p_limit: opts?.limit ?? 200,
  });

  if (error) {
    console.warn("[attendance] list_attendance_messages failed:", error);
    return [];
  }

  if (!Array.isArray(data)) return [];

  const rows = data as ListAttendanceRow[];
  const result: AttendanceMessage[] = [];

  for (const r of rows) {
    if (!r || typeof r.id !== "string" || typeof r.message !== "string") {
      continue;
    }
    result.push({
      id: r.id,
      profileId: typeof r.profile_id === "string" ? r.profile_id : "",
      displayName:
        typeof r.display_name === "string" && r.display_name.length > 0
          ? r.display_name
          : null,
      message: r.message,
      createdAt: typeof r.created_at === "string" ? r.created_at : "",
    });
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────
// 조회 : 이력 있는 날짜 목록 (오래된 순)
// ────────────────────────────────────────────────────────────────────
type ListDatesRow = {
  attendance_date: string;
  msg_count: number;
};

/**
 * 한마디가 존재하는 날짜(KST) 목록을 오래된 순으로 반환한다.
 * 페이지 네비게이션에서 사용. 오류 시 빈 배열 반환.
 */
export async function listAttendanceDates(): Promise<AttendanceDate[]> {
  const { data, error } = await supabase.rpc("list_attendance_dates");
  if (error) {
    console.warn("[attendance] list_attendance_dates failed:", error);
    return [];
  }
  if (!Array.isArray(data)) return [];

  const rows = data as ListDatesRow[];
  const result: AttendanceDate[] = [];

  for (const r of rows) {
    if (!r || typeof r.attendance_date !== "string") continue;
    const cnt = Number(r.msg_count);
    result.push({
      date: r.attendance_date,
      msgCount: Number.isFinite(cnt) ? cnt : 0,
    });
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────
// 조회 : 오늘 출석 총 인원수
// ────────────────────────────────────────────────────────────────────
/**
 * 오늘(KST) 출석한 총 인원수를 반환한다.
 * 오류 시 null 반환. UI 에서 조용히 표시를 감춘다.
 */
export async function countTodayAttendees(): Promise<number | null> {
  const { data, error } = await supabase.rpc("count_today_attendees");
  if (error) {
    console.warn("[attendance] count_today_attendees failed:", error);
    return null;
  }
  if (typeof data === "number") return data;
  const n = Number(data);
  return Number.isFinite(n) ? n : null;
}