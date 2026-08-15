// components/noticeboard/panels/NoticeDocPanel.tsx
// ═══════════════════════════════════════════════════════════════════
// NOTICE 탭 본문 (4섹션). 내비게이터는 폴더 바깥(NoticeNavRail)으로 분리됨.
// ═══════════════════════════════════════════════════════════════════
//
// system/world 와 달리 notice 탭은 4개 섹션을 한 스크롤에 담는다.
// 이전 버전은 우측에 sticky 내비게이터를 품었으나, 콘텐츠 영역이
// 좁아 본문을 침범해 폴더 바깥으로 분리했다(→ NoticeNavRail).
//
// 이 컴포넌트는 본문만 렌더한다. 각 섹션 엘리먼트에 sectionDomId 로
// DOM id 를 부여해 두면, 폴더 바깥 내비게이터가 그 id 로 스크롤·관찰한다.
//
// 폰트: 타이틀 'Stretch Pro' 48px / 본문 'KoPubWorld Dotum' 16px
//       (globals.css @font-face 등록).
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./NoticeDocPanel.module.css";
import {
  NOTICE_SECTIONS,
  sectionDomId,
  type Block,
  type Section,
  type TitleKind,
} from "./noticeSections";

// ── 타이틀 렌더 ────────────────────────────────────────────────────
function Title({
  text,
  kind,
  small,
}: {
  text: string;
  kind: TitleKind;
  small?: boolean;
}) {
  const cls = `${styles.title} ${small ? styles.titleSm : ""}`;
  if (kind === "plain") {
    return (
      <h2 className={`${cls} ${styles.titleCenter}`}>
        <span className={styles.titlePlain}>{text}</span>
      </h2>
    );
  }
  const hiCls = kind === "yellow" ? styles.titleHiYellow : styles.titleHiBlue;
  return (
    <h2 className={cls}>
      <span className={`${styles.titleHi} ${hiCls}`}>{text}</span>
    </h2>
  );
}

// ── 블록 렌더 ──────────────────────────────────────────────────────
function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return (
        <p className={`${styles.para} ${block.blue ? styles.paraBlue : ""}`}>
          {block.text}
        </p>
      );
    case "list":
      return (
        <ul className={styles.list}>
          {block.items.map((it, i) => (
            <li
              key={i}
              className={`${styles.li} ${
                it.marker === "chevron" ? styles.liChevron : styles.liSquare
              } ${it.blue ? styles.liBlue : ""}`}
            >
              {it.text}
            </li>
          ))}
        </ul>
      );
    case "dots":
      return (
        <ul className={styles.list}>
          {block.items.map((it, i) => (
            <li
              key={i}
              className={`${styles.li} ${styles.liDot} ${styles.liBlue}`}
            >
              {it}
            </li>
          ))}
        </ul>
      );
    case "note":
      return <p className={styles.note}>{block.text}</p>;
    case "callout":
      return (
        <div className={styles.callout}>
          {block.lines.map((ln, i) => (
            <p key={i} className={styles.calloutLine}>
              {ln}
            </p>
          ))}
        </div>
      );
    case "tail":
      return <p className={styles.tail}>{block.text}</p>;
    default:
      return null;
  }
}

// ── 섹션 본문 렌더 ─────────────────────────────────────────────────
function SectionBody({ sec }: { sec: Section }) {
  if (sec.layout === "single") {
    return (
      <>
        <Title text={sec.title} kind={sec.titleKind} />
        <div className={styles.body}>
          {sec.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      </>
    );
  }
  return (
    <div className={styles.twoCol}>
      <div className={styles.col}>
        <Title text={sec.left.title} kind={sec.left.titleKind} small />
        <div className={styles.body}>
          {sec.left.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      </div>
      <div className={styles.col}>
        <Title text={sec.right.title} kind={sec.right.titleKind} small />
        <div className={styles.body}>
          {sec.right.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 메인 (본문만) ──────────────────────────────────────────────────
export default function NoticeDocPanel() {
  return (
    <div className={styles.root}>
      {NOTICE_SECTIONS.map((sec: Section) => (
        <section
          key={sec.id}
          id={sectionDomId(sec.id)}
          data-section-id={sec.id}
          className={styles.section}
        >
          <SectionBody sec={sec} />
        </section>
      ))}
    </div>
  );
}