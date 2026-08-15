// components/noticeboard/NavRail.tsx
//
// NoticeBoard 좌측 탭 — 폴더 왼쪽 모서리에 물린 "북마크/서류철 인덱스" 형태.
//
// 각 탭이 색만 다름 → NAV 데이터 배열로 관리, CSS variable로 인젝션.
//
// Tab 타입은 여기서 export → NoticeBoard가 import해서 state 관리.
//
// Props:
//   - activeTab:  현재 열린 탭
//   - onTabClick: 탭 클릭 시 부모가 탭 전환 처리
//
// ── 2026-08 리뉴얼 (Anima 시안) ──
//   · 탭 4개 → 7개로 확장.
//   · 순서: BOARD(기본/대시보드) → 정적 3개(NOTICE·SYSTEM·WORLD)
//           → 동적 3개(MEMBER·STORE·DAILY).
//   · 색은 tokens.css 시안 팔레트 참조 (CSS 변수).
//   · 라벨 이모티콘 전부 제거 (리뉴얼 방침).
//   · 탭 명칭: shop → store (시안 STORE).
//
// ── 2026-08 후속 (북마크형 교체) ──
//   · 시안대로 폴더 왼쪽 모서리에 물린 각진 북마크형으로 교체.
//   · 회전·둥근 모서리·스티커 그림자 제거.
//   · 탭 오른쪽 끝이 폴더 프레임 왼쪽에 살짝 겹쳐 "물린" 느낌.
//     (겹침·위치 값은 NavRail.module.css 상단 주석 참조. 폴더 FRAME_LEFT
//      바뀌면 .rail left 도 같이 조정.)
//   · 활성 탭은 폴더 쪽으로 살짝 더 나오고 색이 진해짐.

"use client";

import type { CSSProperties } from "react";
import styles from "./NavRail.module.css";

export type Tab =
  | "board"
  | "notice"
  | "system"
  | "world"
  | "member"
  | "store"
  | "daily";

type NavItem = {
  key:   Tab;
  label: string;
  fill:  string;   // 탭 전체 채움 색 (시안: 탭이 색으로 꽉 참)
};

// 색은 tokens.css 시안 팔레트 기준. 탭 전체를 이 색으로 채우고 글씨는 흰색.
//   board  : 시안 주 파랑    #3f88f9
//   notice : 시안 NOTICE 파랑 #2563eb
//   system : 시안 SYSTEM 핑크 #ec4899
//   world  : 시안 WORLD  노랑 #facc15
//   member : 시안 MEMBER 청록 #06b6d4
//   store  : 시안 STORE  연노랑 #f8e31a
//   daily  : 시안 남색     #1a335e
const NAV: NavItem[] = [
  { key: "board",  label: "BOARD",  fill: "#3f88f9" },
  { key: "notice", label: "NOTICE", fill: "#2563eb" },
  { key: "system", label: "SYSTEM", fill: "#ec4899" },
  { key: "world",  label: "WORLD",  fill: "#facc15" },
  { key: "member", label: "MEMBER", fill: "#06b6d4" },
  { key: "store",  label: "STORE",  fill: "#f8e31a" },
  { key: "daily",  label: "DAILY",  fill: "#1a335e" },
];

type Props = {
  activeTab:  Tab | null;
  onTabClick: (key: Tab) => void;
};

export default function NavRail({ activeTab, onTabClick }: Props) {
  return (
    <nav className={styles.rail}>
      {NAV.map((n) => {
        const active = activeTab === n.key;

        // 밝은 노랑 계열(world/store)은 흰 글씨가 안 보임 → 어두운 글씨.
        const darkText = n.key === "world" || n.key === "store";

        // 탭 전체 채움 색·글씨색·그림자를 CSS variable로 인젝션
        const cssVars = {
          "--tab-fill":   n.fill,
          "--tab-text":   darkText ? "#1a335e" : "#ffffff",
          "--tab-shadow": `${n.fill}66`, // hex + alpha 40%
        } as CSSProperties;

        return (
          <button
            key={n.key}
            onClick={() => onTabClick(n.key)}
            className={`${styles.tab} ${active ? styles.active : ""}`}
            style={cssVars}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.label}>{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
}