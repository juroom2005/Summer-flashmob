// lib/badge-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// 뱃지 조회 · 표시 유틸
// ═══════════════════════════════════════════════════════════════════
//
// 배경 : sql/applied/2026-08-19_badge_system.sql
//   · badges 6행 (스탯 3종 × 순위권/일반). 금은동은 badge_awards.rank(1/2/3).
//   · Lv5 최초 도달 시 DB 트리거가 자동 부여.
//
// 이 파일이 담는 것
//   · 특정 유저(profile_id)의 뱃지 목록 조회
//   · 세션 유저 본인 뱃지 조회
//   · rank + symbol → SVG 파일 경로 조립 (public/svg/badges/)
//   · 뱃지 정렬 · 라벨 등 표시 보조
//
// 이 파일이 담지 않는 것
//   · 뱃지 부여/회수 (DB 트리거 · 테스트 유틸이 담당. 앱은 조회만)
//   · 렌더링 (컴포넌트가 담당. 여기선 경로·데이터만 제공)
//
// 안정성 방침 (기존 helper 관례와 동일)
//   · 실패 시 빈 배열 반환. 표시 실패 < 잘못 표시.
//   · profile 조회 실패해도 빈 배열.
//   · badge_awards / badges 는 RLS select_all(전체 공개)라 타인 것도 읽힌다.
//     → 헤더·멤버 카드·GM 리스트 등 어디서든 profile_id 만 있으면 조회 가능.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// ────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────

// 스탯 키 (badges.metadata.stat). 내부 스탯 컬럼과 매핑 주의 :
//   performance ↔ expression_* 컬럼. 뱃지 심볼은 별(star).
export type BadgeStat = "rhythm" | "physical" | "performance";

// 심볼 (badges.metadata.symbol) — SVG 파일명 조립에 사용
export type BadgeSymbol = "note" | "heart" | "star";

// 등급 : 순위권 금은동 or 일반. SVG 파일명 grade 부분과 1:1.
export type BadgeGrade = "gold" | "silver" | "bronze" | "common";

// rank(1/2/3/null) → grade 매핑
const RANK_TO_GRADE: Record<number, BadgeGrade> = {
  1: "gold",
  2: "silver",
  3: "bronze",
};

// 조회 결과 한 건 (badge_awards + badges 조인)
export type UserBadge = {
  awardId:     string;        // badge_awards.id
  badgeId:     string;        // badges.id
  code:        string;        // badges.code (예: rhythm_rank)
  name:        string;        // badges.name
  description: string | null;
  stat:        BadgeStat;     // metadata.stat
  symbol:      BadgeSymbol;   // metadata.symbol
  isRanked:    boolean;       // badges.is_ranked
  rank:        number | null; // 1/2/3 (금은동) or null (일반)
  grade:       BadgeGrade;    // rank → grade (일반은 common)
  iconPath:    string;        // 표시용 SVG 경로
  awardedAt:   string;        // badge_awards.awarded_at
};

// ────────────────────────────────────────────────────────────────────
// SVG 경로 조립
//
//   파일 규칙 : /svg/badges/badge-{symbol}-{grade}.svg
//   순위권(rank 1/2/3) → gold/silver/bronze, 일반(null) → common.
//   심볼·등급이 예상 밖이면 안전하게 note/common 으로 폴백.
// ────────────────────────────────────────────────────────────────────
export function badgeIconPath(symbol: BadgeSymbol, rank: number | null): string {
  const grade: BadgeGrade =
    rank != null && RANK_TO_GRADE[rank] ? RANK_TO_GRADE[rank] : "common";
  const safeSymbol: BadgeSymbol =
    symbol === "heart" || symbol === "star" ? symbol : "note";
  return `/svg/badges/badge-${safeSymbol}-${grade}.svg`;
}

// rank → grade 단독 변환 (컴포넌트에서 필요할 때)
export function rankToGrade(rank: number | null): BadgeGrade {
  return rank != null && RANK_TO_GRADE[rank] ? RANK_TO_GRADE[rank] : "common";
}

// ────────────────────────────────────────────────────────────────────
// 정렬 우선순위
//
//   닉네임 옆에 여러 뱃지가 붙을 때 순서.
//   1) 순위권 먼저(금>은>동), 2) 그다음 일반.
//   같은 등급 안에서는 스탯 고정 순서(리듬>체력>퍼포먼스).
// ────────────────────────────────────────────────────────────────────
const STAT_ORDER: Record<BadgeStat, number> = {
  rhythm: 0,
  physical: 1,
  performance: 2,
};

function sortWeight(b: UserBadge): number {
  // 순위권(0~2: 금은동) < 일반(9). 스탯은 소수부로 tie-break.
  const rankPart = b.rank != null ? b.rank - 1 : 9;
  return rankPart * 10 + STAT_ORDER[b.stat];
}

// ────────────────────────────────────────────────────────────────────
// 내부 : badge_awards + badges 조인 행 → UserBadge 로 정규화
// ────────────────────────────────────────────────────────────────────
type RawAwardRow = {
  id:         string;
  rank:       number | null;
  awarded_at: string;
  badges: {
    id:          string;
    code:        string;
    name:        string;
    description: string | null;
    is_ranked:   boolean;
    metadata:    { stat?: string; symbol?: string } | null;
  } | null;
};

function normalize(row: RawAwardRow): UserBadge | null {
  const b = row.badges;
  if (!b) return null;

  const stat = (b.metadata?.stat ?? "rhythm") as BadgeStat;
  const symbol = (b.metadata?.symbol ?? "note") as BadgeSymbol;

  return {
    awardId:     row.id,
    badgeId:     b.id,
    code:        b.code,
    name:        b.name,
    description: b.description,
    stat,
    symbol,
    isRanked:    b.is_ranked,
    rank:        row.rank,
    grade:       rankToGrade(row.rank),
    iconPath:    badgeIconPath(symbol, row.rank),
    awardedAt:   row.awarded_at,
  };
}

// ────────────────────────────────────────────────────────────────────
// 조회 : 특정 profile_id 의 뱃지 목록
//
//   어디서든(헤더·멤버 카드·GM 리스트) profile_id 만 있으면 호출.
//   정렬 : 순위권(금은동) → 일반, 스탯 고정 순서.
// ────────────────────────────────────────────────────────────────────
export async function listBadgesForProfile(
  profileId: string,
): Promise<UserBadge[]> {
  if (!profileId) return [];

  const { data, error } = await supabase
    .from("badge_awards")
    .select(
      "id, rank, awarded_at, " +
      "badges ( id, code, name, description, is_ranked, metadata )",
    )
    .eq("profile_id", profileId);

  if (error || !data) {
    console.error("[listBadgesForProfile] failed:", error?.message);
    return [];
  }

  const badges = (data as unknown as RawAwardRow[])
    .map(normalize)
    .filter((b): b is UserBadge => b !== null);

  badges.sort((a, b) => sortWeight(a) - sortWeight(b));
  return badges;
}

// ────────────────────────────────────────────────────────────────────
// 조회 : 세션 유저 본인 뱃지 목록
//
//   user_id → profiles.id 로 다리를 놓은 뒤 listBadgesForProfile 재사용.
// ────────────────────────────────────────────────────────────────────
export async function listMyBadges(): Promise<UserBadge[]> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (!profile) return [];
  return listBadgesForProfile(profile.id);
}

// ────────────────────────────────────────────────────────────────────
// 배치 조회 : 여러 profile_id 의 뱃지를 한 번에
//
//   출석 한마디 리스트 · 일지 작성자처럼 화면에 여러 유저가 동시에 뜨는 곳에서
//   유저마다 개별 쿼리를 던지면 쿼리가 폭증한다. 부모가 보이는 profileId 들을
//   모아 이 함수로 한 번에 조회하고, 자식 컴포넌트엔 결과 Map 을 넘긴다.
//
//   반환 : profileId → UserBadge[] Map. 각 배열은 정렬 완료 상태.
//          뱃지 없는 유저는 Map 에 빈 배열로 들어간다(요청한 id 전부 포함).
//
//   안정성 : 실패 시 요청 id 전부 빈 배열인 Map 반환(표시 실패 < 잘못 표시).
// ────────────────────────────────────────────────────────────────────
export async function listBadgesForProfiles(
  profileIds: string[],
): Promise<Map<string, UserBadge[]>> {
  const result = new Map<string, UserBadge[]>();

  // 중복 제거 + 빈 값 제거
  const ids = Array.from(new Set(profileIds.filter((id) => !!id)));

  // 요청한 id 는 전부 빈 배열로 선초기화 (조회 실패해도 키는 존재)
  for (const id of ids) result.set(id, []);
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from("badge_awards")
    .select(
      "id, rank, awarded_at, profile_id, " +
      "badges ( id, code, name, description, is_ranked, metadata )",
    )
    .in("profile_id", ids);

  if (error || !data) {
    console.error("[listBadgesForProfiles] failed:", error?.message);
    return result; // 전부 빈 배열
  }

  // profile_id 별로 그룹핑
  for (const raw of data as unknown as (RawAwardRow & { profile_id: string })[]) {
    const badge = normalize(raw);
    if (!badge) continue;
    const arr = result.get(raw.profile_id);
    if (arr) arr.push(badge);
  }

  // 그룹별 정렬
  for (const arr of result.values()) {
    arr.sort((a, b) => sortWeight(a) - sortWeight(b));
  }

  return result;
}