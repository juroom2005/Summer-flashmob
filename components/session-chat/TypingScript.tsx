// components/session-chat/TypingScript.tsx
//
// 스크립트 타이핑 효과.
//   · 원문(마크다운 소스)을 타자 치듯 한 글자씩 노출하다가,
//     다 치면 마크다운 렌더 결과로 교체한다.
//     (마크다운을 렌더한 채로 타이핑하면 서식이 깨져 보이므로 원문 → 완료 후 교체)
//   · 커서(깜빡이는 세로선)는 타이핑 중에만.
//   · 타이핑 대상은 부모가 "이번에 새로 도착한 최신 스크립트 1개"로 제한한다.
//     과거 스크립트는 animate=false 로 넘겨 즉시 렌더.
//   · prefers-reduced-motion 이면 애니메이션 없이 즉시 렌더(접근성).
//   · 진행 중 content 가 바뀌면(수정 등) 타이핑을 버리고 최종본으로 정착.
//
// 접근성: 타이핑 중 텍스트는 aria-hidden(부분 글자가 스크린리더에 읽히지 않게),
//         완료된 최종 렌더는 정상 노출.

"use client";

import { useEffect, useRef, useState } from "react";
import MarkdownView from "./MarkdownView";
import styles from "./Session.module.css";

type Props = {
  content: string;
  /** true 면 타이핑, false 면 즉시 마크다운 렌더. */
  animate: boolean;
  /** 한 스텝 간격(ms). 클수록 툭툭 끊기는 느낌. */
  speedMs?: number;
  /** 타이핑이 한 글자 진행될 때마다 호출(자동 스크롤 추적용). */
  onTick?: () => void;
  /** 타이핑 종료 시 1회 호출. */
  onDone?: () => void;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function TypingScript({
  content,
  animate,
  speedMs = 55,
  onTick,
  onDone,
}: Props) {
  // 타이핑을 실제로 돌릴지: animate 이고 모션 허용일 때만.
  const [typing, setTyping] = useState(false);
  const [shown, setShown] = useState(""); // 현재까지 노출된 원문 조각
  const doneCalledRef = useRef(false);
  // 이 content 에 대해 타이핑을 이미 완료/시작했는지 — 재실행으로 재타이핑되는 것 방지.
  const animatedForRef = useRef<string | null>(null);

  useEffect(() => {
    const run = animate && !prefersReducedMotion() && content.length > 0;

    // content 가 바뀌면 타이핑 기회 초기화(수정 반영).
    if (animatedForRef.current !== content) {
      animatedForRef.current = null;
    }

    if (!run) {
      // 아직 이 content 를 타이핑한 적 없으면 즉시 전체 표시.
      // (animate=false 상태. 나중에 true 로 바뀌면 아래 분기에서 타이핑 시작)
      if (animatedForRef.current !== content) {
        setTyping(false);
        setShown(content);
      }
      return;
    }

    // run=true 인데 이미 이 content 로 타이핑을 시작/완료했으면 다시 안 함.
    if (animatedForRef.current === content) {
      return;
    }
    animatedForRef.current = content;

    setTyping(true);
    setShown("");
    doneCalledRef.current = false;

    let i = 0;
    // "딱딱 끊기는" 타자 리듬:
    //   한 번에 CHUNK 글자씩 툭 내보내고, 간격(interval)을 조금 벌린다.
    //   긴 스크립트는 총 MAX_MS(약 6초) 안에 끝나도록 chunk 를 키워 보정.
    const MAX_MS = 6000;
    const interval = Math.max(45, speedMs); // 프레임보다 큰 간격이라야 스텝감이 남
    const baseChunk = 2;                     // 기본 2글자씩
    const neededChunk = Math.ceil(content.length / (MAX_MS / interval));
    const chunk = Math.max(baseChunk, neededChunk);

    const timer = setInterval(() => {
      i = Math.min(content.length, i + chunk);
      setShown(content.slice(0, i));
      onTick?.();
      if (i >= content.length) {
        clearInterval(timer);
        setTyping(false);
        if (!doneCalledRef.current) {
          doneCalledRef.current = true;
          onDone?.();
        }
      }
    }, interval);

    return () => clearInterval(timer);
    // animate 가 false→true 로 바뀌는 순간도 잡아야 하므로 deps 에 animate 포함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, animate]);

  if (typing) {
    return (
      <div className={styles.typingWrap}>
        <pre className={styles.typingText} aria-hidden="true">
          {shown}
          <span className={styles.caret} />
        </pre>
        {/* 스크린리더에는 완성된 원문을 한 번에 제공 */}
        <span className={styles.srOnly}>{content}</span>
      </div>
    );
  }

  return <MarkdownView content={content} />;
}