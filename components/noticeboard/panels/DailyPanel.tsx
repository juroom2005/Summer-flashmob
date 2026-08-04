// components/noticeboard/panels/DailyPanel.tsx
// ═══════════════════════════════════════════════════════════════════
// 일일 행동 패널 (J1)
// ═══════════════════════════════════════════════════════════════════
//
// NavRail "✅ 일일" 탭의 본문.
//
// 기존(시안)의 하드코딩 미션 체크리스트를 대체하여, 실제 일일 행동
// (미니게임) 진입점을 제공한다.
//
// J1 범위:
//   · 카페알바 진입 카드 1개 (클릭 → CafeMinigameOverlay open)
//   · 오늘 남은 횟수 표시
//   · site_settings.minigame_enabled=false 이면 "점검 중" 안내로 대체
//     (진입 카드 자체를 숨김)
//   · 연습실알바 · 리듬게임은 "준비 중" 자리표시만
//
// 데이터:
//   · getTodayMinigameStatus 로 활성 여부 + 남은 횟수 조회
//   · profile-changed 이벤트 리슨 → 게임 완주 후 남은 횟수 자동 갱신
//
// 로그인:
//   · 비로그인 상태에서 카드 클릭 → onOpenLogin 호출 (AuthModal open)
//
// 후속:
//   · 연습실알바 · 리듬게임 카드 실기능화
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./DailyPanel.module.css";
import CafeMinigameOverlay from "../cafe/CafeMinigameOverlay";
import PracticeMinigameOverlay from "../practice/PracticeMinigameOverlay";
import { getTodayMinigameStatus } from "@/lib/minigame-helpers";

type Props = {
  isLoggedIn:  boolean;
  onOpenLogin: () => void;
};

export default function DailyPanel({ isLoggedIn, onOpenLogin }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState(3);
  const [cafeOpen, setCafeOpen] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!isLoggedIn) {
      // 비로그인: 활성 여부는 게임 진입 시 판정. 카드는 노출하되 남은 횟수 미표시.
      setEnabled(true);
      setRemaining(null);
      return;
    }
    const status = await getTodayMinigameStatus();
    if (!status) {
      // 조회 실패: 카드는 노출하되 안전하게 활성으로 두고 남은 횟수 미표시.
      setEnabled(true);
      setRemaining(null);
      return;
    }
    setEnabled(status.minigameEnabled);
    setRemaining(status.playsRemaining);
    setDailyLimit(status.dailyLimit);
  }, [isLoggedIn]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // 게임 완주 후 남은 횟수 갱신
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => refreshStatus();
    window.addEventListener("profile-changed", handler);
    return () => window.removeEventListener("profile-changed", handler);
  }, [refreshStatus]);

  const handleCafeClick = () => {
    if (!isLoggedIn) {
      onOpenLogin();
      return;
    }
    setCafeOpen(true);
  };

  const handlePracticeClick = () => {
    if (!isLoggedIn) {
      onOpenLogin();
      return;
    }
    setPracticeOpen(true);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <span className={styles.title}>✅ 일일 행동</span>
        <span className={styles.subtitle}>
          하루 {dailyLimit}회. 자정(KST)에 초기화됩니다.
        </span>
      </div>

      {enabled === false ? (
        <div className={styles.maintenance}>
          <span className={styles.maintenanceTitle}>점검 중입니다</span>
          <span className={styles.maintenanceBody}>
            일일 행동(미니게임)이 현재 점검 중입니다. 잠시 후 다시 방문해
            주십시오.
          </span>
        </div>
      ) : (
        <div className={styles.grid}>
          {/* 카페알바 (실기능) */}
          <button
            className={styles.actionCard}
            style={{ ["--card-border" as string]: "#f0c987" }}
            onClick={handleCafeClick}
          >
            <span className={styles.actionEmoji}>☕</span>
            <span className={styles.actionName}>카페 알바</span>
            <span className={styles.actionDesc}>
              주문 받기 · 음료 제조 · 설거지 중 하나를 골라 플레이합니다.
            </span>
            {isLoggedIn && remaining !== null ? (
              <span className={styles.remainLine}>
                오늘 남은 횟수 {remaining}회
              </span>
            ) : null}
          </button>

          {/* 연습실알바 (실기능, 세션 L) */}
          <button
            className={styles.actionCard}
            style={{ ["--card-border" as string]: "#c9a6e6" }}
            onClick={handlePracticeClick}
          >
            <span className={styles.actionEmoji}>🎧</span>
            <span className={styles.actionName}>연습실 알바</span>
            <span className={styles.actionDesc}>
              청소 · 재고 정리 · 장비 세팅 중 하나를 골라 플레이합니다.
            </span>
            {isLoggedIn && remaining !== null ? (
              <span className={styles.remainLine}>
                오늘 남은 횟수 {remaining}회
              </span>
            ) : null}
          </button>

          {/* 리듬게임 (준비 중) */}
          <div className={`${styles.actionCard} ${styles.actionCardSoon}`}>
            <span className={styles.actionEmoji}>🎵</span>
            <span className={styles.actionName}>연습 (리듬게임)</span>
            <span className={styles.actionDesc}>
              짧은 리듬게임으로 선택한 스탯을 크게 올립니다.
            </span>
            <span className={styles.soonTag}>준비 중</span>
          </div>
        </div>
      )}

      <CafeMinigameOverlay
        open={cafeOpen}
        onClose={() => {
          setCafeOpen(false);
          refreshStatus();
        }}
        onOpenLogin={onOpenLogin}
        isLoggedIn={isLoggedIn}
      />

      <PracticeMinigameOverlay
        open={practiceOpen}
        onClose={() => {
          setPracticeOpen(false);
          refreshStatus();
        }}
        onOpenLogin={onOpenLogin}
        isLoggedIn={isLoggedIn}
      />
    </div>
  );
}