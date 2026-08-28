// components/session-chat/MarkdownView.tsx
//
// GM 스크립트용 마크다운 렌더러.
//
// 보안:
//   · react-markdown 기본값은 raw HTML 을 렌더하지 않는다(rehype-raw 미사용).
//     GM 이 <script> 를 적어도 HTML 로 해석되지 않는다.
//   · 링크 URL 은 기본 urlTransform 이 http/https/mailto 등만 허용. javascript: 차단.
//   · 외부 링크는 새 탭 + rel="noopener noreferrer".
//   · 이미지는 렌더하지 않는다(외부 이미지 추적·거대 이미지 사고 방지). alt 텍스트만.
//
// 접근성:
//   · 시맨틱 HTML 그대로(제목·목록·표). 표는 overflow 래퍼로 가로 스크롤.

"use client";

import type {
  AnchorHTMLAttributes,
  BlockquoteHTMLAttributes,
  ImgHTMLAttributes,
  TableHTMLAttributes,
} from "react";
import type { Element, ElementContent, Text } from "hast";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./Session.module.css";

/** hast 노드에서 순수 텍스트를 재귀로 모은다. */
function collectText(nodes: ElementContent[] | undefined): string {
  if (!nodes) return "";
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") {
      out += (n as Text).value;
    } else if (n.type === "element") {
      const el = n as Element;
      // <br> 는 줄바꿈으로
      if (el.tagName === "br") out += "\n";
      else out += collectText(el.children);
    }
  }
  return out;
}

const components: Components = {
  a({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img({ alt }: ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
    return <span className={styles.mdImgAlt}>[이미지: {alt || "설명 없음"}]</span>;
  },
  table({ children }: TableHTMLAttributes<HTMLTableElement> & ExtraProps) {
    return (
      <div className={styles.mdTableWrap}>
        <table>{children}</table>
      </div>
    );
  },
  // > 인용구를 "선택지" 목록으로. 각 줄(> 로 시작한 줄)이 개별 선택지 박스가 된다.
  //   예)  > 문을 연다
  //        > 다른 곳으로 간다
  //   → 박스 2개. (마크다운은 두 줄을 한 문단의 "a\nb" 텍스트로 합치므로 여기서 쪼갠다)
  blockquote({ node, children }: BlockquoteHTMLAttributes<HTMLQuoteElement> & ExtraProps) {
    const raw = collectText(node?.children as ElementContent[] | undefined);
    const lines = raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // 텍스트를 뽑지 못한 경우(예: 인용구 안에 링크 등 복합 요소)엔 원래 children 을 그대로.
    if (lines.length === 0) {
      return <blockquote className={styles.choiceList}>{children}</blockquote>;
    }
    return (
      <div className={styles.choiceList} role="list" aria-label="선택지">
        {lines.map((line, idx) => (
          <p key={idx} className={styles.choiceItem} role="listitem">
            {line}
          </p>
        ))}
      </div>
    );
  },
};

type Props = { content: string };

export default function MarkdownView({ content }: Props) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}