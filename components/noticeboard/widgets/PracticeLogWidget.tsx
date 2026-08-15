// components/noticeboard/widgets/PracticeLogWidget.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습일지 위젯 (핑크 버튼)
// ═══════════════════════════════════════════════════════════════════
//
// 시안: 핑크(#ff6f7f) 둥근 버튼, 흰 테두리, "연습일지" 흰 볼드.
// hover 시 텍스트가 위로 밀려 올라가고 아래에서 같은 텍스트가 올라오는
// 애니메이션 (Uiverse Rauliqbal 참고, CSS Module 로 이식).
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./SideWidgets.module.css";

type Props = {
  onClick?: () => void;
};

export default function PracticeLogWidget({ onClick }: Props) {
  return (
    <button type="button" className={styles.practiceBtn} onClick={onClick}>
      <span className={styles.practiceBtnInner}>
        <span className={styles.practiceBtnText}>연습일지</span>
        <span className={styles.practiceBtnTextClone} aria-hidden="true">연습일지</span>
      </span>
    </button>
  );
}