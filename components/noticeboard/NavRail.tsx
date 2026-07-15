// components/noticeboard/NavRail.tsx
//
// NoticeBoard 좌측 스티커 탭 4개.
//
// 각 탭이 색·모서리·회전 각도가 다 다름 → NAV 데이터 배열로 관리,
// CSS variable로 인젝션해서 스타일 driven하게 처리.
//
// Tab 타입은 여기서 export → NoticeBoard가 import해서 state 관리.
//
// Props:
//   - activeTab:  현재 열린 탭 (닫혀있으면 null → 어느 탭도 하이라이트 안 됨)
//   - onTabClick: 탭 클릭 시 부모가 open/tab state + flip 애니메이션 처리

"use client";

import type { CSSProperties } from "react";
import styles from "./NavRail.module.css";

export type Tab = "notice" | "member" | "daily" | "shop";

type NavItem = {
  key:    Tab;
  label:  string;
  border: string;
  hi:     string;   // active 하이라이트 배경
  color:  string;   // 텍스트 색
  radius: string;   // border-radius (4모서리 다르게)
  rot:    string;   // 회전 각도
};

const NAV: NavItem[] = [
  { key: "notice", label: "📌 공지사항", border: "#2ea3dd", hi: "#cdeeff", color: "#0d6fa8", radius: "18px 18px 18px 6px",  rot: "-2deg"   },
  { key: "member", label: "👥 멤버",     border: "#4db6a0", hi: "#c9f2e6", color: "#1e7d6a", radius: "6px 18px 18px 18px",  rot: "1.5deg"  },
  { key: "daily",  label: "✅ 일일",     border: "#d9b62a", hi: "#fff3a6", color: "#8a7410", radius: "18px 6px 18px 18px",  rot: "-1deg"   },
  { key: "shop",   label: "🛒 상점",     border: "#4a7fe0", hi: "#d8e5fc", color: "#2a55b8", radius: "18px 18px 6px 18px",  rot: "2deg"    },
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
          >
            {active ? <span className={styles.highlight} /> : null}
            <span className={styles.label}>{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
}