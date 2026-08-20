// components/noticeboard/rhythm/RhythmMinigameOverlay.tsx
// ═══════════════════════════════════════════════════════════════════
// 리듬게임 진입 오버레이 (세션 M 신설)
// ═══════════════════════════════════════════════════════════════════
//
// NoticeBoard 스테이지 위에 뜨는 풀 오버레이.
// DailyPanel 의 "연습 (리듬게임)" 카드 클릭 시 open.
//
// 화면 흐름 :
//   [리듬 홈] 곡 안내 · 남은 횟수 · "시작" → [게임 화면 (RhythmGame)]
//
// 카페 · 연습실 오버레이는 게임 3종이라 아이콘 그리드가 있으나,
// 리듬은 초안 단일 곡이므로 홈을 단순화 (곡 카드 1개 · 바로 진입).
// 곡이 늘어나면 곡 선택 그리드로 확장 (rhythmData.SONGS 순회).
//
// 데이터 :
//   · getTodayMinigameStatus 로 오늘 남은 횟수 조회 (open 시).
//     카페 + 연습실 + 리듬 통합 카운트 (하루 3회).
//   · minigameEnabled=false 는 진입 전 차단되지만 방어적 이중 반영.
//
// 스탯 선택은 게임 진입 후 RhythmGame 안에서 처리 (첫 phase="select").
//
// 톤 : tokens.css 변수 기반 (파랑 계열).
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./RhythmMinigameOverlay.module.css";
import RhythmGame from "./game/RhythmGame";
import { getDefaultSong } from "./game/rhythmData";
import { getTodayMinigameStatus } from "@/lib/minigame-helpers";

type Props = {
  open:        boolean;
  onClose:     () => void;
  onOpenLogin: () => void;
  isLoggedIn:  boolean;
};

type View = "home" | "play";

export default function RhythmMinigameOverlay({
  open,
  onClose,
  onOpenLogin,
  isLoggedIn,
}: Props) {
  const [view, setView] = useState<View>("home");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [mounted, setMounted] = useState(false);

  const song = getDefaultSong();

  // Portal 은 클라이언트에서만.
  useEffect(() => setMounted(true), []);

  // 오늘 남은 횟수 조회 (통합 카운트)
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
    setRemaining(status.minigameEnabled ? status.playsRemaining : 0);
  }, [isLoggedIn]);

  // open 시 홈 리셋 + 상태 조회
  useEffect(() => {
    if (open) {
      setView("home");
      refreshStatus();
    }
  }, [open, refreshStatus]);

  if (!open || !mounted) return null;

  const remainingUnknown = remaining === null;
  const exhausted = remaining !== null && remaining <= 0;

  const handleStartClick = () => {
    if (!isLoggedIn) {
      onOpenLogin();
      return;
    }
    if (exhausted) return;
    setView("play");
  };

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${styles.panel} ${view !== "home" ? styles.panelGame : ""}`}>
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
              <span className={styles.title}>🎵 연습 (리듬게임)</span>
              {isLoggedIn && !remainingUnknown ? (
                <span className={styles.remainBadge}>
                  오늘 남은 횟수 {remaining}회
                </span>
              ) : null}
            </div>
            <p className={styles.subtitle}>
              노트에 맞춰 박자를 치고, 원하는 스탯을 크게 성장시키세요. 모빌은
              지급되지 않는 대신 리듬감 또는 표현력이 대량으로 오릅니다.
            </p>

            <div className={styles.songCard}>
              <span className={styles.songEmoji}>🥁</span>
              <div className={styles.songInfo}>
                <span className={styles.songTitle}>{song.title}</span>
                <span className={styles.songMeta}>
                  {song.durationSec}초 · 노트 {song.notes.length}개 · ★★★
                </span>
              </div>
            </div>

            <button
              className={styles.startBtn}
              onClick={handleStartClick}
              disabled={isLoggedIn && exhausted}
            >
              시작하기
            </button>

            {loadingStatus ? (
              <div className={styles.notice}>
                남은 횟수를 확인하고 있습니다…
              </div>
            ) : exhausted ? (
              <div className={styles.notice}>
                오늘 이용 가능한 횟수를 모두 사용하셨습니다. 내일 다시 방문해
                주십시오.
              </div>
            ) : null}
          </>
        ) : (
          // ── 게임 화면 ────────────────────────────
          <RhythmGame
            onExit={() => {
              setView("home");
              refreshStatus();
            }}
            onPlayed={refreshStatus}
          />
        )}
      </div>
    </div>,
    document.body
  );
}