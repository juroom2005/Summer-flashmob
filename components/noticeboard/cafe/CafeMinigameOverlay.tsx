// components/noticeboard/cafe/CafeMinigameOverlay.tsx
// ═══════════════════════════════════════════════════════════════════
// 카페알바 미니게임 오버레이 (J1 뼈대)
// ═══════════════════════════════════════════════════════════════════
//
// NoticeBoard 스테이지 위에 뜨는 풀 오버레이.
// DailyPanel 의 "카페알바" 카드 클릭 시 open.
//
// 화면 흐름:
//   [카페 홈] 아이콘 3개 (카운터 · 음료 제조대 · 싱크대)
//     → 아이콘 클릭 → [게임 화면]
//
// J1 범위:
//   · 홈 화면 · 아이콘 3개 · 게임 선택 라우팅까지만.
//   · 각 게임 화면은 "준비 중" placeholder. 실 게임은 J2~J4 에서 교체.
//   · 남은 횟수 0 이면 아이콘 비활성 + 안내.
//
// 데이터:
//   · getTodayMinigameStatus 로 오늘 남은 횟수 조회 (open 시).
//   · minigameEnabled=false 는 이 오버레이 진입 전 (DailyPanel) 에서 이미 차단됨.
//     다만 방어적으로 remaining 판정에 함께 반영.
//
// 후속 (J2~J4):
//   · subtype 별 실 게임 컴포넌트 마운트
//   · 게임 완주 → playCafeMinigame → 리워드 팝업 → onPlayed 콜백으로 남은 횟수 갱신
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./CafeMinigameOverlay.module.css";
import CafeOrderGame from "./order/CafeOrderGame";
import CafeMixGame from "./mix/CafeMixGame";
import CafeDishGame from "./dish/CafeDishGame";
import {
  getTodayMinigameStatus,
  type CafeMinigameCode,
} from "@/lib/minigame-helpers";

// ── 카페 미니게임 아이콘 정의 (seed subtype 과 매핑) ─────────────
type CafeIcon = {
  code:       CafeMinigameCode;
  emoji:      string;
  name:       string;
  desc:       string;
  border:     string;
  difficulty: 1 | 2 | 3;   // 별 개수 (UI 안내용 · 실제 리워드는 서버 metadata)
};

// 별 낮은 순으로 정렬 (초보 친절). seed metadata 의 difficulty 값과 일치해야 함.
const CAFE_ICONS: CafeIcon[] = [
  {
    code:       "cafe_dish",
    emoji:      "🧽",
    name:       "싱크대",
    desc:       "시간 안에 접시를 깨끗하게 닦습니다.",
    border:     "#8fd0e6",
    difficulty: 1,
  },
  {
    code:       "cafe_mix",
    emoji:      "🥤",
    name:       "음료 제조대",
    desc:       "레시피대로 재료를 쌓아 만듭니다.",
    border:     "#c9a6e6",
    difficulty: 2,
  },
  {
    code:       "cafe_order",
    emoji:      "🧾",
    name:       "카운터",
    desc:       "손님 주문을 순서대로 받습니다.",
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

type View = "home" | CafeMinigameCode;

export default function CafeMinigameOverlay({
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

  // 오늘 남은 횟수 조회
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
  const handleIconClick = (code: CafeMinigameCode) => {
    if (!isLoggedIn) {
      onOpenLogin();
      return;
    }
    if (exhausted) return;
    setView(code);
  };

  const activeIcon = CAFE_ICONS.find((i) => i.code === view);

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
              <span className={styles.title}>☕ 카페 알바</span>
              {isLoggedIn && !remainingUnknown ? (
                <span className={styles.remainBadge}>
                  오늘 남은 횟수 {remaining}회
                </span>
              ) : null}
            </div>
            <p className={styles.subtitle}>
              원하는 자리를 선택해 알바를 시작해 주세요. 게임을 완료하면 점수에
              따라 보상이 지급되며 일일 횟수가 1회 차감됩니다.
            </p>

            <div className={styles.iconGrid}>
              {CAFE_ICONS.map((icon) => (
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
        ) : view === "cafe_order" ? (
          // ── 주문 받기 (실게임) ──────────────────────
          <>
            <div className={styles.header}>
              <span className={styles.title}>
                {activeIcon?.emoji} {activeIcon?.name}
              </span>
            </div>
            <CafeOrderGame
              onExit={() => {
                setView("home");
                refreshStatus();
              }}
              onPlayed={refreshStatus}
            />
          </>
        ) : view === "cafe_mix" ? (
          // ── 음료 제조 (실게임) ──────────────────────
          <>
            <div className={styles.header}>
              <span className={styles.title}>
                {activeIcon?.emoji} {activeIcon?.name}
              </span>
            </div>
            <CafeMixGame
              onExit={() => {
                setView("home");
                refreshStatus();
              }}
              onPlayed={refreshStatus}
            />
          </>
        ) : view === "cafe_dish" ? (
          // ── 설거지 (실게임) ─────────────────────────
          <>
            <div className={styles.header}>
              <span className={styles.title}>
                {activeIcon?.emoji} {activeIcon?.name}
              </span>
            </div>
            <CafeDishGame
              onExit={() => {
                setView("home");
                refreshStatus();
              }}
              onPlayed={refreshStatus}
            />
          </>
        ) : (
          // ── 게임 화면 (미구현 게임 placeholder) ─────
          <>
            <div className={styles.header}>
              <span className={styles.title}>
                {activeIcon?.emoji} {activeIcon?.name}
              </span>
            </div>
            <div className={styles.gameStage}>
              <span className={styles.placeholderText}>준비 중입니다</span>
              <span className={styles.placeholderSub}>
                이 미니게임은 다음 업데이트에서 실제로 플레이할 수 있습니다.
              </span>
              <button
                className={styles.backBtn}
                onClick={() => setView("home")}
              >
                ← 카페로 돌아가기
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}