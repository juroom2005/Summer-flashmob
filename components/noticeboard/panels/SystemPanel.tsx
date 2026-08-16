// components/noticeboard/panels/SystemPanel.tsx
// ═══════════════════════════════════════════════════════════════════
// SYSTEM 탭 — 메뉴(폴더 5개) ↔ 상세(스탯 등) 슬라이드 전환
// ═══════════════════════════════════════════════════════════════════
//
// · 메뉴 화면: 폴더 5개(스탯/뱃지/일일활동/일지/매점). 호버 시 열림.
//   폴더 클릭 → 해당 상세로 오른쪽 슬라이드 전환.
// · 상세 화면: SystemDetailView. 뒤로가기 → 메뉴 복귀,
//   왼쪽 메뉴 항목 → 다른 상세로 전환.
//
// 슬라이드: 메뉴/상세를 track 위에 나란히 두고 translateX 로 이동.
// 상세는 activeDetail 이 있을 때만 렌더(없으면 빈 자리). 전환 중 잔상
// 방지를 위해 상세는 항상 마운트하되 activeDetail 로 내용 스왑.
//
// 폴더 애니메이션은 Uiverse(Cobp) → CSS 변환.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useState, useCallback } from "react";
import styles from "./SystemPanel.module.css";
import SystemDetailView from "./SystemDetailView";

const FOLDERS = [
  { id: "stat", label: "스탯" },
  { id: "badge", label: "뱃지" },
  { id: "daily", label: "일일활동" },
  { id: "log", label: "일지" },
  { id: "shop", label: "매점" },
];

function FolderCard({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.item} onClick={onClick}>
      <div className={styles.folderGroup}>
        <div className={styles.file}>
          <div className={styles.back} />
          <div className={`${styles.paper} ${styles.paper4}`} />
          <div className={`${styles.paper} ${styles.paper3}`} />
          <div className={`${styles.paper} ${styles.paper2}`} />
          <div className={styles.front} />
        </div>
      </div>
      <p className={styles.label}>{label}</p>
    </button>
  );
}

export default function SystemPanel() {
  const [activeDetail, setActiveDetail] = useState<string | null>(null);

  const open = useCallback((id: string) => setActiveDetail(id), []);
  const back = useCallback(() => setActiveDetail(null), []);

  const row1 = FOLDERS.slice(0, 3);
  const row2 = FOLDERS.slice(3);

  return (
    <div className={`${styles.root} ${activeDetail ? styles.rootDetail : ""}`}>
      {activeDetail ? (
        <div key={activeDetail} className={styles.slideIn}>
          <SystemDetailView
            activeId={activeDetail}
            onBack={back}
            onNavigate={open}
          />
        </div>
      ) : (
        <div key="menu" className={styles.menu}>
          <h2 className={styles.heading}>SYSTEM</h2>
          <div className={styles.rows}>
            <div className={styles.row}>
              {row1.map((f) => (
                <FolderCard
                  key={f.id}
                  label={f.label}
                  onClick={() => open(f.id)}
                />
              ))}
            </div>
            <div className={styles.row}>
              {row2.map((f) => (
                <FolderCard
                  key={f.id}
                  label={f.label}
                  onClick={() => open(f.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}