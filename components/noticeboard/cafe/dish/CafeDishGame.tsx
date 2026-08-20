// components/noticeboard/cafe/dish/CafeDishGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 설거지 (cafe_dish) 미니게임 본체
// ═══════════════════════════════════════════════════════════════════
//
// 규칙 (v11 §8-2 + 세션 K 결정) :
//   · 접시 1개 · 스팟 5~7개 랜덤 배치
//   · 15초 안에 드래그로 문질러 스팟 지우기
//   · 스팟 위 재진입 시 청결도 +70 (2번 지나가야 완전 소멸)
//   · 모든 스팟 청결 → 조기 종료 · 자동 채점
//   · 시간 초과 → 자동 채점 (지금까지 상태로)
//   · 채점 : 비율 감산 (cleaned / total × 100) + 시간 보너스 (0~10) · 100 캡
//   · 별 1 · 난이도 가산 없음
//
// 조작 (Pointer Events, 마우스·터치 통합) :
//   · pointerdown  → 드래그 시작
//   · pointermove  → 접시 % 좌표로 변환 → 각 스팟에 대해 재진입 감지
//   · pointerup / pointerleave / pointercancel → 드래그 종료 · inside ref 리셋
//
// 안정성 :
//   · submitLock 으로 중복 제출 방어
//   · 언마운트 시 타이머 정리
//   · touchAction: none 으로 모바일 스크롤 방해 방지

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./CafeDishGame.module.css";
import RewardPopup from "../RewardPopup";
import { playCafeMinigame, type PlayResult } from "@/lib/minigame-helpers";
import {
  generateSpots,
  isInsideSpot,
  isAllClean,
  calculateFinalScore,
  SCRUB_DAMAGE,
  TIME_LIMIT_SEC,
  type DishSpot,
} from "./dishData";

type Phase = "intro" | "playing" | "submitting" | "done";

type Props = {
  onExit:   () => void;
  onPlayed: () => void;
};

export default function CafeDishGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase]                     = useState<Phase>("intro");
  const [spots, setSpots]                     = useState<DishSpot[]>([]);
  const [remainingSec, setRemainingSec]       = useState(TIME_LIMIT_SEC);
  const [finalScore, setFinalScore]           = useState(0);
  const [accuracyScore, setAccuracyScore]     = useState(0);
  const [timeBonus, setTimeBonus]             = useState(0);
  const [result, setResult]                   = useState<PlayResult | null>(null);

  // 드래그 · 커서 상태
  const [dragging, setDragging]     = useState(false);
  const [cursorPos, setCursorPos]   = useState<{ x: number; y: number } | null>(null);

  const submitLock       = useRef(false);
  const gameTimer        = useRef<ReturnType<typeof setInterval> | null>(null);
  const dishRef          = useRef<HTMLDivElement | null>(null);
  // 각 스팟의 이전 프레임 inside 상태 (재진입 감지용)
  const spotInsideRef    = useRef<Record<string, boolean>>({});

  /* ═══════════════════════════════════════════════
   * 타이머 헬퍼
   * ─────────────────────────────────────────────── */

  const clearGameTimer = useCallback(() => {
    if (gameTimer.current) {
      clearInterval(gameTimer.current);
      gameTimer.current = null;
    }
  }, []);

  /* ═══════════════════════════════════════════════
   * 시작 · 리셋
   * ─────────────────────────────────────────────── */

  const startGame = useCallback(() => {
    const fresh = generateSpots();
    setSpots(fresh);
    setRemainingSec(TIME_LIMIT_SEC);
    setFinalScore(0);
    setAccuracyScore(0);
    setTimeBonus(0);
    setResult(null);
    setDragging(false);
    setCursorPos(null);
    spotInsideRef.current = {};
    submitLock.current = false;
    setPhase("playing");

    // 게임 타이머 시작
    clearGameTimer();
    gameTimer.current = setInterval(() => {
      setRemainingSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  }, [clearGameTimer]);

  /* ═══════════════════════════════════════════════
   * 완성 → 채점 → 제출
   *
   * 두 진입점 통합 :
   *   · 조기 종료 (isAllClean === true)
   *   · 시간 초과 (remainingSec === 0)
   *
   * submitLock 으로 중복 방어.
   * ─────────────────────────────────────────────── */

  const finalizeAndSubmit = useCallback(async () => {
    if (submitLock.current) return;
    submitLock.current = true;

    // 타이머 즉시 정리
    clearGameTimer();

    // 드래그 상태도 종료
    setDragging(false);
    setCursorPos(null);

    const score = calculateFinalScore(spots, remainingSec);

    setAccuracyScore(score.accuracyScore);
    setTimeBonus(score.timeBonus);
    setFinalScore(score.finalScore);
    setPhase("submitting");
    setResult(null);

    const detail = {
      total_spots:     score.totalSpots,
      cleaned_spots:   score.cleanedSpots,
      remaining_spots: score.remainingSpots,
      accuracy_score:  score.accuracyScore,
      time_bonus:      score.timeBonus,
      remaining_sec:   remainingSec,
      time_out:        remainingSec === 0,
      cleared_early:   score.remainingSpots === 0 && remainingSec > 0,
    };

    const res = await playCafeMinigame("cafe_dish", score.finalScore, detail);
    setResult(res);
    setPhase("done");
    onPlayed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, remainingSec, onPlayed, clearGameTimer]);

  /* 시간 초과 자동 채점 */
  useEffect(() => {
    if (phase === "playing" && remainingSec === 0) {
      finalizeAndSubmit();
    }
  }, [phase, remainingSec, finalizeAndSubmit]);

  /* 조기 종료 : 모든 스팟 청결 시 즉시 채점 */
  useEffect(() => {
    if (phase === "playing" && spots.length > 0 && isAllClean(spots)) {
      finalizeAndSubmit();
    }
  }, [phase, spots, finalizeAndSubmit]);

  /* 언마운트 시 타이머 정리 */
  useEffect(() => {
    return () => {
      clearGameTimer();
    };
  }, [clearGameTimer]);

  /* ═══════════════════════════════════════════════
   * 재도전
   * ─────────────────────────────────────────────── */

  const canRetry = result?.ok === true ? result.playsRemaining > 0 : false;
  const handleRetry = () => {
    if (canRetry) startGame();
  };

  /* ═══════════════════════════════════════════════
   * 드래그 처리 (Pointer Events)
   *
   * 마우스 · 터치 통합. touch-action: none 으로 모바일 스크롤 방지.
   * 접시 밖으로 나가면 (pointerleave) 드래그 종료 · inside 리셋.
   * ─────────────────────────────────────────────── */

  /**
   * 접시 요소의 rect 를 기반으로 커서를 접시 대비 % 좌표 (0~100) 로 환산.
   */
  const toDishPercent = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    const el = dishRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((clientX - rect.left) / rect.width)  * 100;
    const y = ((clientY - rect.top)  / rect.height) * 100;
    return { x, y };
  };


  const scrubAtPosition = useCallback((x: number, y: number) => {

    const hits: string[] = [];
    spots.forEach((s) => {
      const wasInside = spotInsideRef.current[s.id] ?? false;
      const nowInside = isInsideSpot(s, x, y);
      spotInsideRef.current[s.id] = nowInside;
      if (s.cleanliness >= 100) return;
      if (!wasInside && nowInside) hits.push(s.id);
    });

    if (hits.length === 0) return;


    setSpots((prev) =>
      prev.map((s) =>
        hits.includes(s.id)
          ? { ...s, cleanliness: Math.min(100, s.cleanliness + SCRUB_DAMAGE) }
          : s
      )
    );
  }, [spots]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    setDragging(true);
    const pos = toDishPercent(e.clientX, e.clientY);
    if (pos) {
      setCursorPos(pos);
      scrubAtPosition(pos.x, pos.y);
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    if (!dragging) {
      // 드래그 중이 아니어도 커서 위치는 갱신 (스펀지 아이콘 위치 표시용)
      const pos = toDishPercent(e.clientX, e.clientY);
      if (pos) setCursorPos(pos);
      return;
    }
    const pos = toDishPercent(e.clientX, e.clientY);
    if (pos) {
      setCursorPos(pos);
      scrubAtPosition(pos.x, pos.y);
    }
  };

  const endDrag = () => {
    setDragging(false);
    // 모든 스팟 inside 상태 초기화 → 다시 진입 시 재진입으로 인식
    spotInsideRef.current = {};
  };

  const handlePointerUp     = () => endDrag();
  const handlePointerCancel = () => endDrag();
  const handlePointerLeave  = () => {
    // 접시 밖으로 나가면 드래그 종료 + 커서 표시 감춤
    endDrag();
    setCursorPos(null);
  };

  /* ═══════════════════════════════════════════════
   * 렌더 : intro
   * ─────────────────────────────────────────────── */

  if (phase === "intro") {
    return (
      <div className={styles.wrap}>
        <div className={styles.intro}>
          <div className={styles.introTitle}>🧽 설거지</div>
          <p className={styles.introBody}>
            접시에 묻은 얼룩을 시간 안에 문질러 지워주세요. 스펀지로 얼룩
            위를 두 번 지나가면 완전히 사라집니다. 15초 안에 모든 얼룩을
            지우면 조기 종료됩니다.
          </p>
          <div className={styles.introActions}>
            <button className={styles.primaryBtn} onClick={startGame}>
              시작하기
            </button>
            <button className={styles.ghostBtn} onClick={onExit}>
              ← 카페로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
   * 렌더 : playing / submitting / done
   * ─────────────────────────────────────────────── */

  const totalSpots     = spots.length;
  const cleanedSpots   = spots.filter((s) => s.cleanliness >= 100).length;
  const progressPct    = totalSpots === 0 ? 0 : (cleanedSpots / totalSpots) * 100;
  const lowTime        = remainingSec <= 5;
  const midTime        = remainingSec <= 10 && !lowTime;
  const timerClass     =
    lowTime ? `${styles.timer} ${styles.timerLow}` :
    midTime ? `${styles.timer} ${styles.timerMid}` :
              styles.timer;

  return (
    <div className={styles.wrap}>
      <div className={styles.gameArea}>
        {/* HUD : 타이머 + 진행률 */}
        <div className={styles.hud}>
          <div className={timerClass}>⏱ {remainingSec}s</div>
          <div className={styles.progress}>
            <div className={styles.progressLabel}>
              깨끗한 얼룩 {cleanedSpots} / {totalSpots}
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* 접시 : 드래그 영역. touch-action: none 은 style 로 (모바일 스크롤 방지) */}
        <div className={styles.dishArea}>
          <div
            ref={dishRef}
            className={styles.dish}
            style={{ touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerLeave}
          >
            {/* 얼룩 스팟들 */}
            {spots.map((spot) => (
              <div
                key={spot.id}
                className={`${styles.spot} ${styles[`spotV${spot.variant}`]}`}
                style={{
                  left:    `${spot.x}%`,
                  top:     `${spot.y}%`,
                  width:   `${spot.size}%`,
                  opacity: 1 - spot.cleanliness / 100,
                }}
                aria-hidden
              />
            ))}

            {/* 스펀지 커서 (마우스가 접시 위에 있을 때만) */}
            {cursorPos ? (
              <span
                className={
                  dragging
                    ? `${styles.sponge} ${styles.spongeActive}`
                    : styles.sponge
                }
                style={{
                  left: `${cursorPos.x}%`,
                  top:  `${cursorPos.y}%`,
                }}
                aria-hidden
              >
                🧽
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* 그만두기 (완성 버튼 없음 : 자동 채점 방식) */}
      <div className={styles.actionRow}>
        <button className={styles.ghostBtn} onClick={onExit}>
          그만두기
        </button>
      </div>

      {/* 리워드 팝업 */}
      {phase === "submitting" || phase === "done" ? (
        <RewardPopup
          result={result}
          score={finalScore}
          gameName="설거지"
          onClose={onExit}
          onRetry={handleRetry}
          canRetry={canRetry}
        />
      ) : null}
    </div>
  );
}