// components/noticeboard/widgets/PracticeLogWidget.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습일지 위젯 (핑크 버튼)
// ═══════════════════════════════════════════════════════════════════
//
// 시안: 핑크(#ff6f7f) 둥근 버튼, 흰 테두리, "연습일지" 흰 볼드.
// 지금은 모양만(정적). 클릭 시 동작(연습일지 열기 등)은 추후 연결.
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./SideWidgets.module.css";

type Props = {
  onClick?: () => void;
};

export default function PracticeLogWidget({ onClick }: Props) {
  return (
    <button type="button" className={styles.practiceBtn} onClick={onClick}>
      연습일지
    </button>
  );
}
