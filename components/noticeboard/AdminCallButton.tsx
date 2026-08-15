// components/noticeboard/AdminCallButton.tsx
// ═══════════════════════════════════════════════════════════════════
// 관리자호출(채팅 문의) 버튼
// ═══════════════════════════════════════════════════════════════════
//
// Uiverse.io (vinodjangid07) 확장 버튼 스타일을 적용.
//   평소: 원형 아이콘만. hover: 옆으로 늘어나며 "채팅 문의" 문구 노출.
//   아이콘: 전화 모양(SVG). 문구: 채팅 문의.
//
// 뱃지는 버튼 밖으로 나와야 하므로 wrapper(overflow 없음) 기준으로 배치.
//   확장 버튼은 wrapper 안(overflow:hidden 은 버튼에만).
//
// 기능(클릭 핸들러·미읽음 뱃지)은 부모(NoticeBoard)가 prop 으로 주입.
//   - onClick: 로그인 체크 + admin 토글 (기존 로직 유지)
//   - unread : 미읽음 수(유저=메시지 수 / GM=방 수). 0이면 뱃지 숨김.
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./AdminCallButton.module.css";

type Props = {
  onClick: () => void;
  unread?: number;
};

export default function AdminCallButton({ onClick, unread = 0 }: Props) {
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        onClick={onClick}
        aria-label="채팅 문의"
      >
        <span className={styles.sign}>
          {/* 전화 아이콘 */}
          <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z" />
          </svg>
        </span>

        <span className={styles.text}>채팅 문의</span>
      </button>

      {unread > 0 ? (
        <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </div>
  );
}
