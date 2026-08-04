// components/noticeboard/practice/clean/PracticeCleanGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습실 청소 (practice_clean) 미니게임 본체
// ═══════════════════════════════════════════════════════════════════
//
// 카페 CafeDishGame 을 복제해서 신설.
// 안정성 원칙 상 카페 컴포넌트는 참조·수정하지 않는다.
//
// 카페 설거지와 다른 점 :
//   · 도메인 : 접시 → 연습실 바닥 (사각형)
//   · 도구   : 스펀지 🧽 → 대걸레 🧹
//   · 얼룩   : 어두운 갈색 (요리 얼룩) → 회갈색 (먼지 뭉치)
//   · 서버   : playCafeMinigame("cafe_dish") → playPracticeMinigame("practice_clean")
//   · 팝업   : RewardPopup → PracticeRewardPopup (리듬감 EXP 표기)
//   · 문구   : "카페로" → "연습실로"
//
// 규칙 (완전 동일, cleanData 상수 그대로 재사용) :
//   · 15초 안에 드래그로 문질러 먼지 지우기
//   · 스팟 위 재진입 시 청결도 +70 (2번 지나가야 완전 소멸)
//   · 모든 스팟 청결 → 조기 종료 · 자동 채점
//   · 시간 초과 → 자동 채점 (지금까지 상태로)
//   · 채점 : 비율 감산 (cleaned / total × 100) + 시간 보너스 (0~10) · 100 캡
//   · 별 1 · 난이도 가산 없음
//
// 조작 (Pointer Events, 마우스·터치 통합) :
//   · pointerdown  → 드래그 시작
//   · pointermove  → 바닥 % 좌표로 변환 → 각 스팟에 대해 재진입 감지
//   · pointerup / pointerleave / pointercancel → 드래그 종료 · inside ref 리셋
//
// 안정성 :
//   · submitLock 으로 중복 제출 방어
//   · 언마운트 시 타이머 정리
//   · touchAction: none 으로 모바일 스크롤 방해 방지
//   · setState 콜백 안 부작용 금지 (StrictMode 대응, v12 §7-1 교훈)

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./PracticeCleanGame.module.css";
import PracticeRewardPopup from "../PracticeRewardPopup";
import {
  playPracticeMinigame,
  type PracticePlayResult,
} from "@/lib/minigame-helpers";
import {
  generateSpots,
  isInsideSpot,
  isAllClean,
  calculateFinalScore,
  SCRUB_DAMAGE,
  TIME_LIMIT_SEC,
  type CleanSpot,
} from "./cleanData";

type Phase = "intro" | "playing" | "submitting" | "done";

type Props = {
  onExit:   () => void;
  onPlayed: () => void;
};

export default function PracticeCleanGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase]                     = useState<Phase>("intro");
  const [spots, setSpots]                     = useState<CleanSpot[]>([]);
  const [remainingSec, setRemainingSec]       = useState(TIME_LIMIT_SEC);
  const [finalScore, setFinalScore]           = useState(0);
  const [accuracyScore, setAccuracyScore]     = useState(0);
  const [timeBonus, setTimeBonus]             = useState(0);
  const [result, setResult]                   = useState<PracticePlayResult | null>(null);

  // 드래그 · 커서 상태
  const [dragging, setDragging]     = useState(false);
  const [cursorPos, setCursorPos]   = useState<{ x: number; y: number } | null>(null);

  const submitLock       = useRef(false);
  const gameTimer        = useRef<ReturnType<typeof setInterval> | null>(null);
  const floorRef         = useRef<HTMLDivElement | null>(null);
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
      setRemainingSec((prev: number) => (prev > 0 ? prev - 1 : 0));
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

    const res = await playPracticeMinigame("practice_clean", score.finalScore, detail);
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
   * 바닥 밖으로 나가면 (pointerleave) 드래그 종료 · inside 리셋.
   * ─────────────────────────────────────────────── */

  /**
   * 바닥 요소의 rect 를 기반으로 커서를 바닥 대비 % 좌표 (0~100) 로 환산.
   */
  const toFloorPercent = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    const el = floorRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((clientX - rect.left) / rect.width)  * 100;
    const y = ((clientY - rect.top)  / rect.height) * 100;
    return { x, y };
  };

  /**
   * 재진입 감지 → 청결도 증가.
   * StrictMode 안전 : setState 콜백 안에 부작용 넣지 않음 (v12 §7-1 교훈).
   * 부작용 (spotInsideRef mutation · hit 판정) 은 setState 밖에서 한 번만 수행.
   */
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

    setSpots((prev: CleanSpot[]) =>
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
    const pos = toFloorPercent(e.clientX, e.clientY);
    if (pos) {
      setCursorPos(pos);
      scrubAtPosition(pos.x, pos.y);
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    if (!dragging) {
      // 드래그 중이 아니어도 커서 위치는 갱신 (대걸레 아이콘 위치 표시용)
      const pos = toFloorPercent(e.clientX, e.clientY);
      if (pos) setCursorPos(pos);
      return;
    }
    const pos = toFloorPercent(e.clientX, e.clientY);
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
    // 바닥 밖으로 나가면 드래그 종료 + 커서 표시 감춤
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
          <div className={styles.introTitle}>🧹 연습실 청소</div>
          <p className={styles.introBody}>
            연습실 바닥에 쌓인 먼지 뭉치를 시간 안에 문질러 지우십시오. 대걸레로
            먼지 위를 두 번 지나가면 완전히 사라집니다. 15초 안에 모든 먼지를
            치우면 조기 종료됩니다.
          </p>
          <div className={styles.introActions}>
            <button className={styles.primaryBtn} onClick={startGame}>
              시작하기
            </button>
            <button className={styles.ghostBtn} onClick={onExit}>
              ← 연습실로 돌아가기
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
              치운 먼지 {cleanedSpots} / {totalSpots}
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* 바닥 : 드래그 영역. touch-action: none 은 style 로 (모바일 스크롤 방지) */}
        <div className={styles.floorArea}>
          <div
            ref={floorRef}
            className={styles.floor}
            style={{ touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerLeave}
          >
            {/* 먼지 스팟들 */}
            {spots.map((spot) => (
              <div
                key={spot.id}
                className={styles.spot}
                style={{
                  left:    `${spot.x}%`,
                  top:     `${spot.y}%`,
                  width:   `${spot.size}%`,
                  opacity: 1 - spot.cleanliness / 100,
                }}
                aria-hidden
              />
            ))}

            {/* 대걸레 커서 (마우스가 바닥 위에 있을 때만) */}
            {cursorPos ? (
              <span
                className={
                  dragging
                    ? `${styles.mop} ${styles.mopActive}`
                    : styles.mop
                }
                style={{
                  left: `${cursorPos.x}%`,
                  top:  `${cursorPos.y}%`,
                }}
                aria-hidden
              >
                🧹
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
        <PracticeRewardPopup
          result={result}
          score={finalScore}
          gameName="연습실 청소"
          onClose={onExit}
          onRetry={handleRetry}
          canRetry={canRetry}
        />
      ) : null}
    </div>
  );
}