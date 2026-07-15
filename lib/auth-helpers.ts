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
 * 현재 유저의 profile 조회.
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