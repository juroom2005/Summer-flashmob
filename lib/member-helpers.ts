// lib/member-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// MEMBER 게시판 데이터 헬퍼
// ═══════════════════════════════════════════════════════════════════
//
// 관련 마이그레이션 : sql/pending/2026-08-16_member_profiles.sql
//
// 권한 요약(서버 RLS 가 최종 방어. 프론트는 UX 게이팅만):
//   · 목록/열람 : 누구나 (SELECT 전체공개)
//   · 본인 수정 : 유저는 자기 owner_id 행만 UPDATE (RLS)
//   · GM CRUD   : gm_create/update/delete_member_profile RPC (SECURITY DEFINER)
//
// 에러 처리 방침(프로젝트 관례):
//   · 조회 실패 → 빈 배열/ null (안 뜨는 편이 잘못 뜨는 것보다 안전).
//   · 변경 실패 → { ok:false, reason } 로 정규화.
//
// DB(snake_case) ↔ 프론트(camelCase) 매핑은 이 파일 안에서만 처리.
// 프론트(MemberPanel)는 camelCase MemberProfile 만 다룬다.

import { supabase } from "./supabase";
import type { MemberProfile } from "@/components/noticeboard/panels/MemberPanel";

/* ═══════════════════════════════════════════════════════════
 * DB 행 타입 & 매핑
 * ─────────────────────────────────────────────────────────── */

/** member_profiles 테이블 행(snake_case, DB 원본). */
type MemberProfileRow = {
  id:            string;
  owner_id:      string;
  name:          string;
  date_of_birth: string;
  age:           string;
  grade:         string;
  height:        string;
  rhythm:        string;
  stamina:       string;
  performance:   string;
  personality:   string;
  etc:           string;
  photo_url:     string | null;
  theme_color:   string | null;
  tag_last:      string;
  tag_first:     string;
};

const ROW_COLUMNS =
  "id, owner_id, name, date_of_birth, age, grade, height, " +
  "rhythm, stamina, performance, personality, etc, photo_url, theme_color, " +
  "tag_last, tag_first";

/** DB 행 → 프론트 MemberProfile. */
function rowToProfile(r: MemberProfileRow): MemberProfile {
  return {
    id:          r.id,
    ownerId:     r.owner_id,
    name:        r.name ?? "",
    dateOfBirth: r.date_of_birth ?? "",
    age:         r.age ?? "",
    grade:       r.grade ?? "",
    height:      r.height ?? "",
    rhythm:      r.rhythm ?? "",
    stamina:     r.stamina ?? "",
    performance: r.performance ?? "",
    personality: r.personality ?? "",
    etc:         r.etc ?? "",
    photoUrl:    r.photo_url ?? undefined,
    themeColor:  r.theme_color ?? undefined,
    tagLast:     r.tag_last ?? "",
    tagFirst:    r.tag_first ?? "",
  };
}

/** 프론트 편집값(부분) → RPC 로 보낼 jsonb(snake_case).
 *  undefined 필드는 키 자체를 빼서 "미변경"으로 둔다(RPC COALESCE 유지).
 *  photoUrl 은 명시적으로 다룬다: null 이면 삭제 의도로 photo_url:null 을 담는다. */
export type MemberProfileInput = Partial<{
  name:        string;
  dateOfBirth: string;
  age:         string;
  grade:       string;
  height:      string;
  rhythm:      string;
  stamina:     string;
  performance: string;
  personality: string;
  etc:         string;
  photoUrl:    string | null;   // null = 사진 삭제, undefined = 미변경
  themeColor:  string | null;   // null = 색 삭제(기본색), undefined = 미변경
  tagLast:     string;
  tagFirst:    string;
}>;

function inputToPayload(input: MemberProfileInput): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const put = (k: string, v: string | undefined) => {
    if (v !== undefined) p[k] = v;
  };
  put("name",          input.name);
  put("date_of_birth", input.dateOfBirth);
  put("age",           input.age);
  put("grade",         input.grade);
  put("height",        input.height);
  put("rhythm",        input.rhythm);
  put("stamina",       input.stamina);
  put("performance",   input.performance);
  put("personality",   input.personality);
  put("etc",           input.etc);
  put("tag_last",      input.tagLast);
  put("tag_first",     input.tagFirst);

  // photoUrl 은 3-상태:
  //   undefined → 키 없음(미변경)
  //   null      → photo_url:null (삭제)
  //   string    → photo_url:string (설정)
  if (input.photoUrl !== undefined) {
    p.photo_url = input.photoUrl; // null 또는 string 그대로
  }
  // themeColor 도 동일 3-상태(undefined 미변경 / null 삭제 / string 설정)
  if (input.themeColor !== undefined) {
    p.theme_color = input.themeColor;
  }
  return p;
}

/* ═══════════════════════════════════════════════════════════
 * 조회 (누구나)
 * ─────────────────────────────────────────────────────────── */

/**
 * 게시판 전체 프로필 목록.
 * 실패 시 빈 배열(게시판이 잘못 뜨는 것보다 비어 보이는 편이 안전).
 * 정렬: name 오름차순, 그다음 생성순 보장을 위해 id.
 */
export async function listMemberProfiles(): Promise<MemberProfile[]> {
  const { data, error } = await supabase
    .from("member_profiles")
    .select(ROW_COLUMNS)
    .order("name", { ascending: true })
    .order("id",   { ascending: true });

  if (error) {
    console.error("[listMemberProfiles] failed:", error.message);
    return [];
  }
  return ((data as unknown as MemberProfileRow[] | null) ?? []).map(rowToProfile);
}

/**
 * 세션 유저 본인의 프로필(있으면). GM 여부와 무관하게 "내가 owner 인 행".
 * 프론트에서 "내 프로필 수정" 버튼 노출 판단에 사용.
 * 로그인 안 됐거나 없으면 null.
 */
export async function getMyMemberProfile(): Promise<MemberProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;

  // 내 profiles.id 를 먼저 구한다(owner_id 는 profiles.id 참조).
  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", uid)
    .maybeSingle();

  if (profErr || !prof) {
    if (profErr) console.error("[getMyMemberProfile] profile lookup:", profErr.message);
    return null;
  }

  const { data, error } = await supabase
    .from("member_profiles")
    .select(ROW_COLUMNS)
    .eq("owner_id", (prof as { id: string }).id)
    .maybeSingle();

  if (error) {
    console.error("[getMyMemberProfile] failed:", error.message);
    return null;
  }
  return data ? rowToProfile(data as unknown as MemberProfileRow) : null;
}

/* ═══════════════════════════════════════════════════════════
 * 변경 결과 정규화
 * ─────────────────────────────────────────────────────────── */

export type MemberMutationResult =
  | { ok: true; profile: MemberProfile }
  | { ok: false; reason: string; message: string };

export type MemberDeleteResult =
  | { ok: true }
  | { ok: false; reason: string; message: string };

/** RPC/RLS 에러코드 → 유저 메시지. */
const REASON_MESSAGE: Record<string, string> = {
  invalid_owner_id:             "대상 유저 식별자가 올바르지 않습니다.",
  owner_profile_not_found:      "대상 유저를 찾을 수 없습니다.",
  member_profile_already_exists:"이미 해당 유저의 프로필이 존재합니다.",
  invalid_profile_id:           "프로필 식별자가 올바르지 않습니다.",
  member_profile_not_found:     "프로필을 찾을 수 없습니다.",
  not_gm:                       "GM 권한이 필요합니다.",
  auth_required:                "로그인이 필요합니다.",
  permission_denied:            "이 프로필을 수정할 권한이 없습니다.",
};

function normalizeError(raw: string | undefined): { reason: string; message: string } {
  const reason = (raw ?? "unknown").trim();
  const message =
    REASON_MESSAGE[reason] ??
    "처리 중 오류가 발생하였습니다. 잠시 후 다시 시도해주십시오.";
  return { reason, message };
}

/* ═══════════════════════════════════════════════════════════
 * GM : 생성 / 수정 / 삭제 (RPC)
 * ─────────────────────────────────────────────────────────── */

/**
 * GM: 특정 유저(ownerProfileId = profiles.id)의 프로필을 생성.
 * ownerProfileId 는 gm_list_users 의 id(=profiles.id)를 그대로 넘긴다.
 */
export async function gmCreateMemberProfile(
  ownerProfileId: string,
  input: MemberProfileInput
): Promise<MemberMutationResult> {
  const { data, error } = await supabase.rpc("gm_create_member_profile", {
    p_owner_id: ownerProfileId,
    p_data:     inputToPayload(input),
  });

  if (error) {
    const { reason, message } = normalizeError(error.message);
    return { ok: false, reason, message };
  }
  return { ok: true, profile: rowToProfile(data as MemberProfileRow) };
}

/** GM: 프로필 수정(부분). */
export async function gmUpdateMemberProfile(
  profileId: string,
  input: MemberProfileInput
): Promise<MemberMutationResult> {
  const { data, error } = await supabase.rpc("gm_update_member_profile", {
    p_id:   profileId,
    p_data: inputToPayload(input),
  });

  if (error) {
    const { reason, message } = normalizeError(error.message);
    return { ok: false, reason, message };
  }
  return { ok: true, profile: rowToProfile(data as MemberProfileRow) };
}

/** GM: 프로필 삭제. */
export async function gmDeleteMemberProfile(
  profileId: string
): Promise<MemberDeleteResult> {
  const { error } = await supabase.rpc("gm_delete_member_profile", {
    p_id: profileId,
  });

  if (error) {
    const { reason, message } = normalizeError(error.message);
    return { ok: false, reason, message };
  }
  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════
 * 유저(본인) : 자기 프로필 수정 (RLS UPDATE)
 * ─────────────────────────────────────────────────────────── */

/**
 * 본인 프로필 수정. RLS 가 owner_id = 내 profiles.id 인 행만 허용한다.
 * GM 이 owner 를 나로 찍어 만든 행이 대상이 된다("GM 이 올린 걸 내가 수정").
 *
 * 주의: RLS 로 막히면 update 는 에러 없이 0행 갱신될 수 있으므로,
 *       .select() 로 되돌려받아 반영 여부를 확인한다(0행이면 권한/부재).
 */
export async function updateMyMemberProfile(
  profileId: string,
  input: MemberProfileInput
): Promise<MemberMutationResult> {
  const payload = inputToPayload(input);

  const { data, error } = await supabase
    .from("member_profiles")
    .update(payload)
    .eq("id", profileId)
    .select(ROW_COLUMNS)
    .maybeSingle();

  if (error) {
    const { reason, message } = normalizeError(error.message);
    return { ok: false, reason, message };
  }
  if (!data) {
    // RLS 로 대상 행이 안 보이거나(권한 없음) 존재하지 않음.
    const { reason, message } = normalizeError("permission_denied");
    return { ok: false, reason, message };
  }
  return { ok: true, profile: rowToProfile(data as unknown as MemberProfileRow) };
}
/* ═══════════════════════════════════════════════════════════
 * 스탯 레벨 조회 (디테일뷰 연동)
 * ───────────────────────────────────────────────────────────
 * member_profiles.owner_id 는 profiles.id 를 참조한다.
 * 그 owner 의 실제 스탯 레벨(exp 에서 DB GENERATED 로 파생, 0~5)을 읽어
 * 디테일뷰의 RHYTHM/STAMINA/PERFORMANCE 칸에 표시한다.
 *   RHYTHM      → rhythm_level
 *   STAMINA     → physical_level
 *   PERFORMANCE → expression_level
 * profiles_select_all RLS(전체 공개)라 타인 프로필도 조회 가능.
 * 실패 시 null → 프론트에서 기존 텍스트/빈값 폴백. */
export type MemberStatLevels = {
  rhythm: number;
  physical: number;
  expression: number;
};

export async function getMemberStatLevels(
  ownerId: string
): Promise<MemberStatLevels | null> {
  if (!ownerId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("rhythm_level, physical_level, expression_level")
    .eq("id", ownerId)
    .maybeSingle<{
      rhythm_level: number;
      physical_level: number;
      expression_level: number;
    }>();

  if (error) {
    console.error("[getMemberStatLevels] failed:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    rhythm:     Number(data.rhythm_level ?? 0),
    physical:   Number(data.physical_level ?? 0),
    expression: Number(data.expression_level ?? 0),
  };
}