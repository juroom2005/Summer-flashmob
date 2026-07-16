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
 * ─────────────────────────────────────────────────────────── */

export type MyPanelProfileRow = {
  id:              string;
  family_name:     string | null;
  given_name:      string | null;
  school_name:     string | null;
  grade:           number | null;
  gender:          "male" | "female" | "other" | null;
  rhythm_stat:     number;   // NOT NULL DEFAULT 0
  physical_stat:   number;   // NOT NULL DEFAULT 0
  expression_stat: number;   // NOT NULL DEFAULT 0
  mobil:           number;   // NOT NULL DEFAULT 0 (재화)
};

/**
 * 마이패널 렌더링에 필요한 profile 필드 조회.
 *
 * getCurrentProfile()과 별개로 두는 이유:
 *   - getCurrentProfile은 헤더·GM 가드 등 여러 곳에서 쓰이므로 select 컬럼을
 *     늘리면 불필요한 부하가 광범위하게 걸림.
 *   - 마이패널만 학교/학년/성별/스탯/재화까지 필요하므로 전용 함수로 격리.
 *
 * 반환 필드는 MyPanelProfileRow 참조.
 * 로그인 안 됐거나 shell 미연결이면 null.
 *
 * 주의:
 *   - profiles_select_all RLS (전체 공개) 상태에서 자기 행을 읽음.
 *     프로필·스탯·재화는 어차피 멤버란에 공개될 정보라 정책상 문제 없음.
 *   - family_name / given_name / school_name / grade / gender 는 등록 완료 전엔
 *     null 일 수 있음. 사용처에서 방어 처리 필요.
 *   - rhythm/physical/expression_stat, mobil 은 컬럼상 NOT NULL DEFAULT 0 이라 항상 숫자.
 */
export async function getMyPanelProfile(): Promise<MyPanelProfileRow | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, family_name, given_name, school_name, grade, gender, " +
      "rhythm_stat, physical_stat, expression_stat, mobil"
    )
    .eq("user_id", user.id)
    .maybeSingle<MyPanelProfileRow>();

  if (error) return null;
  return data;
}