// components/noticeboard/NavRail.tsx
//
// NoticeBoard 좌측 스티커 탭.
//
// 각 탭이 색·모서리·회전 각도가 다 다름 → NAV 데이터 배열로 관리,
// CSS variable로 인젝션해서 스타일 driven하게 처리.
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
//   ※ Tab 타입에 board/notice/system/world 신설.
//     NoticeBoard 라우팅 개조(2-B)는 별도 단계.

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
  key:    Tab;
  label:  string;
  border: string;   // 테두리 색
  hi:     string;   // active 하이라이트 배경
  color:  string;   // 텍스트 색
  radius: string;   // border-radius (4모서리 다르게)
  rot:    string;   // 회전 각도
};

// 색은 tokens.css 시안 팔레트에서 가져온 실제 값.
//   board  : 시안 주 파랑    #3f88f9 / 연파랑 #cce3f8
//   notice : 시안 NOTICE 파랑 #2563eb / 연파랑 #dbeafe
//   system : 시안 SYSTEM 핑크 #ec4899 / 연핑크 #fce7f3
//   world  : 시안 WORLD  청록 #06b6d4 / 연청록 #cffafe
//   member : 시안 노랑     #facc15 / 연노랑 #fef08a
//   store  : 시안 강조노랑  #f8e31a / 연노랑 #fdf6b2
//   daily  : 시안 남색     #1a335e / 연파랑 #d6e4f5
const NAV: NavItem[] = [
  { key: "board",  label: "보드",   border: "#3f88f9", hi: "#cce3f8", color: "#0d3b8a", radius: "18px 18px 18px 6px", rot: "-2deg"  },
  { key: "notice", label: "공지",   border: "#2563eb", hi: "#dbeafe", color: "#1a337a", radius: "6px 18px 18px 18px", rot: "1.5deg" },
  { key: "system", label: "시스템", border: "#ec4899", hi: "#fce7f3", color: "#9d1852", radius: "18px 6px 18px 18px", rot: "-1deg"  },
  { key: "world",  label: "월드",   border: "#06b6d4", hi: "#cffafe", color: "#0a6577", radius: "18px 18px 6px 18px", rot: "2deg"   },
  { key: "member", label: "멤버",   border: "#facc15", hi: "#fef08a", color: "#8a6d10", radius: "18px 18px 18px 6px", rot: "-1.5deg"},
  { key: "store",  label: "매점",   border: "#f8e31a", hi: "#fdf6b2", color: "#7a6a12", radius: "6px 18px 18px 18px", rot: "1deg"   },
  { key: "daily",  label: "데일리", border: "#1a335e", hi: "#d6e4f5", color: "#1a335e", radius: "18px 6px 18px 18px", rot: "-1deg"  },
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

        // 각 탭의 색·회전을 CSS variable로 인젝션
        const cssVars = {
          "--tab-border":  n.border,
          "--tab-hi":      n.hi,
          "--tab-color":   n.color,
          "--tab-radius":  n.radius,
          "--tab-rot":     n.rot,
          "--tab-shadow": `${n.border}80`,  // hex + alpha 50%
        } as CSSProperties;

        return (
          <button
            key={n.key}
            onClick={() => onTabClick(n.key)}
            className={styles.tab}
            style={cssVars}
            aria-current={active ? "page" : undefined}
          >
            {active ? <span className={styles.highlight} /> : null}
            <span className={styles.label}>{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
}