// components/admin-chat/SystemDivider.tsx
//
// GM 채팅방의 완료 안내 시스템 메시지 구분선.
// 예: ─── 2026-07-20 14:32 · 완료 ───
//
// 저장 방침 (스키마 sql/2026-07-20_gm_chat.sql):
//   · gm_conversation_messages.content 는 시스템 메시지일 경우 마커 문자열('resolved')일 뿐
//   · 표시 시각은 created_at (진실 공급원, 이중 저장 없음)

import styles from "./SystemDivider.module.css";

type Props = {
  createdAt: string; // ISO
};

/** 로컬(브라우저) 시간 기준 'YYYY-MM-DD HH:mm' 포맷. */
function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  const hh   = String(d.getHours()).padStart(2, "0");
  const mi   = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function SystemDivider({ createdAt }: Props) {
  const stamp = formatLocal(createdAt);
  return (
    <div className={styles.wrap} role="separator" aria-label={`완료 처리 · ${stamp}`}>
      <span className={styles.line} aria-hidden />
      <span className={styles.text}>{stamp} · 완료</span>
      <span className={styles.line} aria-hidden />
    </div>
  );
}