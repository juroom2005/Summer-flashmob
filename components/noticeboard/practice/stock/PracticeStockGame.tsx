// components/noticeboard/practice/stock/PracticeStockGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습실 재고 정리 (practice_stock) 미니게임 본체
// ═══════════════════════════════════════════════════════════════════
//
// 게임 방식 (별 2, 카페 mix 대칭) :
//   · 창고 (좌) : 5종 박스 (📄🎤🎧💧🧻) 항상 자리에 있음
//   · 선반 (우) : 3~5개 슬롯, 각 슬롯 지시 품목·목표 수량 표시
//   · 유저는 창고에서 박스를 뽑아 정확한 슬롯에 드롭
//     · 옳은 슬롯 + 미완료 → 카운트 +1
//     · 잘못된 슬롯 · 초과 슬롯 · 바깥 드롭 → 박스 사라짐 (감점 없음)
//   · 30초 안 완료 · 조기 종료 지원
//   · 시간 초과 → 자동 채점
//
// 조작 (Pointer Events) :
//   · pointerdown on 창고 박스 : 드래그 시작 (draggingBox 상태 설정)
//   · pointermove on 보드     : 커서 갱신 + 슬롯 hover 판정 (elementFromPoint)
//   · pointerup   on 보드     : 슬롯 히트 판정 (elementFromPoint) → evaluateDrop
//   · pointercancel/leave     : 드래그 종료 (박스 사라짐)
//
// 안정성 :
//   · submitLock 으로 중복 제출 방어
//   · 언마운트 시 타이머 정리
//   · touchAction: none 으로 모바일 스크롤 방해 방지
//   · setState 콜백 안 부작용 금지 (StrictMode 대응, v12 §7-1 교훈)
//   · dragging 박스 요소는 pointer-events: none — elementFromPoint 가 자기 자신을
//     반환하지 않도록 (안 그러면 슬롯 검출 실패)

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./PracticeStockGame.module.css";
import PracticeRewardPopup from "../PracticeRewardPopup";
import {
  playPracticeMinigame,
  type PracticePlayResult,
} from "@/lib/minigame-helpers";
import {
  generateSlots,
  evaluateDrop,
  calculateFinalScore,
  isAllComplete,
  STOCK_EMOJI,
  STOCK_LABEL,
  STOCK_KEYS,
  TIME_LIMIT_SEC,
  type StockSlot,
  type StockItemKey,
} from "./stockData";

type Phase = "intro" | "playing" | "submitting" | "done";

// 드래그 중인 박스 상태
type DraggingBox = {
  itemKey: StockItemKey;
  x:       number;  // 보드 대비 %
  y:       number;
};

type Props = {
  onExit:   () => void;
  onPlayed: () => void;
};

export default function PracticeStockGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase]                 = useState<Phase>("intro");
  const [slots, setSlots]                 = useState<StockSlot[]>([]);
  const [remainingSec, setRemainingSec]   = useState(TIME_LIMIT_SEC);
  const [finalScore, setFinalScore]       = useState(0);
  const [result, setResult]               = useState<PracticePlayResult | null>(null);

  // 드래그 상태
  const [draggingBox, setDraggingBox] = useState<DraggingBox | null>(null);
  const [hoverSlotId, setHoverSlotId] = useState<string | null>(null);

  const submitLock = useRef(false);
  const gameTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const boardRef   = useRef<HTMLDivElement | null>(null);

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
    const fresh = generateSlots();
    setSlots(fresh);
    setRemainingSec(TIME_LIMIT_SEC);
    setFinalScore(0);
    setResult(null);
    setDraggingBox(null);
    setHoverSlotId(null);
    submitLock.current = false;
    setPhase("playing");

    clearGameTimer();
    gameTimer.current = setInterval(() => {
      setRemainingSec((prev: number) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  }, [clearGameTimer]);

  /* ═══════════════════════════════════════════════
   * 완성 → 채점 → 제출
   * ─────────────────────────────────────────────── */

  const finalizeAndSubmit = useCallback(async () => {
    if (submitLock.current) return;
    submitLock.current = true;

    clearGameTimer();
    setDraggingBox(null);
    setHoverSlotId(null);

    const score = calculateFinalScore(slots, remainingSec);

    setFinalScore(score.finalScore);
    setPhase("submitting");
    setResult(null);

    const detail = {
      total_slots:       score.totalSlots,
      completed_slots:   score.completedSlots,
      total_target_qty:  score.totalTargetQty,
      total_current_qty: score.totalCurrentQty,
      accuracy_score:    score.accuracyScore,
      time_bonus:        score.timeBonus,
      remaining_sec:     remainingSec,
      time_out:          remainingSec === 0,
      cleared_early:     score.completedSlots === score.totalSlots && remainingSec > 0,
    };

    const res = await playPracticeMinigame("practice_stock", score.finalScore, detail);
    setResult(res);
    setPhase("done");
    onPlayed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, remainingSec, onPlayed, clearGameTimer]);

  /* 시간 초과 자동 채점 */
  useEffect(() => {
    if (phase === "playing" && remainingSec === 0) {
      finalizeAndSubmit();
    }
  }, [phase, remainingSec, finalizeAndSubmit]);

  /* 조기 종료 : 모든 슬롯 목표 도달 시 즉시 채점 */
  useEffect(() => {
    if (phase === "playing" && slots.length > 0 && isAllComplete(slots)) {
      finalizeAndSubmit();
    }
  }, [phase, slots, finalizeAndSubmit]);

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
   * ─────────────────────────────────────────────── */

  /**
   * 보드 요소 rect 기반으로 커서를 보드 대비 % 좌표로 환산.
   * (드래그 박스 위치 표시에만 사용. 슬롯 히트 판정은 elementFromPoint 로 별도 처리)
   */
  const toBoardPercent = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((clientX - rect.left) / rect.width)  * 100;
    const y = ((clientY - rect.top)  / rect.height) * 100;
    return { x, y };
  };

  /**
   * 커서 위치에서 슬롯 요소 찾기.
   * dragging 박스는 pointer-events: none 이라 elementFromPoint 가 자기 자신을 반환하지 않는다.
   */
  const findSlotAt = (clientX: number, clientY: number): string | null => {
    if (typeof document === "undefined") return null;
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const slotEl = (el as Element).closest("[data-slot-id]");
    if (!slotEl) return null;
    return (slotEl as HTMLElement).dataset.slotId ?? null;
  };

  /**
   * 창고 박스에서 드래그 시작.
   * 각 창고 박스에 직접 붙는 핸들러 (currentTarget 은 창고 박스 요소).
   */
  const handleWarehouseBoxDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    itemKey: StockItemKey,
  ) => {
    if (phase !== "playing") return;
    if (draggingBox) return;  // 이미 드래그 중이면 무시 (다른 손가락 등)
    const pos = toBoardPercent(e.clientX, e.clientY);
    if (!pos) return;
    setDraggingBox({ itemKey, x: pos.x, y: pos.y });
    setHoverSlotId(null);
    // stopPropagation 은 필요 없음 (보드 pointerdown 핸들러 없음)
  };

  /**
   * 보드 위 pointermove — 드래그 중일 때만 실제 처리.
   */
  const handleBoardPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    if (!draggingBox) return;

    const pos = toBoardPercent(e.clientX, e.clientY);
    if (pos) {
      setDraggingBox({ itemKey: draggingBox.itemKey, x: pos.x, y: pos.y });
    }

    // 슬롯 hover 판정 (매 프레임 elementFromPoint · 성능 부담 낮음)
    const nextHoverId = findSlotAt(e.clientX, e.clientY);
    if (nextHoverId !== hoverSlotId) setHoverSlotId(nextHoverId);
  };

  /**
   * 보드 위 pointerup — 드롭 판정.
   * 성공 시 슬롯 currentQty +1. 실패 시 박스 사라짐만.
   */
  const handleBoardPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    if (!draggingBox) return;

    const slotId = findSlotAt(e.clientX, e.clientY);
    const dropResult = evaluateDrop(slots, draggingBox.itemKey, slotId);

    if (dropResult.kind === "hit") {
      setSlots((prev: StockSlot[]) =>
        prev.map((s: StockSlot) =>
          s.id === dropResult.slotId
            ? { ...s, currentQty: s.currentQty + 1 }
            : s
        )
      );
    }
    // 모든 케이스에서 드래그 종료
    setDraggingBox(null);
    setHoverSlotId(null);
  };

  const handleBoardPointerCancel = () => {
    setDraggingBox(null);
    setHoverSlotId(null);
  };

  const handleBoardPointerLeave = () => {
    // 보드 밖으로 나가면 드래그 종료 (박스 사라짐)
    setDraggingBox(null);
    setHoverSlotId(null);
  };

  /* ═══════════════════════════════════════════════
   * 렌더 : intro
   * ─────────────────────────────────────────────── */

  if (phase === "intro") {
    return (
      <div className={styles.wrap}>
        <div className={styles.intro}>
          <div className={styles.introTitle}>📦 재고 정리</div>
          <p className={styles.introBody}>
            창고에서 박스를 뽑아 선반의 지정된 자리에 정확한 수량만큼 넣어
            주세요. 잘못된 자리나 바닥에 놓으면 박스는 사라지고 다시 뽑아야
            합니다. 30초 안에 모든 선반을 채우면 조기 종료됩니다.
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

  const totalSlots     = slots.length;
  const completedSlots = slots.filter((s) => s.currentQty >= s.targetQty).length;
  const progressPct    = totalSlots === 0 ? 0 : (completedSlots / totalSlots) * 100;
  const lowTime        = remainingSec <= 5;
  const midTime        = remainingSec <= 15 && !lowTime;
  const timerClass     =
    lowTime ? `${styles.timer} ${styles.timerLow}` :
    midTime ? `${styles.timer} ${styles.timerMid}` :
              styles.timer;

  return (
    <div className={styles.wrap}>
      <div className={styles.gameArea}>
        {/* HUD */}
        <div className={styles.hud}>
          <div className={timerClass}>⏱ {remainingSec}s</div>
          <div className={styles.progress}>
            <div className={styles.progressLabel}>
              완료 슬롯 {completedSlots} / {totalSlots}
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* 보드 : 창고 (좌) + 선반 (우) */}
        <div
          ref={boardRef}
          className={styles.board}
          style={{ touchAction: "none" }}
          onPointerMove={handleBoardPointerMove}
          onPointerUp={handleBoardPointerUp}
          onPointerCancel={handleBoardPointerCancel}
          onPointerLeave={handleBoardPointerLeave}
        >
          {/* 창고 */}
          <div className={styles.warehouse}>
            <div className={styles.warehouseTitle}>창고</div>
            <div className={styles.warehouseGrid}>
              {STOCK_KEYS.map((key: StockItemKey) => (
                <div
                  key={key}
                  className={styles.warehouseBox}
                  onPointerDown={(e) => handleWarehouseBoxDown(e, key)}
                >
                  <span className={styles.boxEmoji}>{STOCK_EMOJI[key]}</span>
                  <span className={styles.boxLabel}>{STOCK_LABEL[key]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 캐비닛 (선반장) : 프레임 안 여러 선반 칸 세로 나열 */}
          <div className={styles.cabinet}>
            <div className={styles.cabinetTitle}>선반</div>
            <div className={styles.cabinetInterior}>
              {slots.map((slot: StockSlot) => {
                const done   = slot.currentQty >= slot.targetQty;
                const isHover =
                  draggingBox !== null &&
                  hoverSlotId === slot.id;
                const validHover =
                  isHover &&
                  !done &&
                  draggingBox?.itemKey === slot.itemKey;
                const invalidHover =
                  isHover &&
                  !validHover;

                const cls = done
                  ? `${styles.cabinetShelf} ${styles.shelfDone}`
                  : validHover
                  ? `${styles.cabinetShelf} ${styles.shelfHoverValid}`
                  : invalidHover
                  ? `${styles.cabinetShelf} ${styles.shelfHoverInvalid}`
                  : styles.cabinetShelf;

                // 목표 개수만큼 박스 자리를 가로로 나열.
                // 왼쪽부터 채워짐 (currentQty 개까지 실 박스, 나머지 빈 자리)
                const boxSlots = Array.from({ length: slot.targetQty }, (_, i: number) => ({
                  filled: i < slot.currentQty,
                  key:    `${slot.id}_box_${i}`,
                }));

                return (
                  <div
                    key={slot.id}
                    data-slot-id={slot.id}
                    className={cls}
                  >
                    <div className={styles.shelfLabel}>
                      <span className={styles.shelfEmoji}>
                        {STOCK_EMOJI[slot.itemKey]}
                      </span>
                      <span className={styles.shelfName}>
                        {STOCK_LABEL[slot.itemKey]}
                      </span>
                      <span className={styles.shelfQty}>
                        {slot.currentQty} / {slot.targetQty}
                      </span>
                      {done ? (
                        <span className={styles.shelfCheck}>✓</span>
                      ) : null}
                    </div>
                    <div className={styles.shelfRow}>
                      {boxSlots.map((pos) => (
                        <div
                          key={pos.key}
                          className={
                            pos.filled
                              ? styles.placedBox
                              : styles.emptySlot
                          }
                        >
                          {pos.filled ? (
                            <span className={styles.placedBoxEmoji}>
                              {STOCK_EMOJI[slot.itemKey]}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 드래그 중인 박스 (커서 따라감, pointer-events: none) */}
          {draggingBox ? (
            <div
              className={styles.dragBox}
              style={{
                left: `${draggingBox.x}%`,
                top:  `${draggingBox.y}%`,
              }}
              aria-hidden
            >
              <span className={styles.boxEmoji}>
                {STOCK_EMOJI[draggingBox.itemKey]}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.actionRow}>
        <button className={styles.ghostBtn} onClick={onExit}>
          그만두기
        </button>
      </div>

      {phase === "submitting" || phase === "done" ? (
        <PracticeRewardPopup
          result={result}
          score={finalScore}
          gameName="재고 정리"
          onClose={onExit}
          onRetry={handleRetry}
          canRetry={canRetry}
        />
      ) : null}
    </div>
  );
}