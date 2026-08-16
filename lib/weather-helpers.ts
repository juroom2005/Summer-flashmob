// lib/weather-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// 날씨 위젯 데이터 헬퍼
// ═══════════════════════════════════════════════════════════════════
//
// 관련 마이그레이션 : sql/pending/2026-08-16_weather_schedule.sql
//
// 권한:
//   · 오늘 날씨 조회(getTodayWeather) : 누구나. 없으면 RPC 내부에서 랜덤 확정.
//   · GM 지정/삭제/목록 : gm_set/delete/list_weather RPC(SECURITY DEFINER).
//
// 에러 처리:
//   · 조회 실패 → null (위젯은 기본값으로 폴백).
//   · 변경 실패 → { ok:false, reason, message }.

import { supabase } from "./supabase";
import type { WeatherKind } from "@/components/noticeboard/widgets/WeatherIcon";

/* DB 행(snake) → 프론트(camel) */
export type WeatherEntry = {
  date: string;        // 'YYYY-MM-DD' (KST 날짜)
  kind: WeatherKind;
  tempC: number;
  realFeelC: number;
  source: "gm" | "random";
};

type WeatherRow = {
  weather_date: string;
  kind: WeatherKind;
  temp_c: number;
  real_feel_c: number;
  source: "gm" | "random";
};

function rowToEntry(r: WeatherRow): WeatherEntry {
  return {
    date: r.weather_date,
    kind: r.kind,
    tempC: r.temp_c,
    realFeelC: r.real_feel_c,
    source: r.source,
  };
}

/* ═══════════════════════════════════════════════════════════
 * 오늘 날씨 (공용) — 없으면 서버에서 랜덤 확정 후 반환
 * ─────────────────────────────────────────────────────────── */
export async function getTodayWeather(): Promise<WeatherEntry | null> {
  const { data, error } = await supabase.rpc("get_or_create_today_weather");
  if (error) {
    console.error("[getTodayWeather] failed:", error.message);
    return null;
  }
  // RPC 가 단일 행(record) 반환. supabase-js 는 객체 또는 배열로 줄 수 있어 양쪽 대응.
  const row = Array.isArray(data) ? data[0] : data;
  return row ? rowToEntry(row as WeatherRow) : null;
}

/* ═══════════════════════════════════════════════════════════
 * 변경 결과 정규화
 * ─────────────────────────────────────────────────────────── */
export type WeatherMutationResult =
  | { ok: true; entry: WeatherEntry }
  | { ok: false; reason: string; message: string };

export type WeatherDeleteResult =
  | { ok: true }
  | { ok: false; reason: string; message: string };

const REASON_MESSAGE: Record<string, string> = {
  invalid_date: "날짜가 올바르지 않습니다.",
  invalid_kind: "날씨 종류가 올바르지 않습니다.",
  invalid_temp: "온도 값이 올바르지 않습니다.",
  not_gm: "GM 권한이 필요합니다.",
  auth_required: "로그인이 필요합니다.",
};

function normalizeError(raw: string | undefined): { reason: string; message: string } {
  const reason = (raw ?? "unknown").trim();
  const message =
    REASON_MESSAGE[reason] ??
    "처리 중 오류가 발생하였습니다. 잠시 후 다시 시도해주십시오.";
  return { reason, message };
}

/* ═══════════════════════════════════════════════════════════
 * GM : 날짜별 지정/수정 (upsert)
 * ─────────────────────────────────────────────────────────── */
export async function gmSetWeather(
  date: string,
  kind: WeatherKind,
  tempC: number,
  realFeelC: number
): Promise<WeatherMutationResult> {
  const { data, error } = await supabase.rpc("gm_set_weather", {
    p_date: date,
    p_kind: kind,
    p_temp_c: tempC,
    p_real_feel_c: realFeelC,
  });
  if (error) {
    const { reason, message } = normalizeError(error.message);
    return { ok: false, reason, message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, entry: rowToEntry(row as WeatherRow) };
}

/* GM : 지정 삭제(그 날은 다시 미지정 → 오늘이면 조회 시 랜덤 재확정) */
export async function gmDeleteWeather(date: string): Promise<WeatherDeleteResult> {
  const { error } = await supabase.rpc("gm_delete_weather", { p_date: date });
  if (error) {
    const { reason, message } = normalizeError(error.message);
    return { ok: false, reason, message };
  }
  return { ok: true };
}

/* GM : 기간 조회(예약 현황). 실패 시 빈 배열. */
export async function gmListWeather(
  from: string,
  to: string
): Promise<WeatherEntry[]> {
  const { data, error } = await supabase.rpc("gm_list_weather", {
    p_from: from,
    p_to: to,
  });
  if (error) {
    console.error("[gmListWeather] failed:", error.message);
    return [];
  }
  return ((data as WeatherRow[] | null) ?? []).map(rowToEntry);
}

/* ═══════════════════════════════════════════════════════════
 * 날짜 유틸 (KST 기준)
 * ─────────────────────────────────────────────────────────── */

/** KST 기준 오늘 'YYYY-MM-DD'. (브라우저 로컬시간과 무관하게 UTC+9 로 계산) */
export function kstTodayStr(): string {
  const now = new Date();
  // UTC + 9h
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' 에 days 를 더한 문자열. */
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
