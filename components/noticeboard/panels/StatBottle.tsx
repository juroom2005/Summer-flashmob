// components/noticeboard/panels/StatBottle.tsx
// ═══════════════════════════════════════════════════════════════════
// 스탯 유리병 · 툴팁 컴포넌트
// ═══════════════════════════════════════════════════════════════════
//
// 배경 : v8 §4-1 MyPanel 유리병 UI 개편.
//   - 액체 색상 = 레벨별 (Lv0~Lv4 고정 색상, Lv5 무지개 애니메이션)
//   - 액체 높이 = 현재 레벨 구간 내 진행률
//   - 마우스오버 시 툴팁 표시 (스탯명 · 레벨 · 명칭 · 경험치 / 다음까지)
//
// 툴팁 위치 계산 :
//   두 단계로 진행. 첫 렌더 시엔 툴팁 크기를 모르니 offscreen 에 그린 뒤,
//   실제 크기를 측정해 병 상단 위 정중앙에 오도록 좌표를 확정한다.
//
//   1) hovered=true → 툴팁을 opacity:0 으로 offscreen 렌더 (측정용)
//   2) useLayoutEffect 에서 툴팁·병 좌표 측정 → 좌상단 좌표 계산
//   3) 좌표 확정 후 툴팁 opacity 1 로 표시
//
//   transform 은 아예 안 쓴다. 좌상단 위치 (top, left) 만으로 배치.
//   → 부모의 transform / animation / flex 어떤 것에도 영향 없음.
//
// 이 컴포넌트는 표시 전용. 데이터 fetch·저장 없음.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  STAT_META,
  getLevelProgress,
  getLevelName,
  LEVEL_MAX,
  type StatKey,
} from "@/lib/stat-helpers";
import styles from "./StatBottle.module.css";

// ────────────────────────────────────────────────────────────────────
// 레벨별 색상 (v8 §4-1 임시 안. 추후 조정 예정)
// ────────────────────────────────────────────────────────────────────
const LEVEL_COLORS: readonly string[] = [
  "#c8dae8",  // Lv0 : 흐린 회색
  "#a8dcf5",  // Lv1 : 옅은 하늘
  "#4db6a0",  // Lv2 : 청록
  "#4a7fe0",  // Lv3 : 파랑
  "#a855f7",  // Lv4 : 보라
  "#4a7fe0",  // Lv5 : 폴백 (실제 렌더는 rainbow)
] as const;

// 툴팁과 병 사이 여백 (px)
const TOOLTIP_GAP = 8;

function findTransformedAncestor(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const t = getComputedStyle(cur).transform;
    if (t && t !== "none") return cur;
    cur = cur.parentElement;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────
type Props = {
  statKey: StatKey;
  exp:     number;
  level:   number;
};

type TooltipPos = { top: number; left: number } | null;



// ────────────────────────────────────────────────────────────────────
// 본체
// ────────────────────────────────────────────────────────────────────
export default function StatBottle({ statKey, exp, level }: Props) {
  const [hovered, setHovered] = useState(false);
  const [tipPos,  setTipPos]  = useState<TooltipPos>(null);

  const bottleRef  = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const meta      = STAT_META[statKey];
  const progress  = getLevelProgress(exp);
  const isMaxLv   = level >= LEVEL_MAX;

  const heightPct = isMaxLv ? 100 : Math.round(progress.ratio * 100);
  const color     = LEVEL_COLORS[Math.min(level, LEVEL_MAX)] ?? LEVEL_COLORS[0];

  const insideTextColor  = heightPct >= 30 ? "#fff" : "#7fb3d4";
  const insideTextShadow = heightPct >= 30 ? "0 1px 2px rgba(8, 50, 90, 0.5)" : "none";


    useLayoutEffect(() => {
        if (!hovered) {
        setTipPos(null);
        return;
        }
        const bottleEl  = bottleRef.current;
        const tooltipEl = tooltipRef.current;
        if (!bottleEl || !tooltipEl) return;

        // 함정 회피 : 조상 요소에 transform 이 걸려 있으면 position: fixed 의
        // containing block 이 뷰포트가 아니라 그 조상이 된다 (MyPanel 서랍이
        // 이 경우에 해당). getBoundingClientRect 는 뷰포트 좌표를 반환하므로,
        // 툴팁의 fixed 좌표를 그 조상 기준으로 변환해야 한다.
        //
        // 변환 : rect(뷰포트) - 조상_rect(뷰포트) = 조상 안 상대 좌표.
        // 조상을 찾는 기준 : 툴팁이 붙는 부모(.cell) 부터 위로 올라가며
        // getComputedStyle(el).transform !== 'none' 인 첫 요소.
        const containingBlock = findTransformedAncestor(bottleEl) ?? null;
        const offsetTop  = containingBlock ? containingBlock.getBoundingClientRect().top  : 0;
        const offsetLeft = containingBlock ? containingBlock.getBoundingClientRect().left : 0;

        const bottleRect  = bottleEl.getBoundingClientRect();
        const tooltipRect = tooltipEl.getBoundingClientRect();

        const top  = bottleRect.top  - offsetTop  - TOOLTIP_GAP - tooltipRect.height;
        const left = bottleRect.left - offsetLeft + bottleRect.width / 2 - tooltipRect.width / 2;

        setTipPos({ top, left });
    }, [hovered]);

  return (
    <div
      className={styles.cell}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 툴팁 : 두 단계 렌더.
          - tipPos 가 null 이면 offscreen(-9999px) 에 렌더하여 크기만 측정.
          - tipPos 가 확정되면 그 좌표로 이동 + opacity 1 로 표시.
          transform 은 일절 안 쓴다 (부모 애니메이션/변형 영향 회피). */}
      {hovered ? (
        <div
          ref={tooltipRef}
          className={styles.tooltip}
          style={
            tipPos
              ? { top: tipPos.top, left: tipPos.left, opacity: 1 }
              : { top: -9999, left: -9999, opacity: 0 }
          }
        >
          <div className={styles.tooltipStat}>{meta.label}</div>
          <div className={styles.tooltipLevel}>
            Lv.{level} {getLevelName(statKey, level)}
          </div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipExp}>
            {isMaxLv ? (
              "최상위 레벨 도달"
            ) : (
              <>
                경험치{" "}
                <span className={styles.tooltipExpValue}>
                  {progress.gained} / {progress.needed}
                </span>
                <br />
                다음 레벨까지 {progress.toNext}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* 병뚜껑 */}
      <div className={styles.cap} />

      {/* 유리병 본체 */}
      <div
        ref={bottleRef}
        className={`${styles.bottle}${isMaxLv ? " " + styles.bottleFull : ""}`}
      >
        <div
          className={`${styles.liquid}${isMaxLv ? " " + styles.liquidRainbow : ""}`}
          style={{
            height:          `${heightPct}%`,
            backgroundColor: isMaxLv ? undefined : color,
          }}
        >
          {heightPct > 0 ? (
            <>
              <div className={styles.liquidWave} />
              <div className={styles.bubble1} />
              <div className={styles.bubble2} />
            </>
          ) : null}
        </div>

        <span
          className={styles.levelText}
          style={{
            color:      insideTextColor,
            textShadow: insideTextShadow,
          }}
        >
          Lv.{level}
        </span>
      </div>

      <span className={styles.statLabel}>{meta.label}</span>
    </div>
  );
}