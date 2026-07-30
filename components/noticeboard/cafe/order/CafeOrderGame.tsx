// components/noticeboard/cafe/order/CafeOrderGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 주문 받기 (cafe_order) 미니게임 본체 — 세로형 POS 레이아웃
// ═══════════════════════════════════════════════════════════════════
//
// 레이아웃:
//   왼편  : 손님(카운터 너머). 이미지 placeholder 슬롯(후속 교체).
//           말풍선이 0.5초 간격 순차 제시.
//   오른편: POS 단말기. 상단 CRT 모니터(입력 실시간 표시) + 하단 옵션 자판.
//
// 흐름 (세션 J 확정 + 조정):
//   intro
//    → [손님 i]
//        presenting: 말풍선 0.5초 순차. 입력은 등장 즉시 가능(막지 않음).
//        입력이 옵션 수만큼 차면 "입력 완료" 버튼 활성.
//        입력 완료 → reviewing: 이 손님 즉시 채점 결과 표시("○/○ 정답").
//        "다음 손님"(또는 마지막이면 "정산하기")
//    → 모든 손님 끝 → 제출(playCafeMinigame) → RewardPopup
//
// 규칙:
//   · 손님 등장과 동시에 입력 가능(사용자 조정).
//   · 오답이어도 계속 입력. 옵션 수만큼 눌러야 완료 가능(C1=a 기반, 단 자동
//     전환 대신 "입력 완료" 버튼으로 확정 — 사용자 조정 (나)).
//   · 온도 고정 음료(프라페·에이드)는 온도 축 자판 비활성 + 고정 배지 표시.
//   · 중도 이탈은 제출 안 함 → 카운트 미차감.
//
// 안정성:
//   · 제출 1회(submitLock). 타이머 정리. 채점은 손님별 확정 시점에 고정.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CafeOrderGame.module.css";
import RewardPopup from "../RewardPopup";
import { playCafeMinigame, type PlayResult } from "@/lib/minigame-helpers";
import {
  generateRound,
  scoreOrders,
  scoreOneCustomer,
  orderToText,
  AXIS_VALUES,
  AXIS_LABELS,
  AXIS_COLORS,
  BUTTON_LAYOUT,
  FIXED_TEMP,
  type CustomerOrder,
  type InputEntry,
  type AxisKey,
} from "./orderData";

// 말풍선 제시 간격 (ms)
const PRESENT_INTERVAL = 800;

type Phase = "intro" | "presenting" | "input" | "reviewing" | "submitting" | "done";

type Props = {
  onExit:   () => void;
  onPlayed: () => void;
};

export default function CafeOrderGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [custIdx, setCustIdx] = useState(0);

  const [presentIdx, setPresentIdx] = useState(-1);
  const [inputs, setInputs] = useState<InputEntry[][]>([]);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  const [result, setResult] = useState<PlayResult | null>(null);
  const [finalScore, setFinalScore] = useState(0);

  const presentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitLock = useRef(false);

  const clearPresentTimer = () => {
    if (presentTimer.current) { clearTimeout(presentTimer.current); presentTimer.current = null; }
  };
  const clearAll = () => {
    clearPresentTimer();
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  useEffect(() => () => clearAll(), []);

  /* ── 시작 ──────────────────────────────────────── */
  const startGame = useCallback(() => {
    const round = generateRound(2);
    setOrders(round);
    setInputs(round.map(() => []));
    setCustIdx(0);
    setResult(null);
    setFinalScore(0);
    setPressedKey(null);
    submitLock.current = false;
    setPhase("presenting");
    setPresentIdx(0);
  }, []);

  /* ── 손님 전환 시 제시 시작 ────────────────────── */
  useEffect(() => {
    if (phase !== "presenting") return;
    if (!orders[custIdx]) return;
    setPresentIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custIdx]);

  /* ── 제시 순차 진행 ────────────────────────────── */
  useEffect(() => {
    if (phase !== "presenting" && phase !== "input") return;
    const order = orders[custIdx];
    if (!order || presentIdx < 0) return;

    if (presentIdx < order.items.length - 1) {
      presentTimer.current = setTimeout(() => setPresentIdx((p) => p + 1), PRESENT_INTERVAL);
    } else {
      presentTimer.current = setTimeout(() => {
        setPresentIdx(-1);
        setPhase("input");
      }, PRESENT_INTERVAL);
    }
    return clearPresentTimer;
  }, [phase, presentIdx, custIdx, orders]);

  // 제시 시작과 동시에 입력 phase 로도 진입(입력 즉시 허용).
  // presenting 중에도 handleInput 이 동작하도록, phase 는 presenting 이되
  // 입력은 항상 허용한다.
  const inputAllowed = phase === "presenting" || phase === "input";

  /* ── 입력 ──────────────────────────────────────── */
  const handleInput = (axis: AxisKey, valueKey: string) => {
    if (!inputAllowed) return;
    const order = orders[custIdx];
    if (!order) return;
    const cur = inputs[custIdx] ?? [];
    if (cur.length >= order.items.length) return;

    setPressedKey(`${axis}:${valueKey}`);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressedKey(null), 180);

    setInputs((prev) => {
      const next = prev.map((a) => a.slice());
      next[custIdx].push({ axis, valueKey });
      return next;
    });
  };

  const undoLast = () => {
    if (!inputAllowed) return;
    const cur = inputs[custIdx] ?? [];
    if (cur.length === 0) return;
    setInputs((prev) => {
      const next = prev.map((a) => a.slice());
      next[custIdx].pop();
      return next;
    });
  };

  /* ── 입력 완료 → 손님별 채점 표시 ──────────────── */
  const confirmCustomer = () => {
    clearPresentTimer();
    setPresentIdx(-1);
    setPhase("reviewing");
  };

  /* ── 다음 손님 / 정산 ──────────────────────────── */
  const goNext = () => {
    if (custIdx < orders.length - 1) {
      setCustIdx((c) => c + 1);
      setPhase("presenting");
      setPresentIdx(0);
    } else {
      finalizeAndSubmit();
    }
  };

  /* ── 제출 ──────────────────────────────────────── */
  const finalizeAndSubmit = useCallback(async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    clearAll();

    const scoreRes = scoreOrders(orders, inputs);
    setFinalScore(scoreRes.score);
    setPhase("submitting");
    setResult(null);

    const detail = {
      miss_count: scoreRes.miss,
      correct: scoreRes.correct,
      total_options: scoreRes.totalOptions,
      per_customer: scoreRes.perCustomer,
      orders: orders.map(orderToText),
    };
    const res = await playCafeMinigame("cafe_order", scoreRes.score, detail);
    setResult(res);
    setPhase("done");
    onPlayed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, inputs, onPlayed]);

  const canRetry = result?.ok === true ? result.playsRemaining > 0 : false;
  const handleRetry = () => { if (canRetry) startGame(); };

  /* ─────────────────────────────────────────────────
   * 렌더
   * ───────────────────────────────────────────────── */

  if (phase === "intro") {
    return (
      <div className={styles.wrap}>
        <div className={styles.intro}>
          <div className={styles.introTitle}>🧾 주문 받기</div>
          <p className={styles.introBody}>
            손님이 주문을 순서대로 말합니다. 말풍선이 지나가니 포스기 자판으로
            말한 순서 그대로 눌러 주문을 받아 주십시오. 말하는 도중에 눌러도
            됩니다. 한 손님을 마치면 입력 완료를 눌러 점수를 확인하고 다음
            손님으로 넘어갑니다. 손님 2명을 응대합니다.
          </p>
          <button className={styles.primaryBtn} onClick={startGame}>알바 시작</button>
          <button className={styles.ghostBtn} onClick={onExit}>← 카페로 돌아가기</button>
        </div>
      </div>
    );
  }

  const order = orders[custIdx];
  const curInput = inputs[custIdx] ?? [];
  const presenting = presentIdx >= 0;
  const fullyEntered = order ? curInput.length >= order.items.length : false;
  const fixedTemp = order ? FIXED_TEMP[order.drink] : undefined;

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <span className={styles.customerTag}>손님 {custIdx + 1} / {orders.length}</span>
        <span className={styles.phaseTag}>
          {phase === "reviewing" ? "주문 확인" : presenting ? "주문을 말하는 중…" : "주문 입력"}
        </span>
      </div>

      <div className={styles.main}>
        {/* ── 왼편: 손님 ── */}
        <div className={styles.customerSide}>
          {fixedTemp ? (
            <div className={styles.fixedTempBadge}>이 음료는 {fixedTemp}만</div>
          ) : null}
          {presenting && order ? (
            <div className={styles.bubble}>{order.items[presentIdx]?.value.label}</div>
          ) : phase !== "reviewing" ? (
            <div className={`${styles.bubble} ${styles.bubbleIdle}`}>주문을 입력해 주세요</div>
          ) : null}
          <div className={styles.customerImage}>
            {/* 손님 이미지 placeholder — 후속에서 배경 이미지로 교체 */}
            <span className={styles.customerFacePlaceholder}>🧑‍🦰</span>
          </div>
          <div className={styles.counter} />
        </div>

        {/* ── 오른편: POS ── */}
        <div className={styles.pos}>
          {/* CRT 모니터 */}
          <div className={styles.crt}>
            <div className={styles.crtHeader}>
              <span>ORDER TICKET</span>
              <span>#{custIdx + 1}</span>
            </div>
            {curInput.length === 0 ? (
              <div className={styles.crtEmpty}>
                입력 대기 중<span className={styles.crtCursor}>█</span>
              </div>
            ) : (
              <div className={styles.crtLines}>
                {curInput.map((entry, i) => {
                  const val = AXIS_VALUES[entry.axis].find((v) => v.key === entry.valueKey);
                  return (
                    <div key={i} className={styles.crtLine}>
                      <span>
                        <span className={styles.crtLineNum}>{String(i + 1).padStart(2, "0")}</span>
                        {val?.label ?? entry.valueKey}
                      </span>
                    </div>
                  );
                })}
                {!fullyEntered ? (
                  <div className={styles.crtLine}>
                    <span><span className={styles.crtLineNum}>{String(curInput.length + 1).padStart(2, "0")}</span>
                    <span className={styles.crtCursor}>█</span></span>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {phase === "reviewing" ? (
            /* 손님별 채점 결과 */
            (() => {
              const s = scoreOneCustomer(order, curInput);
              const isLast = custIdx >= orders.length - 1;
              return (
                <div className={styles.scoreCard}>
                  <span className={styles.scoreCardTitle}>
                    {s.correct === s.total ? "완벽해요!" : "주문 확인"}
                  </span>
                  <span className={styles.scoreCardStat}>{s.correct} / {s.total} 정답</span>
                  <div className={styles.scoreReview}>
                    {order.items.map((it, i) => {
                      const got = curInput[i];
                      const gotVal = got ? AXIS_VALUES[got.axis].find((v) => v.key === got.valueKey) : null;
                      return (
                        <div key={i} className={styles.reviewRow}>
                          <span>{it.value.label}</span>
                          <span className={s.itemHits[i] ? styles.reviewOk : styles.reviewBad}>
                            {s.itemHits[i] ? "✓" : `✗ ${gotVal?.label ?? "-"}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <button className={styles.nextBtn} onClick={goNext}>
                    {isLast ? "정산하기" : "다음 손님 →"}
                  </button>
                </div>
              );
            })()
          ) : (
            <>
              {/* 옵션 자판 (격자형 POS 키패드, 2컬럼 배치) */}
              <div className={styles.keypad}>
                {BUTTON_LAYOUT.map((axis) => {
                  const tempDisabled = axis === "temp" && !!fixedTemp;
                  const count = AXIS_VALUES[axis].length;
                  // 값 5개 축은 두 열 전체 폭 사용, 그 외는 한 열 셀
                  const wide = count >= 5;
                  return (
                    <div
                      key={axis}
                      className={`${styles.axisRow} ${wide ? styles.axisRowWide : ""} ${tempDisabled ? styles.axisRowDisabled : ""}`}
                    >
                      <span
                        className={styles.axisChip}
                        style={{ ["--chip" as string]: AXIS_COLORS[axis] }}
                      >
                        {AXIS_LABELS[axis]}
                      </span>
                      <div
                        className={styles.axisKeys}
                        style={{ ["--cols" as string]: String(count) }}
                      >
                        {AXIS_VALUES[axis].map((opt) => {
                          const key = `${axis}:${opt.key}`;
                          const isPressed = pressedKey === key;
                          return (
                            <button
                              key={opt.key}
                              className={`${styles.optBtn} ${isPressed ? styles.optBtnPressed : ""} ${tempDisabled ? styles.optBtnDisabled : ""}`}
                              onClick={() => handleInput(axis, opt.key)}
                              disabled={tempDisabled}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.progressDots}>
                {order?.items.map((_, i) => (
                  <span key={i} className={`${styles.dot} ${i < curInput.length ? styles.dotFilled : ""}`} />
                ))}
              </div>

              <div className={styles.posActions}>
                <button className={styles.undoBtn} onClick={undoLast} disabled={curInput.length === 0}>
                  취소
                </button>
                <button className={styles.confirmBtn} onClick={confirmCustomer} disabled={!fullyEntered}>
                  입력 완료
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.exitRow}>
        <button className={styles.ghostBtn} onClick={onExit}>그만두기</button>
      </div>

      {phase === "submitting" || phase === "done" ? (
        <RewardPopup
          result={result}
          score={finalScore}
          onClose={onExit}
          onRetry={handleRetry}
          canRetry={canRetry}
        />
      ) : null}
    </div>
  );
}