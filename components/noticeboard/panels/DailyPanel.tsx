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

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import styles from "./DailyPanel.module.css";
import CafeMinigameOverlay from "../cafe/CafeMinigameOverlay";
import PracticeMinigameOverlay from "../practice/PracticeMinigameOverlay";
import RhythmMinigameOverlay from "../rhythm/RhythmMinigameOverlay";
import { getTodayMinigameStatus } from "@/lib/minigame-helpers";

type Props = {
  isLoggedIn:  boolean;
  onOpenLogin: () => void;
};

/* 카드 정의. accent/accentSoft 는 CSS 변수로 주입해 카드별 색 결정.
 * items: 앞면에 나열할 세부(카페·연습실 3종). 리듬은 items 없이 desc 만. */
type CardDef = {
  key:        "cafe" | "practice" | "rhythm";
  emoji:      string;
  name:       string;
  accent:     string;
  accentSoft: string;
  img?:       string;   // 배경 이미지 URL(추후 주입). 없으면 accent 그라데 폴백.
  items?:     string[];
  desc?:      string;
};

const CARDS: CardDef[] = [
  {
    key:        "cafe",
    emoji:      "☕",
    name:       "카페 알바",
    accent:     "#f0c987",
    accentSoft: "#fbe6c9",
    img:        "",   // 예: "/img/daily-cafe.webp"
    items:      ["카운터 (주문 받기)", "음료 제조대", "싱크대 (설거지)"],
  },
  {
    key:        "practice",
    emoji:      "🎧",
    name:       "연습실 알바",
    accent:     "#c9a6e6",
    accentSoft: "#ede0fa",
    img:        "",   // 예: "/img/daily-practice.webp"
    items:      ["청소", "재고 정리", "장비 세팅"],
  },
  {
    key:        "rhythm",
    emoji:      "🎵",
    name:       "연습 (리듬게임)",
    accent:     "#8fd0e6",
    accentSoft: "#d6f0fa",
    img:        "",   // 예: "/img/daily-rhythm.webp"
    desc:       "노트에 맞춰 박자를 치고, 선택한 스탯을 크게 올립니다.",
  },
];

export default function DailyPanel({ isLoggedIn, onOpenLogin }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState(3);
  const [cafeOpen, setCafeOpen] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [rhythmOpen, setRhythmOpen] = useState(false);

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

  const handleRhythmClick = () => {
    if (!isLoggedIn) {
      onOpenLogin();
      return;
    }
    setRhythmOpen(true);
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
          {CARDS.map((card) => (
            <FlipCard
              key={card.key}
              card={card}
              isLoggedIn={isLoggedIn}
              remaining={remaining}
              onStart={
                card.key === "cafe"
                  ? handleCafeClick
                  : card.key === "practice"
                  ? handlePracticeClick
                  : handleRhythmClick
              }
            />
          ))}
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

      <RhythmMinigameOverlay
        open={rhythmOpen}
        onClose={() => {
          setRhythmOpen(false);
          refreshStatus();
        }}
        onOpenLogin={onOpenLogin}
        isLoggedIn={isLoggedIn}
      />
    </div>
  );
}

/* ── flip 카드 ──────────────────────────────────────────────
 * hover·focus 로 뒤집힘(CSS). 뒷면 "시작하기" → onStart(기존 핸들러).
 * 세부 선택은 기존 미니게임 오버레이 홈에서 이뤄지므로 여기선 진입만. */
function FlipCard({
  card,
  isLoggedIn,
  remaining,
  onStart,
}: {
  card:       CardDef;
  isLoggedIn: boolean;
  remaining:  number | null;
  onStart:    () => void;
}) {
  return (
    <div
      className={styles.flipContainer}
      style={
        {
          ["--accent" as string]: card.accent,
          ["--accent-soft" as string]: card.accentSoft,
          ["--card-img" as string]: card.img ? `url("${card.img}")` : "none",
        } as CSSProperties
      }
      tabIndex={0}
      role="button"
      aria-label={`${card.name} 시작`}
    >
      <div className={styles.flipInner}>
        {/* 앞면: 이미지 배경 + 하단 유리패널 */}
        <div className={`${styles.face} ${styles.front}`}>
          <div className={styles.frontGlass}>
            <span className={styles.frontEmoji}>{card.emoji}</span>
            <span className={styles.frontName}>{card.name}</span>
            {card.items ? (
              <ul className={styles.frontList}>
                {card.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            ) : (
              <span className={styles.frontDesc}>{card.desc}</span>
            )}
            <span className={styles.flipHint}>▸ 올려서 뒤집기</span>
          </div>
        </div>

        {/* 뒷면: 이미지 배경 + 중앙 유리패널 */}
        <div className={`${styles.face} ${styles.back}`}>
          <div className={styles.backGlass}>
            <span className={styles.backEmoji}>{card.emoji}</span>
            <span className={styles.backName}>{card.name}</span>
            <button type="button" className={styles.startBtn} onClick={onStart}>
              시작하기
            </button>
            {isLoggedIn && remaining !== null ? (
              <span className={styles.backRemain}>남은 {remaining}회</span>
            ) : null}
            {card.items ? (
              <span className={styles.backHint}>
                시작하면 세부 활동을 골라요.
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}