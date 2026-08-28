// components/session-chat/Loader.tsx
//
// 세션룸 로딩(방 최초 조회) 중 표시하는 로더.
// Uiverse.io by Donewenfu 의 jimu-primary-loading 를 CSS 모듈로 옮긴 것.
//   · 세 개의 막대가 시차를 두고 튀는 애니메이션.
//   · 접근성: 컨테이너에 role="status" + 숨김 텍스트. 막대는 aria-hidden.
//   · prefers-reduced-motion 은 CSS 모듈에서 애니메이션을 멈춘다.

"use client";

import styles from "./Loader.module.css";

type Props = {
  /** 스크린리더용 안내. 기본 "불러오는 중". */
  label?: string;
};

export default function Loader({ label = "불러오는 중" }: Props) {
  return (
    <div className={styles.loaderWrap} role="status" aria-live="polite">
      <div className={styles.loader} aria-hidden="true">
        <span className={styles.bar} />
      </div>
      <span className={styles.srOnly}>{label}</span>
    </div>
  );
}
