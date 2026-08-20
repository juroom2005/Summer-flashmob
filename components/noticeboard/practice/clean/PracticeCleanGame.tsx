// components/noticeboard/practice/clean/PracticeCleanGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습실 청소 (practice_clean) 미니게임 본체
// ═══════════════════════════════════════════════════════════════════
//
// 게임 방식 (세션 L 재설계) :
//   · 연습실 바닥에 쓰레기 5~7개 랜덤 배치
//   · 하단 오른쪽 코너에 쓰레기통 고정
//   · 유저가 쓰레기를 드래그해서 쓰레기통에 드롭 → 수거
//   · 쓰레기통 밖에서 드롭 → 놓은 위치에 그대로 남음 (재시도 가능, 관대함)
//   · 20초 안에 최대한 많이 수거
//   · 모든 쓰레기 수거 → 조기 종료 · 자동 채점
//   · 시간 초과 → 자동 채점
//   · 별 1 · 난이도 가산 없음 (RPC 축소 스케일 자동 처리)
//
// 조작 (Pointer Events, 마우스·터치 통합) :
//   · pointerdown : findPickupTarget → 대상 있으면 picked_up 상태로 · draggingId 저장
//   · pointermove : 커서 위치 갱신 + 드래그 중 아이템 위치를 커서로
//   · pointerup   : isOverBin 판정
//                    → 통 안이면 in_bin (수거 완료, 화면에서 숨김)
//                    → 통 밖이면 idle 복귀 (놓은 위치에 남음)
//   · pointercancel / pointerleave : pointerup 과 동일 처리
//
// 안정성 :
//   · submitLock 으로 중복 제출 방어
//   · 언마운트 시 타이머 정리
//   · touchAction: none 으로 모바일 스크롤 방해 방지
//   · setState 콜백 안 부작용 금지 (StrictMode 대응, v12 §7-1 교훈)
//     · 드롭 판정은 setState 밖에서 미리 계산, 이후 setItems 한 번만 호출

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
  generateTrashItems,
  findPickupTarget,
  isOverBin,
  isAllCollected,
  calculateFinalScore,
  TIME_LIMIT_SEC,
  BIN_CENTER_X,
  BIN_CENTER_Y,
  BIN_HALF_W,
  BIN_HALF_H,
  TRASH_EMOJI,
  type TrashItem,
} from "./cleanData";

type Phase = "intro" | "playing" | "submitting" | "done";

type Props = {
  onExit:   () => void;
  onPlayed: () => void;
};

export default function PracticeCleanGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase]                 = useState<Phase>("intro");
  const [items, setItems]                 = useState<TrashItem[]>([]);
  const [remainingSec, setRemainingSec]   = useState(TIME_LIMIT_SEC);
  const [finalScore, setFinalScore]       = useState(0);
  const [result, setResult]               = useState<PracticePlayResult | null>(null);

  // 드래그 · 커서 상태
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [cursorPos, setCursorPos]   = useState<{ x: number; y: number } | null>(null);

  const submitLock = useRef(false);
  const gameTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const floorRef   = useRef<HTMLDivElement | null>(null);

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
    const fresh = generateTrashItems();
    setItems(fresh);
    setRemainingSec(TIME_LIMIT_SEC);
    setFinalScore(0);
    setResult(null);
    setDraggingId(null);
    setCursorPos(null);
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
   *   · 조기 종료 (isAllCollected === true)
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
    setDraggingId(null);
    setCursorPos(null);

    const score = calculateFinalScore(items, remainingSec);

    setFinalScore(score.finalScore);
    setPhase("submitting");
    setResult(null);

    const detail = {
      total_items:     score.totalItems,
      collected_items: score.collectedItems,
      remaining_items: score.remainingItems,
      accuracy_score:  score.accuracyScore,
      time_bonus:      score.timeBonus,
      remaining_sec:   remainingSec,
      time_out:        remainingSec === 0,
      cleared_early:   score.remainingItems === 0 && remainingSec > 0,
    };

    const res = await playPracticeMinigame("practice_clean", score.finalScore, detail);
    setResult(res);
    setPhase("done");
    onPlayed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, remainingSec, onPlayed, clearGameTimer]);

  /* 시간 초과 자동 채점 */
  useEffect(() => {
    if (phase === "playing" && remainingSec === 0) {
      finalizeAndSubmit();
    }
  }, [phase, remainingSec, finalizeAndSubmit]);

  /* 조기 종료 : 모든 쓰레기 수거 시 즉시 채점 */
  useEffect(() => {
    if (phase === "playing" && items.length > 0 && isAllCollected(items)) {
      finalizeAndSubmit();
    }
  }, [phase, items, finalizeAndSubmit]);

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

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    const pos = toFloorPercent(e.clientX, e.clientY);
    if (!pos) return;
    setCursorPos(pos);

    // 쓰레기통 위에서 pointerdown → 무시 (드래그 시작 안 함)
    if (isOverBin(pos.x, pos.y)) return;

    const targetId = findPickupTarget(items, pos.x, pos.y);
    if (!targetId) return;

    setDraggingId(targetId);
    // 아이템 상태를 picked_up 로, 위치도 커서 위치로 초기 스냅
    setItems((prev: TrashItem[]) =>
      prev.map((it) =>
        it.id === targetId
          ? { ...it, status: "picked_up", x: pos.x, y: pos.y }
          : it
      )
    );
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    const pos = toFloorPercent(e.clientX, e.clientY);
    if (!pos) return;
    setCursorPos(pos);

    // 드래그 중이면 해당 아이템 위치를 커서로 갱신
    if (draggingId) {
      setItems((prev: TrashItem[]) =>
        prev.map((it) =>
          it.id === draggingId ? { ...it, x: pos.x, y: pos.y } : it
        )
      );
    }
  };

  /**
   * 드롭 처리. pointerup · pointercancel · pointerleave 통합.
   * · draggingId 있는 상태에서만 드롭 판정
   * · 통 안이면 in_bin, 밖이면 idle 복귀 (놓은 위치 유지)
   */
  const finalizeDrop = useCallback((cursorX: number | null, cursorY: number | null) => {
    if (!draggingId) return;

    // 커서 위치 없으면 (예: pointerleave 후) 안전하게 아이템 마지막 x/y 로 판정
    const currentItem = items.find((it) => it.id === draggingId);
    const finalX = cursorX ?? currentItem?.x ?? 0;
    const finalY = cursorY ?? currentItem?.y ?? 0;
    const success = isOverBin(finalX, finalY);

    setItems((prev: TrashItem[]) =>
      prev.map((it) =>
        it.id === draggingId
          ? success
            ? { ...it, status: "in_bin" }
            : { ...it, status: "idle" }  // 놓은 위치에 그대로 남음 (관대함)
          : it
      )
    );
    setDraggingId(null);
  }, [draggingId, items]);

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    const pos = toFloorPercent(e.clientX, e.clientY);
    finalizeDrop(pos?.x ?? null, pos?.y ?? null);
  };

  const handlePointerCancel = () => {
    finalizeDrop(null, null);
  };

  const handlePointerLeave = () => {
    // 바닥 밖으로 나가면 드롭 (실패 처리 · 마지막 위치에 남김)
    finalizeDrop(null, null);
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
            연습실 바닥에 놓인 쓰레기를 잡아 오른쪽 아래 쓰레기통에 넣어 주세요.
            드래그해서 통 안에 놓으면 수거됩니다. 통 밖에 놓아도 다시 잡을 수 있습니다.
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

  const totalItems     = items.length;
  const collectedItems = items.filter((it) => it.status === "in_bin").length;
  const progressPct    = totalItems === 0 ? 0 : (collectedItems / totalItems) * 100;
  const lowTime        = remainingSec <= 5;
  const midTime        = remainingSec <= 10 && !lowTime;
  const timerClass     =
    lowTime ? `${styles.timer} ${styles.timerLow}` :
    midTime ? `${styles.timer} ${styles.timerMid}` :
              styles.timer;

  // 드래그 중 커서가 통 위에 있으면 하이라이트
  const binHover =
    draggingId !== null &&
    cursorPos !== null &&
    isOverBin(cursorPos.x, cursorPos.y);
  const binClass = binHover
    ? `${styles.bin} ${styles.binHover}`
    : styles.bin;

  return (
    <div className={styles.wrap}>
      <div className={styles.gameArea}>
        {/* HUD : 타이머 + 진행률 */}
        <div className={styles.hud}>
          <div className={timerClass}>⏱ {remainingSec}s</div>
          <div className={styles.progress}>
            <div className={styles.progressLabel}>
              수거한 쓰레기 {collectedItems} / {totalItems}
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
            {/* 쓰레기통 (고정 위치 · 사각형 목표 영역) */}
            <div
              className={binClass}
              style={{
                left:   `${BIN_CENTER_X}%`,
                top:    `${BIN_CENTER_Y}%`,
                width:  `${BIN_HALF_W * 2}%`,
                height: `${BIN_HALF_H * 2}%`,
              }}
              aria-hidden
            >
              <span className={styles.binEmoji}>🗑️</span>
            </div>

            {/* 쓰레기 아이템들 (in_bin 은 렌더 안 함) */}
            {items.map((it) => {
              if (it.status === "in_bin") return null;
              const cls =
                it.status === "picked_up"
                  ? `${styles.trash} ${styles.trashPicked}`
                  : styles.trash;
              return (
                <span
                  key={it.id}
                  className={cls}
                  style={{
                    left: `${it.x}%`,
                    top:  `${it.y}%`,
                  }}
                  aria-hidden
                >
                  {TRASH_EMOJI[it.kind]}
                </span>
              );
            })}
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