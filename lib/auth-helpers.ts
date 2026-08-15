// lib/auth-helpers.ts
import { supabase } from "./supabase";

/**
 * 현재 세션의 유저 조회.
 * 로그인 안 됐으면 null.
 */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

/**
 * 현재 세션의 access_token 조회.
 * EF 호출용. 없으면 null.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

/**
 * 현재 유저의 profile 조회 (기본 필드).
 * 회원가입 완료 전(shell 연결 전)이거나 로그인 안 됐으면 null.
 *
 * 반환 컬럼:
 *   - id
 *   - family_name (성, nullable — GM은 null 가능)
 *   - given_name  (이름, nullable — GM은 null 가능)
 *   - is_gm
 */
export async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, family_name, given_name, is_gm")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return null;
  return data;
}

/**
 * 현재 유저가 GM인지 확인.
 * GM 아니거나 로그인 안 됐으면 false.
 */
export async function isCurrentUserGm(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.is_gm === true;
}

/**
 * 로그아웃.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

/* ═══════════════════════════════════════════════════════════
 * MyPanel 전용 확장 조회
 *
 * 스탯 개편 반영 (v8 §2-4, §4-1):
 *   - 옛 rhythm_stat / physical_stat / expression_stat (0~100) 컬럼 삭제됨
 *   - 신규 스키마 :
 *       *_exp   (0~450, 일반 컬럼)
 *       *_level (0~5, DB GENERATED STORED 컬럼)
 *   - level 은 DB 가 exp 로부터 파생시켜 저장하므로 신뢰 가능한 정답.
 *     앱에서 재계산하지 않고 그대로 사용한다 (실수 방지).
 *   - lib/stat-helpers.ts 의 expToLevel() 은 이 값과 동일한 결과를 내는
 *     보조 함수. exp 만 있고 level 이 없는 상황(예: mismatch snapshot)
 *     에서 사용.
 * ─────────────────────────────────────────────────────────── */

export type MyPanelProfileRow = {
  id:               string;
  family_name:      string | null;
  given_name:       string | null;
  school_name:      string | null;
  grade:            number | null;
  gender:           "male" | "female" | "other" | null;

  // 스탯 : exp (누적 경험치) + level (DB GENERATED)
  // 전부 NOT NULL. level 은 GENERATED 라 default 없이 항상 계산되어 채워짐.
  rhythm_exp:       number;
  rhythm_level:     number;
  physical_exp:     number;
  physical_level:   number;
  expression_exp:   number;
  expression_level: number;

  mobil:            number;   // NOT NULL DEFAULT 0 (재화)

  // 학생증 커스터마이제이션 (DB 이관, nullable — 미설정 시 null)
  card_bg_color:    string | null;   // '#RRGGBB' (DB CHECK: 6자리 HEX만)
  card_text_color:  string | null;   // '#RRGGBB' (DB CHECK: 6자리 HEX만)
  signature_data:   string | null;   // 서명 PNG dataURL
  avatar_url:       string | null;   // 학생증 두상 dataURL/URL (GM 이 설정, 본인 수정 불가)
};

/**
 * 마이패널 렌더링에 필요한 profile 필드 조회.
 *
 * getCurrentProfile()과 별개로 두는 이유:
 *   - getCurrentProfile은 헤더·GM 가드 등 여러 곳에서 쓰이므로 select 컬럼을
 *     늘리면 불필요한 부하가 광범위하게 걸림.
 *   - 마이패널만 학교/학년/성별/스탯/재화/학생증 커스터마이제이션까지 필요하므로
 *     전용 함수로 격리.
 *
 * 반환 필드는 MyPanelProfileRow 참조.
 * 로그인 안 됐거나 shell 미연결이면 null.
 *
 * 주의:
 *   - profiles_select_all RLS (전체 공개) 상태에서 자기 행을 읽음.
 *     프로필·스탯·재화는 어차피 멤버란에 공개될 정보라 정책상 문제 없음.
 *   - family_name / given_name / school_name / grade / gender 는 등록 완료 전엔
 *     null 일 수 있음. 사용처에서 방어 처리 필요.
 *   - *_exp / *_level / mobil 은 컬럼상 NOT NULL 이라 항상 숫자.
 *     level 은 DB GENERATED 라 exp 와 항상 정합.
 *   - card_bg_color / card_text_color / signature_data 는 미설정 시 null.
 */
export async function getMyPanelProfile(): Promise<MyPanelProfileRow | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, family_name, given_name, school_name, grade, gender, " +
      "rhythm_exp, rhythm_level, " +
      "physical_exp, physical_level, " +
      "expression_exp, expression_level, " +
      "mobil, " +
      "card_bg_color, card_text_color, signature_data, avatar_url"
    )
    .eq("user_id", user.id)
    .maybeSingle<MyPanelProfileRow>();

  if (error) return null;
  return data;
}

/* ═══════════════════════════════════════════════════════════
 * MyPanel 학생증 커스터마이제이션 저장
 * ─────────────────────────────────────────────────────────── */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * 저장 결과 공통 타입.
 * ok=false 여도 UI는 유지(로컬 state는 이미 반영된 상태)하고,
 * 사용처에서 필요 시 사용자에게 실패를 알리거나 재시도 가능.
 */
export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * 학생증 색상 저장 (배경·글씨 한 번에 UPDATE).
 *
 * - RLS profiles_update_own (user_id = auth.uid()) 로 자기 행만 UPDATE.
 * - DB CHECK(profiles_card_*_color_format)가 6자리 HEX만 허용하므로,
 *   저장 직전 형식을 최종 방어. 형식 위반이면 UPDATE 시도 자체를 막아
 *   전체 실패(사고)를 예방하고 명확한 에러를 반환.
 * - null 허용(미설정으로 되돌리기). null은 CHECK 통과.
 */
export async function updateMyCardColors(input: {
  cardBgColor:   string | null;
  cardTextColor: string | null;
}): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const { cardBgColor, cardTextColor } = input;

  if (cardBgColor !== null && !HEX6.test(cardBgColor)) {
    return { ok: false, error: "invalid_bg_color_format" };
  }
  if (cardTextColor !== null && !HEX6.test(cardTextColor)) {
    return { ok: false, error: "invalid_text_color_format" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      card_bg_color:   cardBgColor,
      card_text_color: cardTextColor,
    })
    .eq("user_id", user.id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 학생증 서명 저장.
 *
 * - dataUrl=null 이면 서명 삭제(컬럼 null).
 * - RLS profiles_update_own 으로 자기 행만 UPDATE.
 * - dataUrl 형식은 DB CHECK 없음(text). 다만 명백히 이상한 값은 막아
 *   불필요한 대용량 저장/오염을 예방.
 */
export async function updateMySignature(
  dataUrl: string | null
): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  if (dataUrl !== null && !dataUrl.startsWith("data:image/")) {
    return { ok: false, error: "invalid_signature_data" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ signature_data: dataUrl })
    .eq("user_id", user.id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════
 * GM 전용: mismatch 문의 카운트/리스트/완료 처리
 *
 * 스키마 v2 기준:
 *   - resolved_at IS NULL = 미완료 문의 (뱃지 카운트 대상)
 *   - 완료 처리는 GM이 명시적으로 눌러야만 발생 (탭 방문만으로는 안 됨)
 *
 * snapshot 필드 방침 (v8 스탯 개편 이후):
 *   - snapshot 은 발급 시점의 원본 데이터를 보존하는 목적이라 스키마 개편
 *     이후에도 과거 저장 데이터를 변형하지 않는다.
 *   - 과거 mismatch : rhythm_stat / physical_stat / expression_stat (0~100)
 *     신규 mismatch : rhythm_exp   / physical_exp   / expression_exp   (0~450)
 *   - 두 형식이 공존할 수 있으므로 표시 컴포넌트(ReportItem)에서 어느 형식인지
 *     분기해 렌더링. 여기서는 두 형식을 모두 optional 로 노출한다.
 * ─────────────────────────────────────────────────────────── */

/**
 * 미완료(resolved_at IS NULL) mismatch 문의 개수 조회.
 *
 * - GM 아닌 유저가 호출해도 RLS로 SELECT 자체가 막혀 count=0 반환.
 * - 실패해도 0 반환 (뱃지 표시 실패 < 안 뜨는 게 안전).
 * - 헤더 뱃지·GM 페이지 탭 라벨에서 사용.
 */
export async function getPendingReportCount(): Promise<number> {
  const { count, error } = await supabase
    .from("invite_mismatch_reports")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);

  if (error) return 0;
  return count ?? 0;
}

/**
 * mismatch 문의 리스트 조회.
 *
 * @param includeResolved  true면 완료된 문의도 포함, false면 미완료만
 *
 * 반환: created_at DESC 정렬. 각 행에 snapshot(jsonb) 포함.
 * 실패 시 빈 배열 반환.
 */
export type MismatchSnapshot = {
  family_name:     string | null;
  given_name:      string | null;
  age:             number | null;
  gender:          "male" | "female" | "other" | null;
  school_name:     string | null;
  grade:           number | null;
  rhythm_stat?:      number;
  physical_stat?:    number;
  expression_stat?:  number;
  rhythm_exp?:       number;
  rhythm_level?:     number;
  physical_exp?:     number;
  physical_level?:   number;
  expression_exp?:   number;
  expression_level?: number;
};

export type MismatchReportRow = {
  id:             string;
  invite_code:    string;
  snapshot:       MismatchSnapshot;
  message:        string;
  resolved_at:    string | null;
  resolved_by:    string | null;
  created_at:     string;
};

export async function listMismatchReports(
  includeResolved: boolean
): Promise<MismatchReportRow[]> {
  let q = supabase
    .from("invite_mismatch_reports")
    .select("id, invite_code, snapshot, message, resolved_at, resolved_by, created_at")
    .order("created_at", { ascending: false });

  if (!includeResolved) {
    q = q.is("resolved_at", null);
  }

  const { data, error } = await q.returns<MismatchReportRow[]>();
  if (error) return [];
  return data ?? [];
}

/**
 * 특정 문의를 완료 처리 (resolved_at = now(), resolved_by = 현재 GM profile).
 *
 * - RLS로 GM만 UPDATE 가능. GM 아니면 무반응(에러 아님).
 * - 낙관적 UI 반영과 함께 쓸 것. 실패 시 { ok: false } 반환.
 * - 이 프로젝트 방침상 완료 처리 취소(reopen)는 불가 → 대응 함수 없음.
 *   실수로 완료해도 되돌리려면 Supabase 대시보드에서 직접 UPDATE.
 */
export async function markReportResolved(
  reportId: string
): Promise<{ ok: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false };

  const { error } = await supabase
    .from("invite_mismatch_reports")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: profile.id,
    })
    .eq("id", reportId)
    .is("resolved_at", null); // race 방지: 이미 완료된 것은 UPDATE 안 됨

  if (error) {
    console.error("[markReportResolved] failed:", error);
    return { ok: false };
  }
  return { ok: true };
}