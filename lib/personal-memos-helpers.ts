// lib/personal-memos-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// 개인 메모 (personal_memos) 헬퍼 — 본인만 접근
// ═══════════════════════════════════════════════════════════════════
//
// 유저 개인이 자기 달력에만 남기는 메모("혼잣말"). 다른 유저·GM 은
// 앱 경로로 볼 수 없다 (RLS owner-only, GM 우회 정책 없음).
//
// CRUD 는 supabase.from("personal_memos") 로 직접 처리한다.
// RLS 가 접근 통제 담당:
//   - SELECT/INSERT/UPDATE/DELETE : profile_id 가 auth.uid() 의 profile 인 행만
//
// 저장 정책 (합의된 옵션 1):
//   - DB 평문 저장 + RLS 로 본인만 접근
//   - anon key 경로로는 운영자도 타인 메모 조회 불가
//   - service_role (DB 콘솔 직접) 은 RLS 우회 → 사전 합의된 한계
//
// 서버 스키마: sql/pending/2026-08-07_calendar_tables.sql
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// ────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────
export const MAX_MEMO_LEN = 1000;   // DB CHECK 와 동일

// ────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────
export type PersonalMemo = {
  id:        string;
  memoDate:  string;   // "YYYY-MM-DD"
  body:      string;
  createdAt: string;
  updatedAt: string;
};

type PersonalMemoRow = {
  id:         string;
  memo_date:  string;
  body:       string;
  created_at: string;
  updated_at: string;
};

export type PersonalMemoResult =
  | { ok: true; memo: PersonalMemo }
  | { ok: false; reason: "validation" | "unauthenticated" | "unknown"; message: string };

export type PersonalMemoDeleteResult =
  | { ok: true }
  | { ok: false; message: string };

// ────────────────────────────────────────────────────────────────────
// 내부 유틸
// ────────────────────────────────────────────────────────────────────
const DATE_RE = "^\\d{4}-\\d{2}-\\d{2}$";
const dateRe = new RegExp(DATE_RE);

const SELECT_COLS = "id, memo_date, body, created_at, updated_at";

function toMemo(row: PersonalMemoRow | null | undefined): PersonalMemo | null {
  if (!row) return null;
  if (typeof row.id !== "string" || row.id.length === 0) return null;
  if (typeof row.memo_date !== "string" || !dateRe.test(row.memo_date)) return null;
  if (typeof row.body !== "string") return null;
  return {
    id:        row.id,
    memoDate:  row.memo_date,
    body:      row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isValidDateStr(s: string): boolean {
  if (!dateRe.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 현재 로그인 유저의 profile.id 를 조회.
 * 로그인 안 됐거나 shell 미연결이면 null.
 * (INSERT 시 profile_id 를 명시적으로 넣기 위해 필요)
 */
async function getMyProfileId(): Promise<string | null> {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", uid)
    .maybeSingle<{ id: string }>();

  if (error || !data) return null;
  return data.id;
}

// ────────────────────────────────────────────────────────────────────
// 조회 : 연도 범위 (달력 로드용)
// ────────────────────────────────────────────────────────────────────
/**
 * 본인 메모 중 지정 연도 범위를 날짜·생성시각 오름차순으로 반환.
 * RLS 가 본인 행만 통과시키므로 profile_id 조건은 불필요.
 * 오류 시 빈 배열 + 콘솔 경고.
 */
export async function listMyMemosByYear(year: number): Promise<PersonalMemo[]> {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const { data, error } = await supabase
    .from("personal_memos")
    .select(SELECT_COLS)
    .gte("memo_date", start)
    .lte("memo_date", end)
    .order("memo_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[personal_memos] list failed:", error);
    return [];
  }
  if (!Array.isArray(data)) return [];

  const result: PersonalMemo[] = [];
  for (const r of data as PersonalMemoRow[]) {
    const m = toMemo(r);
    if (m) result.push(m);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────
// 생성
// ────────────────────────────────────────────────────────────────────
export async function createMyMemo(
  memoDate: string,
  body: string,
): Promise<PersonalMemoResult> {
  if (!isValidDateStr(memoDate)) {
    return { ok: false, reason: "validation", message: "날짜 형식이 올바르지 않습니다." };
  }
  const trimmed = body.trim();
  if (trimmed.length < 1) {
    return { ok: false, reason: "validation", message: "메모 내용을 입력해 주십시오." };
  }
  if (trimmed.length > MAX_MEMO_LEN) {
    return { ok: false, reason: "validation", message: `메모는 ${MAX_MEMO_LEN}자 이하로 입력해 주십시오.` };
  }

  const profileId = await getMyProfileId();
  if (!profileId) {
    return { ok: false, reason: "unauthenticated", message: "로그인이 필요합니다." };
  }

  const { data, error } = await supabase
    .from("personal_memos")
    .insert({ profile_id: profileId, memo_date: memoDate, body: trimmed })
    .select(SELECT_COLS)
    .single();

  if (error) {
    console.warn("[personal_memos] create failed:", error);
    return { ok: false, reason: "unknown", message: "저장에 실패했습니다. 잠시 후 다시 시도해 주십시오." };
  }

  const memo = toMemo(data as PersonalMemoRow);
  if (!memo) {
    return { ok: false, reason: "unknown", message: "저장은 완료되었으나 응답이 유효하지 않습니다." };
  }
  return { ok: true, memo };
}

// ────────────────────────────────────────────────────────────────────
// 수정
// ────────────────────────────────────────────────────────────────────
/**
 * 메모 본문 수정. id 만으로 대상 지정 (RLS 가 본인 행만 통과).
 * memo_date 는 이동 개념이 없으므로 body 만 갱신.
 */
export async function updateMyMemo(
  id: string,
  body: string,
): Promise<PersonalMemoResult> {
  const trimmed = body.trim();
  if (trimmed.length < 1) {
    return { ok: false, reason: "validation", message: "메모 내용을 입력해 주십시오." };
  }
  if (trimmed.length > MAX_MEMO_LEN) {
    return { ok: false, reason: "validation", message: `메모는 ${MAX_MEMO_LEN}자 이하로 입력해 주십시오.` };
  }

  const { data, error } = await supabase
    .from("personal_memos")
    .update({ body: trimmed })
    .eq("id", id)
    .select(SELECT_COLS)
    .single();

  if (error) {
    console.warn("[personal_memos] update failed:", error);
    return { ok: false, reason: "unknown", message: "수정에 실패했습니다." };
  }

  const memo = toMemo(data as PersonalMemoRow);
  if (!memo) {
    return { ok: false, reason: "unknown", message: "수정은 완료되었으나 응답이 유효하지 않습니다." };
  }
  return { ok: true, memo };
}

// ────────────────────────────────────────────────────────────────────
// 삭제
// ────────────────────────────────────────────────────────────────────
export async function deleteMyMemo(id: string): Promise<PersonalMemoDeleteResult> {
  const { error } = await supabase
    .from("personal_memos")
    .delete()
    .eq("id", id);

  if (error) {
    console.warn("[personal_memos] delete failed:", error);
    return { ok: false, message: "삭제에 실패했습니다." };
  }
  return { ok: true };
}
