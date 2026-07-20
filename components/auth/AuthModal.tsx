// components/auth/AuthModal.tsx
//
// 로그인·가입 통합 모달 껍데기.
//
// 역할:
//   - backdrop + 중앙 정렬 카드 + X 버튼 + 애니메이션 라이프사이클 관리
//   - 내부에 tab state 유지 → LoginPanel/RegisterPanel 전환
//   - 각 Panel의 onSwitchTo{Register|Login} 콜백을 여기서 소화
//     (NoticeBoard는 overlay=login/register 두 값 대신 그냥 open만 관리)
//
// NoticeBoard에서:
//   <AuthModal
//     open={overlay === "login" || overlay === "register"}
//     initialTab={overlay === "login" ? "login" : "register"}
//     onClose={() => setOverlay(null)}
//   />
//
// 애니메이션 라이프사이클은 AdminChatOverlay와 동일 패턴:
//   visible/closing state로 exit 재생 후 unmount.

"use client";

import { useEffect, useRef, useState } from "react";
import LoginPanel    from "./LoginPanel";
import RegisterPanel from "./RegisterPanel";
import styles from "./AuthModal.module.css";

type Tab = "login" | "register";

// module.css의 애니메이션 duration과 일치해야 함
const ANIM_MS = 380;

type Props = {
  open:       boolean;
  initialTab: Tab;
  onClose:    () => void;
};

export default function AuthModal({ open, initialTab, onClose }: Props) {
  const [tab,     setTab]     = useState<Tab>(initialTab);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseDownOnBackdropRef = useRef(false);

  // open 상태에서 initialTab 바뀌면 반영
  // (외부에서 명시적으로 login/register 지정하며 열 때)
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);

  // open prop 변화 → 애니메이션 라이프사이클
  useEffect(() => {
    if (open) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      setClosing(true);
      exitTimerRef.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
        exitTimerRef.current = null;
      }, ANIM_MS);
    }

    return () => {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [open, visible]);

  if (!visible) return null;

    return (
      <div
        className={`${styles.backdrop} ${closing ? styles.closing : ""}`}
        onMouseDown={(e) => {
          mouseDownOnBackdropRef.current = e.target === e.currentTarget;
        }}
        onMouseUp={(e) => {
          if (mouseDownOnBackdropRef.current && e.target === e.currentTarget) {
            onClose();
          }
          mouseDownOnBackdropRef.current = false;
        }}
      >
        <div
          className={`${styles.card} ${closing ? styles.closing : ""}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
        <button
          onClick={onClose}
          className={styles.closeButton}
          aria-label="닫기"
        >
          ✕
        </button>

        {tab === "login" ? (
          <LoginPanel
            onSuccess={onClose}
            onSwitchToRegister={() => setTab("register")}
          />
        ) : (
          <RegisterPanel
            onSuccess={onClose}
            onSwitchToLogin={() => setTab("login")}
          />
        )}
      </div>
    </div>
  );
}