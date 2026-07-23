// lib/notices-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// 운영 공지 게시판 헬퍼
// ═══════════════════════════════════════════════════════════════════
//
// CRUD 는 supabase.from("notices") 로 직접 처리한다.
// RLS 가 접근 통제 담당:
//   - SELECT : 익명 포함 누구나
//   - INSERT/UPDATE/DELETE : profiles.is_gm = true 유저만
//
// 서버 스키마: sql/2026-07-23_notices.sql
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// ────────────────────────────────────────────────────────────────────
// 카테고리 정의
// ────────────────────────────────────────────────────────────────────
export type NoticeCategory = "schedule" | "notice" | "etc";

export const NOTICE_CATEGORIES: readonly NoticeCategory[] = [
  "schedule",
  "notice",
  "etc",
] as const;

export const NOTICE_CATEGORY_LABEL: Record<NoticeCategory, string> = {
  schedule: "일정",
  notice:   "공지",
  etc:      "기타",
};

/** 카테고리별 시안 색상 (chip 배경, 텍스트) - NoticeBoard 시안 톤과 통일 */
export const NOTICE_CATEGORY_COLOR: Record<NoticeCategory, { bg: string; fg: string }> = {
  schedule: { bg: "#cdeeff", fg: "#0d6fa8" },
  notice:   { bg: "#c9f2e6", fg: "#1e7d6a" },
  etc:      { bg: "#fff3a6", fg: "#8a7410" },
};

// ────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────
export type Notice = {
  id:         string;
  category:   NoticeCategory;
  title:      string;
  body:       string;
  authorId:   string | null;
  createdAt:  string;
  updatedAt:  string;
};

type NoticeRow = {
  id:         string;
  category:   string;
  title:      string;
  body:       string;
  author_id:  string | null;
  created_at: string;
  updated_at: string;
};

export type NoticeInput = {
  category: NoticeCategory;
  title:    string;
  body:     string;
};

export type NoticeMutationResult =
  | { ok: true; notice: Notice }
  | { ok: false; reason: "validation" | "unauthorized" | "unknown"; message: string };

export type NoticeDeleteResult =
  | { ok: true }
  | { ok: false; message: string };

// ────────────────────────────────────────────────────────────────────
// 내부 유틸
// ────────────────────────────────────────────────────────────────────
function toNotice(row: NoticeRow | null | undefined): Notice | null {
  if (!row) return null;
  if (typeof row.id !== "string" || row.id.length === 0) return null;
  if (typeof row.title !== "string" || typeof row.body !== "string") return null;
  const cat = row.category as NoticeCategory;
  if (!NOTICE_CATEGORIES.includes(cat)) return null;
  return {
    id:        row.id,
    category:  cat,
    title:     row.title,
    body:      row.body,
    authorId:  row.author_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validate(input: NoticeInput): string | null {
  if (!NOTICE_CATEGORIES.includes(input.category)) {
    return "카테고리가 올바르지 않습니다.";
  }
  const title = input.title.trim();
  if (title.length < 1)   return "제목을 입력해 주십시오.";
  if (title.length > 100) return "제목은 100자 이하로 입력해 주십시오.";
  const body = input.body.trim();
  if (body.length < 1)    return "내용을 입력해 주십시오.";
  if (body.length > 5000) return "내용은 5000자 이하로 입력해 주십시오.";
  return null;
}

function isRlsError(err: { code?: string; message?: string }): boolean {
  const code = err?.code ?? "";
  const msg  = (err?.message ?? "").toLowerCase();
  return code === "42501" || msg.includes("row-level security") || msg.includes("policy");
}

// ────────────────────────────────────────────────────────────────────
// 조회
// ────────────────────────────────────────────────────────────────────
/**
 * 공지 전체 목록을 최신순으로 반환.
 * 오류 시 빈 배열 + 콘솔 경고.
 */
export async function listNotices(): Promise<Notice[]> {
  const { data, error } = await supabase
    .from("notices")
    .select("id, category, title, body, author_id, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[notices] list failed:", error);
    return [];
  }
  if (!Array.isArray(data)) return [];

  const result: Notice[] = [];
  for (const r of data as NoticeRow[]) {
    const n = toNotice(r);
    if (n) result.push(n);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────
// 생성 (GM)
// ────────────────────────────────────────────────────────────────────
export async function createNotice(input: NoticeInput): Promise<NoticeMutationResult> {
  const err = validate(input);
  if (err) return { ok: false, reason: "validation", message: err };

  // author_id 는 클라이언트 세션의 user.id 로 세팅.
  // RLS 는 별도로 is_gm 검증하므로 이 값은 참고용.
  const { data: authData } = await supabase.auth.getUser();
  const authorId = authData?.user?.id ?? null;

  const { data, error } = await supabase
    .from("notices")
    .insert({
      category:  input.category,
      title:     input.title.trim(),
      body:      input.body.trim(),
      author_id: authorId,
    })
    .select("id, category, title, body, author_id, created_at, updated_at")
    .single();

  if (error) {
    console.warn("[notices] create failed:", error);
    if (isRlsError(error)) {
      return { ok: false, reason: "unauthorized", message: "권한이 없습니다." };
    }
    return { ok: false, reason: "unknown", message: "저장에 실패했습니다. 잠시 후 다시 시도해 주십시오." };
  }

  const notice = toNotice(data as NoticeRow);
  if (!notice) {
    return { ok: false, reason: "unknown", message: "저장은 완료되었으나 응답이 유효하지 않습니다." };
  }
  return { ok: true, notice };
}

// ────────────────────────────────────────────────────────────────────
// 수정 (GM)
// ────────────────────────────────────────────────────────────────────
export async function updateNotice(
  id: string,
  input: NoticeInput,
): Promise<NoticeMutationResult> {
  const err = validate(input);
  if (err) return { ok: false, reason: "validation", message: err };

  const { data, error } = await supabase
    .from("notices")
    .update({
      category: input.category,
      title:    input.title.trim(),
      body:     input.body.trim(),
    })
    .eq("id", id)
    .select("id, category, title, body, author_id, created_at, updated_at")
    .single();

  if (error) {
    console.warn("[notices] update failed:", error);
    if (isRlsError(error)) {
      return { ok: false, reason: "unauthorized", message: "권한이 없습니다." };
    }
    return { ok: false, reason: "unknown", message: "수정에 실패했습니다." };
  }

  const notice = toNotice(data as NoticeRow);
  if (!notice) {
    return { ok: false, reason: "unknown", message: "수정은 완료되었으나 응답이 유효하지 않습니다." };
  }
  return { ok: true, notice };
}

// ────────────────────────────────────────────────────────────────────
// 삭제 (GM)
// ────────────────────────────────────────────────────────────────────
export async function deleteNotice(id: string): Promise<NoticeDeleteResult> {
  const { error } = await supabase
    .from("notices")
    .delete()
    .eq("id", id);

  if (error) {
    console.warn("[notices] delete failed:", error);
    if (isRlsError(error)) {
      return { ok: false, message: "권한이 없습니다." };
    }
    return { ok: false, message: "삭제에 실패했습니다." };
  }
  return { ok: true };
}