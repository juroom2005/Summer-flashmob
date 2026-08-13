// components/noticeboard/panels/StaticDocPanel.tsx
// ═══════════════════════════════════════════════════════════════════
// 정적 문서 패널 (NOTICE / SYSTEM / WORLD 공용)
// ═══════════════════════════════════════════════════════════════════
//
// 이 세 탭의 내용은 웹사이트 자체의 룰·공지로, 동적 데이터가 아니라
// 하드코딩된 정적 문서다 (원본은 구글문서로 공개).
//
// 구조가 셋 다 동일하므로 docKey 로 분기하여 한 컴포넌트로 처리한다.
// 지금은 로렘입숨 뼈대만 넣어두고, 실제 내용은 DOCS 객체의 각
// 섹션 title·body 를 교체하면 된다. 섹션 추가/삭제도 배열로 자유.
//
// 내용 채우는 법:
//   DOCS["notice"].sections 배열에 { title, body } 를 넣으면
//   그대로 렌더됨. body 는 문단 배열(string[]).
//
// 후속:
//   · 필요 시 구글문서 → 마크다운/HTML 파이프라인으로 교체 가능하나,
//     현재는 정적이라 하드코딩이 가장 안전·단순.
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./StaticDocPanel.module.css";

export type DocKey = "notice" | "system" | "world";

type DocSection = {
  title: string;
  body:  string[];   // 문단들
};

type DocContent = {
  heading: string;
  sections: DocSection[];
};

// 로렘입숨 자리표시. 실제 내용으로 교체 예정.
const LOREM = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
];

const DOCS: Record<DocKey, DocContent> = {
  notice: {
    heading: "공지사항",
    sections: [
      { title: "Lorem ipsum", body: LOREM },
      { title: "Dolor sit amet", body: LOREM },
    ],
  },
  system: {
    heading: "시스템 안내",
    sections: [
      { title: "Lorem ipsum", body: LOREM },
      { title: "Consectetur", body: LOREM },
    ],
  },
  world: {
    heading: "월드",
    sections: [
      { title: "Lorem ipsum", body: LOREM },
      { title: "Adipiscing elit", body: LOREM },
    ],
  },
};

type Props = {
  docKey: DocKey;
};

export default function StaticDocPanel({ docKey }: Props) {
  const doc = DOCS[docKey];

  return (
    <article className={styles.doc}>
      <h2 className={styles.heading}>{doc.heading}</h2>

      {doc.sections.map((sec, i) => (
        <section key={i} className={styles.section}>
          <h3 className={styles.sectionTitle}>{sec.title}</h3>
          {sec.body.map((para, j) => (
            <p key={j} className={styles.para}>
              {para}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
