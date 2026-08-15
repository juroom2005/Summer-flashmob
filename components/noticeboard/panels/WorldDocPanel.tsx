// components/noticeboard/panels/WorldDocPanel.tsx
// ═══════════════════════════════════════════════════════════════════
// WORLD 탭 본문 (WORLD / Who Is Mob? / 如月學院 / MAP)
// ═══════════════════════════════════════════════════════════════════
//
// notice 와 같은 패턴(본문 + 폴더 바깥 내비게이터). 데이터는
// worldSections.ts 공유. 내비는 WorldNavRail(폴더 바깥)이 담당.
//
// world 는 블록 종류가 많다: 문단·형광소제목·불릿·말풍선(회색/파랑)·
// 단독줄·하단 형광문구·해시태그·학년 라벨 항목.
// MAP 섹션은 placeholder(다음 작업).
//
// 폰트: 타이틀 'Stretch Pro' / 본문 'KoPubWorld Dotum'.
//       한자 제목(如月學院)은 Stretch Pro 에 한자 글리프가 없을 수 있어
//       본문볼드 계열로 폴백(kanji 플래그).
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./WorldDocPanel.module.css";
import MapPanel from "./MapPanel";
import {
  WORLD_SECTIONS,
  worldSectionDomId,
  type WBlock,
  type WorldSection,
} from "./worldSections";

// ── 타이틀 ─────────────────────────────────────────────────────────
function WTitle({ sec }: { sec: WorldSection }) {
  const isPlain = sec.titleKind === "plain";
  const kanjiCls = sec.kanji ? styles.titleKanji : "";
  // 헤딩 아래 구분선은 모든 섹션에. 중앙정렬은 한자 아닌 plain 만.
  const dividerCls = styles.titleDivider;
  const centerCls = isPlain && !sec.kanji ? styles.titleCenter : "";
  if (isPlain) {
    return (
      <h2
        className={`${styles.title} ${centerCls} ${dividerCls} ${kanjiCls}`}
      >
        <span className={styles.titlePlain}>{sec.title}</span>
      </h2>
    );
  }
  return (
    <h2
      className={`${styles.title} ${styles.titleLeft} ${dividerCls} ${kanjiCls}`}
    >
      <span className={`${styles.titleHi} ${styles.titleHiYellow}`}>
        {sec.title}
      </span>
    </h2>
  );
}

// ── 블록 ───────────────────────────────────────────────────────────
function WBlockView({ block }: { block: WBlock }) {
  switch (block.type) {
    case "p":
      return <p className={styles.para}>{block.text}</p>;
    case "subhi":
      return (
        <div className={styles.subhiWrap}>
          <span className={styles.subhi}>{block.text}</span>
        </div>
      );
    case "dots":
      return (
        <ul className={styles.dots}>
          {block.items.map((it, i) => (
            <li key={i} className={styles.dotItem}>
              {it}
            </li>
          ))}
        </ul>
      );
    case "bubble":
      return (
        <div
          className={`${styles.bubbleRow} ${
            block.side === "blue" ? styles.bubbleRowBlue : ""
          }`}
        >
          <span
            className={`${styles.bubble} ${
              block.side === "blue" ? styles.bubbleBlue : styles.bubbleGray
            }`}
          >
            {block.text}
          </span>
        </div>
      );
    case "line":
      return <p className={styles.line}>{block.text}</p>;
    case "marker":
      return (
        <div className={styles.markerWrap}>
          {block.lines.map((ln, i) => (
            <span key={i} className={styles.markerLine}>
              {ln}
            </span>
          ))}
        </div>
      );
    case "tags":
      return (
        <p className={styles.tags}>
          {block.tags.map((t, i) => (
            <span key={i} className={styles.tag}>
              {t}
            </span>
          ))}
        </p>
      );
    case "labeled":
      return (
        <p className={styles.labeled}>
          <span className={styles.labeledLabel}>{block.label}</span>
          <span className={styles.labeledText}>{block.text}</span>
        </p>
      );
    default:
      return null;
  }
}

// ── 메인 ───────────────────────────────────────────────────────────
export default function WorldDocPanel() {
  return (
    <div className={styles.root}>
      {WORLD_SECTIONS.map((sec: WorldSection) => (
        <section
          key={sec.id}
          id={worldSectionDomId(sec.id)}
          data-section-id={sec.id}
          className={styles.section}
        >
          <WTitle sec={sec} />
          <div className={styles.body}>
            {sec.id === "map" ? (
              <MapPanel />
            ) : (
              sec.blocks.map((b, i) => <WBlockView key={i} block={b} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}