// lib/ef-client.ts
import { getAccessToken } from "./auth-helpers";

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL      ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export type EfResult<T> =
  | { ok: true;  data: T; status: number }
  | { ok: false; error: string; status: number; detail?: string };

/**
 * Edge Function 호출.
 * - Authorization: 현재 세션의 access_token (없으면 anon key)
 * - apikey: anon key (핸드오프 5-1 함정 회피: 이 헤더가 없으면 401)
 *
 * 로그인 안 된 상태에서 호출 시엔 apikey만 있어도 EF에 도달함.
 * 각 EF가 내부에서 auth.getUser()로 검증하는 구조라 여기서 세션 필수는 아님.
 */
export async function callEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown> = {}
): Promise<EfResult<T>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      ok:     false,
      error:  "Supabase 환경 변수가 설정되지 않았습니다.",
      status: 0,
    };
  }

  const token   = await getAccessToken();
  const authVal = token ?? SUPABASE_ANON_KEY;

  const url = `${SUPABASE_URL}/functions/v1/${name}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${authVal}`,
        "apikey":        SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok:     false,
      error:  `네트워크 오류: ${String(e)}`,
      status: 0,
    };
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const errObj = (payload ?? {}) as Record<string, unknown>;
    return {
      ok:     false,
      error:  (errObj.error  as string) ?? `HTTP ${res.status}`,
      detail: (errObj.detail as string) ?? undefined,
      status: res.status,
    };
  }

  return {
    ok:     true,
    data:   payload as T,
    status: res.status,
  };
}