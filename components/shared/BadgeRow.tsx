// components/shared/BadgeRow.tsx
// ═══════════════════════════════════════════════════════════════════
// 뱃지 가로 나열 표시 컴포넌트 (재사용)
// ═══════════════════════════════════════════════════════════════════
//
// 닉네임·이름·두상 옆에 획득 뱃지 아이콘을 한 줄로 표시한다.
// 표시 위치 : 학생증(MyPanel) · 출석 한마디 · 일지 작성자 · 멤버 상세 두상.
//
// 두 가지 데이터 주입 방식 (둘 중 하나만 쓴다)
//   1) badges  : 이미 조회한 UserBadge[] 를 그대로 받는다.
//                리스트형 위치(출석·일지)에서 부모가 배치 조회한 결과를 넘길 때.
//   2) profileId : 이 컴포넌트가 스스로 조회한다.
//                단일 위치(학생증·멤버 상세)에서 편하게 쓸 때.
//   ※ badges 가 주어지면 profileId 는 무시(중복 조회 방지).
//
// 안정성
//   · 뱃지 없거나 조회 실패면 아무것도 그리지 않는다(null). 기존 레이아웃 무영향.
//   · SVG 는 색이 파일에 하드코딩된 <img> 로 로드. 실패해도 alt 만 남고 깨지지 않음.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useState } from "react";
import {
  type UserBadge,
  listBadgesForProfile,
} from "@/lib/badge-helpers";

type BadgeRowProps = {
  // 방식 1 : 이미 조회한 배열
  badges?: UserBadge[];
  // 방식 2 : profileId 로 자체 조회 (badges 미제공 시에만)
  profileId?: string;

  // 아이콘 한 변 크기(px). 위치별로 조정.
  size?: number;
  // 아이콘 사이 간격(px).
  gap?: number;
  // 최대 표시 개수. 넘치면 잘라서 표시(과밀 방지). 0/미지정이면 전부.
  max?: number;
  // 컨테이너 추가 스타일 (정렬 위치 미세조정용).
  style?: React.CSSProperties;
  // 접근성/툴팁용 접두. 예: "쿠도 신이치 · " → "쿠도 신이치 · 리듬감 순위권"
  titlePrefix?: string;
};

export default function BadgeRow({
  badges,
  profileId,
  size = 20,
  gap = 3,
  max = 0,
  style,
  titlePrefix = "",
}: BadgeRowProps) {
  // 자체 조회 모드용 상태
  const [fetched, setFetched] = useState<UserBadge[] | null>(null);

  useEffect(() => {
    // badges 가 직접 주어지면 조회하지 않음
    if (badges) return;
    if (!profileId) {
      setFetched([]);
      return;
    }
    let alive = true;
    listBadgesForProfile(profileId).then((list) => {
      if (alive) setFetched(list);
    });
    return () => {
      alive = false;
    };
  }, [badges, profileId]);

  // 최종 표시 목록 결정
  const list = badges ?? fetched ?? [];
  if (list.length === 0) return null;

  const shown = max && max > 0 ? list.slice(0, max) : list;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        ...style,
      }}
    >
      {shown.map((b) => (
        <img
          key={b.awardId}
          src={b.iconPath}
          alt={b.name}
          title={`${titlePrefix}${b.name}`}
          width={size}
          height={size}
          style={{ display: "block", flex: "none" }}
        />
      ))}
    </div>
  );
}
