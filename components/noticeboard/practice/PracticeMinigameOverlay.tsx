// components/noticeboard/practice/PracticeMinigameOverlay.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습실알바 미니게임 오버레이 (세션 L 신설)
// ═══════════════════════════════════════════════════════════════════
//
// NoticeBoard 스테이지 위에 뜨는 풀 오버레이.
// DailyPanel 의 "연습실 알바" 카드 클릭 시 open (세션 M 에서 배선 예정).
//
// 화면 흐름:
//   [연습실 홈] 아이콘 3개 (청소 · 재고 정리 · 장비 세팅)
//     → 아이콘 클릭 → [게임 화면]
//
// 세션 L 범위:
//   · 청소 (practice_clean) : 실게임 마운트
//   · 재고 정리 · 장비 세팅 : "준비 중" placeholder (세션 M/L 후반에 실기능화)
//   · 남은 횟수 0 이면 아이콘 비활성 + 안내
//
// 데이터:
//   · getTodayMinigameStatus 로 오늘 남은 횟수 조회 (open 시).
//     카페 + 연습실 통합 카운트 (하루 3회) 임에 유의.
//   · minigameEnabled=false 는 진입 전에 이미 차단됨. 방어적으로 이중 반영.
//
// 카페 CafeMinigameOverlay 를 복제해서 신설. 카페 컴포넌트는 참조·수정하지 않는다.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./PracticeMinigameOverlay.module.css";
import PracticeCleanGame from "./clean/PracticeCleanGame";
import PracticeStockGame from "./stock/PracticeStockGame";
import PracticeSetupGame from "./setup/PracticeSetupGame";
import {
  getTodayMinigameStatus,
  type PracticeMinigameCode,
} from "@/lib/minigame-helpers";

// ── 연습실 미니게임 아이콘 정의 (seed subtype 과 매핑) ─────────────
type PracticeIcon = {
  code:       PracticeMinigameCode;
  emoji:      string;
  name:       string;
  desc:       string;
  border:     string;
  difficulty: 1 | 2 | 3;   // 별 개수 (UI 안내용 · 실제 리워드는 서버 metadata)
};

// 별 낮은 순으로 정렬 (초보 친절). seed metadata 의 difficulty 값과 일치해야 함.
const PRACTICE_ICONS: PracticeIcon[] = [
  {
    code:       "practice_clean",
    emoji:      "🧹",
    name:       "청소",
    desc:       "시간 안에 바닥의 먼지를 깨끗이 치웁니다.",
    border:     "#8fd0e6",
    difficulty: 1,
  },
  {
    code:       "practice_stock",
    emoji:      "📦",
    name:       "재고 정리",
    desc:       "재고 목록을 확인해 물품을 정확히 정리합니다.",
    border:     "#c9a6e6",
    difficulty: 2,
  },
  {
    code:       "practice_setup",
    emoji:      "🎛️",
    name:       "장비 세팅",
    desc:       "음향·조명 슬라이더를 목표값에 맞춰 조정합니다.",
    border:     "#f0c987",
    difficulty: 3,
  },
];

function difficultyStars(n: number): string {
  const clamp = Math.max(0, Math.min(3, n));
  return "★".repeat(clamp) + "☆".repeat(3 - clamp);
}

type Props = {
  open:      boolean;
  onClose:   () => void;
  onOpenLogin: () => void;
  isLoggedIn:  boolean;
};

type View = "home" | PracticeMinigameCode;

export default function PracticeMinigameOverlay({
  open,
  onClose,
  onOpenLogin,
  isLoggedIn,
}: Props) {
  const [view, setView] = useState<View>("home");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portal 은 클라이언트에서만. SSR 시 document 접근 방지.
  useEffect(() => setMounted(true), []);

  // 오늘 남은 횟수 조회 (카페 + 연습실 통합 카운트)
  const refreshStatus = useCallback(async () => {
    if (!isLoggedIn) {
      setRemaining(null);
      return;
    }
    setLoadingStatus(true);
    const status = await getTodayMinigameStatus();
    setLoadingStatus(false);
    if (!status) {
      setRemaining(null);
      return;
    }
    // 전역 비활성이면 남은 횟수 0 취급 (이중 방어)
    setRemaining(status.minigameEnabled ? status.playsRemaining : 0);
  }, [isLoggedIn]);

  // open 시마다 홈으로 리셋 + 상태 재조회
  useEffect(() => {
    if (open) {
      setView("home");
      refreshStatus();
    }
  }, [open, refreshStatus]);

  if (!open || !mounted) return null;

  const remainingUnknown = remaining === null;
  const exhausted = remaining !== null && remaining <= 0;

  // ── 아이콘 클릭 ─────────────────────────────────
  const handleIconClick = (code: PracticeMinigameCode) => {
    if (!isLoggedIn) {
      onOpenLogin();
      return;
    }
    if (exhausted) return;
    setView(code);
  };

  const activeIcon = PRACTICE_ICONS.find((i) => i.code === view);

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={(e) => {
        // backdrop 직접 클릭 시에만 닫기
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="닫기"
        >
          ✕
        </button>

        {view === "home" ? (
          <>
            <div className={styles.header}>
              <span className={styles.title}>🎤 연습실 알바</span>
              {isLoggedIn && !remainingUnknown ? (
                <span className={styles.remainBadge}>
                  오늘 남은 횟수 {remaining}회
                </span>
              ) : null}
            </div>
            <p className={styles.subtitle}>
              원하는 업무를 선택해 알바를 시작해 주십시오. 게임을 완료하면 점수에
              따라 보상이 지급되며 일일 횟수가 1회 차감됩니다.
            </p>

            <div className={styles.iconGrid}>
              {PRACTICE_ICONS.map((icon) => (
                <button
                  key={icon.code}
                  className={styles.iconCard}
                  style={{ ["--card-border" as string]: icon.border }}
                  onClick={() => handleIconClick(icon.code)}
                  disabled={isLoggedIn && exhausted}
                >
                  <span className={styles.iconEmoji}>{icon.emoji}</span>
                  <span className={styles.iconName}>{icon.name}</span>
                  <span className={styles.iconDifficulty}>
                    {difficultyStars(icon.difficulty)}
                  </span>
                  <span className={styles.iconDesc}>{icon.desc}</span>
                </button>
              ))}
            </div>

            {loadingStatus ? (
              <div className={styles.exhausted}>
                남은 횟수를 확인하고 있습니다…
              </div>
            ) : exhausted ? (
              <div className={styles.exhausted}>
                오늘 이용 가능한 횟수를 모두 사용하셨습니다. 내일 다시 방문해
                주십시오.
              </div>
            ) : null}
          </>
        ) : view === "practice_clean" ? (
          // ── 청소 (실게임) ────────────────────────────
          <>
            <div className={styles.header}>
              <span className={styles.title}>
                {activeIcon?.emoji} {activeIcon?.name}
              </span>
            </div>
            <PracticeCleanGame
              onExit={() => {
                setView("home");
                refreshStatus();
              }}
              onPlayed={refreshStatus}
            />
          </>
        ) : view === "practice_stock" ? (
          // ── 재고 정리 (실게임) ───────────────────────
          <>
            <div className={styles.header}>
              <span className={styles.title}>
                {activeIcon?.emoji} {activeIcon?.name}
              </span>
            </div>
            <PracticeStockGame
              onExit={() => {
                setView("home");
                refreshStatus();
              }}
              onPlayed={refreshStatus}
            />
          </>
        ) : view === "practice_setup" ? (
          // ── 장비 세팅 (실게임) ───────────────────────
          <>
            <div className={styles.header}>
              <span className={styles.title}>
                {activeIcon?.emoji} {activeIcon?.name}
              </span>
            </div>
            <PracticeSetupGame
              onExit={() => {
                setView("home");
                refreshStatus();
              }}
              onPlayed={refreshStatus}
            />
          </>
        ) : (
          // ── 안전망 : 예상치 못한 view 값 처리 ─────────
          <>
            <div className={styles.header}>
              <span className={styles.title}>
                {activeIcon?.emoji} {activeIcon?.name}
              </span>
            </div>
            <div className={styles.gameStage}>
              <span className={styles.placeholderText}>알 수 없는 게임입니다</span>
              <button
                className={styles.backBtn}
                onClick={() => setView("home")}
              >
                ← 연습실로 돌아가기
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}