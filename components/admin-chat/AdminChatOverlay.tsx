// components/admin-chat/AdminChatOverlay.tsx
//
// 관리자 호출 채팅 오버레이 (v3 — 실기능화).
//
// 변경점 (v2 → v3):
//   - 하드코딩 응답(ADMIN_REPLIES) 전면 제거
//   - 역할 분기 도입:
//       · GM      → GmChatView   (방 목록 + 선택된 방, 완료 처리 가능)
//       · 일반유저 → UserChatView (자기 방 1개 고정)
//   - GM 모드일 때 오버레이 폭 확장 (334px → 560px)
//   - 헤더의 "운영진 온라인" 상태 표시 제거 (요구사항)
//   - 미로그인 상태 방어 화면 추가 (세션 도중 만료 대비)
//
// 유지된 것:
//   - open/closing 애니메이션 라이프사이클 (v2 패턴 그대로)
//   - ANIM_MS(400)는 module.css의 duration과 반드시 일치
//
// 진입 통제 방침:
//   미로그인 유저는 NoticeBoard의 관리자호출 버튼 클릭 시 AuthModal(login)이 열리고
//   이 오버레이는 열리지 않음. 여기 미로그인 화면은 어디까지나 방어용.

"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import { getCurrentProfile } from "@/lib/auth-helpers";
import UserChatView from "./UserChatView";
import GmChatView from "./GmChatView";
import styles from "./AdminChatOverlay.module.css";

// enter/exit 애니메이션 duration (module.css와 반드시 일치)
const ANIM_MS = 400;

type Props = {
  open:    boolean;
  onClose: () => void;
};

export default function AdminChatOverlay({ open, onClose }: Props) {
  const { user, isGm, loading: authLoading } = useCurrentUser();

  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  // 애니메이션 라이프사이클:
  //   visible=false                → DOM에 없음
  //   visible=true, closing=false  → 표시 중
  //   visible=true, closing=true   → exit 애니메이션 재생 중
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 내 profile id 조회 (말풍선 좌우 판별용).
  // 세션이 바뀌면 재조회.
  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setMyProfileId(null);
      return;
    }

    (async () => {
      const profile = await getCurrentProfile();
      if (cancelled) return;
      setMyProfileId(profile?.id ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!visible) return null;

  // GM 모드는 2단 레이아웃이라 폭 확장 필요
  const wideMode = Boolean(user) && isGm;

  const overlayClass = [
    styles.overlay,
    wideMode ? styles.overlayWide : "",
    closing ? styles.closing : "",
  ]
    .filter(Boolean)
    .join(" ");

  const subtitle = !user
    ? "로그인이 필요합니다"
    : isGm
    ? "문의 채팅 관리"
    : "운영진에게 문의";

  return (
    <div className={overlayClass}>
      {/* 헤더 */}
      <div className={styles.header}>
        <span className={styles.avatar}>🧑‍💻</span>
        <span className={styles.titleWrap}>
          <span className={styles.title}>관리자 호출</span>
          <span className={styles.subtitle}>{subtitle}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className={styles.closeButton}
          aria-label="닫기"
        >
          ✕
        </button>
      </div>

      {/* 본문 — 역할별 분기 */}
      {authLoading ? (
        <div className={styles.stateNotice}>불러오는 중입니다…</div>
      ) : !user ? (
        <div className={styles.stateNotice}>
          로그인 후 이용하실 수 있습니다.
        </div>
      ) : isGm ? (
        <GmChatView myProfileId={myProfileId} />
      ) : (
        <UserChatView myProfileId={myProfileId} />
      )}
    </div>
  );
}