// components/noticeboard/cafe/mix/CafeMixGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 음료 제조 (cafe_mix) 미니게임 본체 (v3 · 페이지 넘김형 레시피북)
// ═══════════════════════════════════════════════════════════════════
//
// v2 → v3 변경 요약:
//   레시피북을 페이지 넘김형 도감으로 재설계.
//     · 좌측 검색+목록 → 폐기.
//     · 페이지 = 음료 1종당 좌우 스프레드 하나 (총 8페이지).
//     · 좌측 페이지 : 메뉴 이미지 슬롯 (나중에 리소스 붙임).
//     · 우측 페이지 : 레시피 상세.
//     · 오른쪽 옆에 북마크 탭 8개 세로 나열. 클릭 시 해당 페이지로 flip.
//     · 책 하단에 페이지 인디케이터 (X / 8) + 이전/다음 화살표.
//   책장 넘김 애니메이션:
//     · next 방향 : 우측 페이지가 좌로 회전 (rotateY 0 → -180deg).
//                   flipper 앞면 = 이전 우측(레시피), 뒷면 = 새 좌측(이미지).
//     · prev 방향 : 좌측 페이지가 우로 회전 (rotateY 0 → 180deg).
//                   flipper 앞면 = 이전 좌측(이미지), 뒷면 = 새 우측(레시피).
//
// 규칙 (v11 §8-1): 1잔 · 오답도 컵에 쌓임 · 위치별 채점
//                  · "완성" 눌러야 채점 · "컵 비우기"(입력만 초기화)
//                  · "그만두기"(카운트 미차감)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./CafeMixGame.module.css";
import RewardPopup from "../RewardPopup";
import { playCafeMinigame, type PlayResult } from "@/lib/minigame-helpers";
import {
  generateOrder,
  scoreLayers,
  recipeToText,
  inputToLabels,
  isIcedDrink,
  calculateFinalScore,
  INGREDIENTS,
  INGREDIENT_LIST,
  DRINKS,
  DRINK_LIST,
  MODIFIERS,
  TIME_LIMIT_SEC,
  type DrinkKey,
  type IngredientKey,
  type MixOrder,
  type ModifierKey,
} from "./mixData";

// 책장 넘김 애니메이션 지속시간 (ms). CSS keyframe 과 일치.
const FLIP_DURATION_MS = 650;

type Phase    = "intro" | "playing" | "submitting" | "done";
type FlipDir  = "next" | "prev";

type Props = {
  onExit:   () => void;
  onPlayed: () => void;
};

export default function CafeMixGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase]                     = useState<Phase>("intro");
  const [order, setOrder]                     = useState<MixOrder | null>(null);
  const [input, setInput]                     = useState<IngredientKey[]>([]);
  const [finalScore, setFinalScore]           = useState(0);
  const [accuracyScore, setAccuracyScore]     = useState(0);
  const [timeBonus, setTimeBonus]             = useState(0);
  const [result, setResult]                   = useState<PlayResult | null>(null);
  const [remainingSec, setRemainingSec]       = useState(TIME_LIMIT_SEC);

  // 레시피북 상태: 현재 페이지 인덱스 (0..DRINK_LIST.length-1)
  const [pageIdx, setPageIdx]     = useState(0);
  const [prevIdx, setPrevIdx]     = useState<number | null>(null);
  const [flipping, setFlipping]   = useState(false);
  const [flipDir, setFlipDir]     = useState<FlipDir>("next");

  const submitLock = useRef(false);
  const flipTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const ord = generateOrder();
    setOrder(ord);
    setInput([]);
    setFinalScore(0);
    setAccuracyScore(0);
    setTimeBonus(0);
    setResult(null);
    setRemainingSec(TIME_LIMIT_SEC);
    // 뽑힌 음료가 있는 페이지로 시작 (편의)
    const startIdx = Math.max(0, DRINK_LIST.indexOf(ord.drink));
    setPageIdx(startIdx);
    setPrevIdx(null);
    setFlipping(false);
    setFlipDir("next");
    if (flipTimer.current) {
      clearTimeout(flipTimer.current);
      flipTimer.current = null;
    }
    submitLock.current = false;
    setPhase("playing");
    // 게임 타이머 시작 (매초 감소, 0 도달 시 useEffect 가 자동 채점 트리거)
    clearGameTimer();
    gameTimer.current = setInterval(() => {
      setRemainingSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  }, [clearGameTimer]);

  /* ═══════════════════════════════════════════════
   * 재료 클릭 / 컵 비우기
   * ─────────────────────────────────────────────── */

  const onIngredientClick = (key: IngredientKey) => {
    if (phase !== "playing") return;
    setInput((prev) => [...prev, key]);
  };

  const onClearCup = () => {
    if (phase !== "playing") return;
    setInput([]);
  };

  /* ═══════════════════════════════════════════════
   * 페이지 이동 (flip 애니메이션 트리거)
   * ─────────────────────────────────────────────── */

  const goToPage = (target: number) => {
    if (flipping) return; // 애니메이션 중 무시
    if (target < 0 || target >= DRINK_LIST.length) return;
    if (target === pageIdx) return;

    const dir: FlipDir = target > pageIdx ? "next" : "prev";
    setPrevIdx(pageIdx);
    setPageIdx(target);
    setFlipDir(dir);
    setFlipping(true);

    if (flipTimer.current) clearTimeout(flipTimer.current);
    flipTimer.current = setTimeout(() => {
      setFlipping(false);
      setPrevIdx(null);
      flipTimer.current = null;
    }, FLIP_DURATION_MS);
  };

  /* ═══════════════════════════════════════════════
   * 완성 → 채점 → 제출
   *
   * 수동 (완성 버튼) · 자동 (시간 초과) 양쪽 진입점 통합.
   * · 수동은 완성 버튼 disabled 조건 (input.length >= 1) 이 UI 에서 방어.
   * · 자동은 remainingSec === 0 useEffect 트리거 (input 비어있어도 실행).
   * · submitLock 으로 중복 방어. 어느 쪽이 먼저든 한 번만 실행.
   * ─────────────────────────────────────────────── */

  const finalizeAndSubmit = useCallback(async () => {
    if (submitLock.current) return;
    if (!order) return;
    submitLock.current = true;

    // 타이머 즉시 정리 (자동 · 수동 모두)
    clearGameTimer();

    const layers = scoreLayers(order.recipe, input);
    const score  = calculateFinalScore(layers.correct, layers.total, remainingSec);

    setAccuracyScore(score.accuracyScore);
    setTimeBonus(score.timeBonus);
    setFinalScore(score.finalScore);
    setPhase("submitting");
    setResult(null);

    const detail = {
      drink_code:      order.drink,
      drink_name:      order.label,
      layers_correct:  layers.correct,
      layers_total:    layers.total,
      recipe_layers:   order.recipe.map((k) => INGREDIENTS[k].label),
      input_layers:    inputToLabels(input),
      modifiers:       order.modifiers,
      modifier_labels: order.modifiers.map((m) => MODIFIERS[m].label),
      accuracy_score:  score.accuracyScore,
      time_bonus:      score.timeBonus,
      remaining_sec:   remainingSec,
      time_out:        remainingSec === 0,
    };

    const res = await playCafeMinigame("cafe_mix", score.finalScore, detail);
    setResult(res);
    setPhase("done");
    onPlayed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, input, remainingSec, onPlayed, clearGameTimer]);

  /* 시간 초과 자동 채점 : remainingSec 이 0 이 되면 트리거 */
  useEffect(() => {
    if (phase === "playing" && remainingSec === 0) {
      finalizeAndSubmit();
    }
  }, [phase, remainingSec, finalizeAndSubmit]);

  /* 언마운트 시 타이머 정리 (안정성) */
  useEffect(() => {
    return () => {
      clearGameTimer();
      if (flipTimer.current) {
        clearTimeout(flipTimer.current);
        flipTimer.current = null;
      }
    };
  }, [clearGameTimer]);

  const canRetry = result?.ok === true ? result.playsRemaining > 0 : false;
  const handleRetry = () => {
    if (canRetry) startGame();
  };

  /* ═══════════════════════════════════════════════
   * 렌더 : intro
   * ─────────────────────────────────────────────── */

  if (phase === "intro") {
    return (
      <div className={styles.wrap}>
        <div className={styles.intro}>
          <div className={styles.introTitle}>🥤 음료 제조</div>
          <p className={styles.introBody}>
            오더 티켓에 적힌 음료를 레시피대로 만드십시오. 레시피북은 상시
            열려 있으며, 재료를 아래부터 위로 쌓아 완성하십시오. 층 순서가
            중요합니다.
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

  const iced = order ? isIcedDrink(order.recipe) : false;

  return (
    <div className={styles.wrap}>
      <div className={styles.main}>
        {/* ─── 왼편: 오더 티켓 + 컵 ─── */}
        <div className={styles.left}>
          <OrderTicket order={order} input={input} remainingSec={remainingSec} />
          <CupArea iced={iced} input={input} />
        </div>

        {/* ─── 오른편: 레시피북 + 재료 자판 ─── */}
        <div className={styles.right}>
          <RecipeBook
            pageIdx={pageIdx}
            prevIdx={prevIdx}
            flipping={flipping}
            flipDir={flipDir}
            onGoToPage={goToPage}
          />
          <IngredientKeypad onClick={onIngredientClick} />
        </div>
      </div>

      {/* ─── 액션 버튼 ─── */}
      <div className={styles.actionRow}>
        <button
          className={styles.primaryBtn}
          onClick={finalizeAndSubmit}
          disabled={phase !== "playing" || input.length < 1}
        >
          완성
        </button>
        <button
          className={styles.secondaryBtn}
          onClick={onClearCup}
          disabled={phase !== "playing" || input.length < 1}
        >
          컵 비우기
        </button>
        <button className={styles.ghostBtn} onClick={onExit}>
          그만두기
        </button>
      </div>

      {/* ─── 리워드 팝업 ─── */}
      {phase === "submitting" || phase === "done" ? (
        <RewardPopup
          result={result}
          score={finalScore}
          gameName="음료 제조"
          onClose={onExit}
          onRetry={handleRetry}
          canRetry={canRetry}
        />
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 하위 컴포넌트 : 오더 티켓
 * ─────────────────────────────────────────────────────────────────── */

function OrderTicket({
  order,
  input,
  remainingSec,
}: {
  order:        MixOrder | null;
  input:        IngredientKey[];
  remainingSec: number;
}) {
  if (!order) return null;

  // 시간 압박 시각화: 10초 이하 빨간색, 20초 이하 강조
  const lowTime      = remainingSec <= 10;
  const midTime      = remainingSec <= 20 && !lowTime;
  const timerClass   =
    lowTime ? `${styles.ticketTimer} ${styles.ticketTimerLow}` :
    midTime ? `${styles.ticketTimer} ${styles.ticketTimerMid}` :
              styles.ticketTimer;

  // 다크초콜릿 개수 (0 이면 배지 표시 안 함)
  const chocolateCount = order.recipe.filter((r) => r === "dark_chocolate").length;
  const hasModCol      = order.modifiers.length > 0 || chocolateCount > 0;

  return (
    <div className={styles.orderTicket}>
      {/* 헤더 : "오늘의 오더" + 타이머 */}
      <div className={styles.ticketTopRow}>
        <span className={styles.ticketHeader}>오늘의 오더</span>
        <span className={timerClass}>⏱ {remainingSec}s</span>
      </div>

      {/* 본문 : 좌측(음료명·쌓은재료) · 우측(모디파이어 배지 열) */}
      <div className={styles.ticketBody}>
        <div className={styles.ticketMain}>
          <div className={styles.ticketDrink}>{order.label} · 1잔</div>
          <div className={styles.ticketDivider} />
          <div className={styles.ticketSubHead}>쌓은 재료 ({input.length})</div>
          {input.length === 0 ? (
            <div className={styles.ticketEmpty}>아직 비었습니다</div>
          ) : (
            <ol className={styles.ticketList} reversed>
              {[...input].reverse().map((k, i) => {
                const info = INGREDIENTS[k];
                return (
                  <li key={i} className={styles.ticketItem}>
                    <span
                      className={styles.ticketSwatch}
                      style={{ background: info.color }}
                    />
                    <span>
                      {info.emoji ? `${info.emoji} ` : ""}
                      {info.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* 우측 요청 열 : 다크초콜릿 개수 + 모디파이어 배지 */}
        {hasModCol ? (
          <div className={styles.ticketModCol}>
            <div className={styles.ticketModHead}>특별 요청</div>
            {chocolateCount > 0 ? (
              <div
                className={`${styles.ticketModBadge} ${styles.ticketModBadgeChocolate}`}
                title={`다크초콜릿 ${chocolateCount}개`}
              >
                🍫 × {chocolateCount}
              </div>
            ) : null}
            {order.modifiers.map((m) => {
              const info = MODIFIERS[m];
              const isPlus = info.short.startsWith("+") || info.short.startsWith("×");
              return (
                <div
                  key={m}
                  className={
                    isPlus
                      ? `${styles.ticketModBadge} ${styles.ticketModBadgePlus}`
                      : `${styles.ticketModBadge} ${styles.ticketModBadgeMinus}`
                  }
                  title={info.label}
                >
                  {info.short}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 하위 컴포넌트 : 컵 영역 (CSS div 방식, 참고 자료 스타일 이식)
 *
 *   핫 (카푸치노 · 핫초코) : Mug — 손잡이 달린 머그컵
 *   아이스 (나머지 6종)   : Cup-3 — 파도 표면 + 돔 뚜껑 + 기울어진 빨대
 *
 * 참고 자료(CodePen "Minimalistic Cups")의 clip-path · pseudo-element
 * 스타일을 최대한 유지하되 크기·색만 게임 톤에 맞춰 조정.
 * 컵 내부는 반투명으로 처리해 재료 층 stack 이 비쳐 보이도록 함.
 * ─────────────────────────────────────────────────────────────────── */

function CupArea({
  iced,
  input,
}: {
  iced: boolean;
  input: IngredientKey[];
}) {
  return (
    <div className={styles.cupArea}>
      <div className={styles.cupStage}>
        {iced ? <IceCup input={input} /> : <MugCup input={input} />}
      </div>
    </div>
  );
}

/* ─── Mug (핫) : 손잡이 달린 머그컵 ───────────────────
 * SVG 로 재작성 (v3 의 CSS pseudo-element 방식은 "사각형 + 도넛" 처럼
 * 조잡해 보였음). 몸통 · 손잡이 곡선 · 상단 개구부 · 밑받침을 SVG path 로.
 */
function MugCup({ input }: { input: IngredientKey[] }) {
  return (
    <div className={styles.mugCupWrap}>
      <svg
        viewBox="0 0 200 280"
        preserveAspectRatio="xMidYMid meet"
        className={styles.mugCupSvg}
        aria-hidden
      >
        {/* 밑받침 (얇은 타원) */}
        <ellipse
          cx="90" cy="252" rx="60" ry="6"
          fill="#e8dfcf" stroke="#3e2c1c" strokeWidth="2.5"
        />

        {/* 손잡이 (오른쪽 바깥 반원, 두 겹으로 두께 표현) */}
        <path
          d="M 140 100 C 195 100, 195 190, 140 190"
          fill="none" stroke="#3e2c1c" strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M 140 118 C 175 118, 175 172, 140 172"
          fill="none" stroke="#3e2c1c" strokeWidth="4"
          strokeLinecap="round"
        />
        {/* 손잡이 안쪽 흰 채움 (몸통 색과 조화) */}
        <path
          d="M 140 100 C 195 100, 195 190, 140 190 L 140 172 C 175 172, 175 118, 140 118 Z"
          fill="rgba(255, 253, 245, 0.55)"
        />

        {/* 몸통 (원통형, 살짝 아래가 좁아지는 자연스러운 실루엣) */}
        <path
          d="M 32 62 Q 32 55 39 55 L 141 55 Q 148 55 148 62 L 148 240 Q 148 248 141 248 L 39 248 Q 32 248 32 240 Z"
          fill="rgba(255, 253, 245, 0.42)"
          stroke="#3e2c1c" strokeWidth="4"
        />

        {/* 상단 개구부 (안쪽 어두운 타원) */}
        <ellipse
          cx="90" cy="55" rx="58" ry="8"
          fill="#d8cbb0" stroke="#3e2c1c" strokeWidth="3"
        />
      </svg>

      {/* 재료 층 stack : 몸통 안쪽 영역에 절대 위치.
         SVG viewBox 200×280 기준 몸통 내부 y=62~240 · x=32~148 → % 로 환산 */}
      <div className={styles.mugCupLayers}>
        {input.map((k, i) => {
          const info = INGREDIENTS[k];
          const isChocolate = k === "dark_chocolate";
          return (
            <div
              key={i}
              className={
                isChocolate
                  ? `${styles.layer} ${styles.chocolateLayer}`
                  : styles.layer
              }
              style={{ ["--layer-color" as string]: info.color }}
              title={info.label}
            >
              {isChocolate ? (
                <span className={styles.chocolateEmoji}>{info.emoji}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Cup-3 (아이스) : 파도 표면 + 돔 뚜껑 + 기울어진 빨대 ───
 * 원본의 clip-path polygon(0 0, 100% 0, 80% 100%, 20% 100%) 사다리꼴
 * 몸통을 그대로 유지. 파도 SVG 는 원본 그대로.
 * 뚜껑은 원본대로 어두운 돔, 빨대는 초록색·15deg 회전.
 */
function IceCup({ input }: { input: IngredientKey[] }) {
  return (
    <>
      <div className={styles.iceCupBody} aria-hidden>
        <div className={styles.iceCupWave}>
          <svg viewBox="0 0 500 500" preserveAspectRatio="none">
            <path
              d="M0,100 C150,200 350,0 500,100 L500,0 L0,0 Z"
              fill="#d5b498"
            />
          </svg>
        </div>
        <div className={styles.iceCupLayers}>
          {input.map((k, i) => {
            const info = INGREDIENTS[k];
            const isChocolate = k === "dark_chocolate";
            return (
              <div
                key={i}
                className={
                  isChocolate
                    ? `${styles.layer} ${styles.chocolateLayer}`
                    : styles.layer
                }
                style={{ ["--layer-color" as string]: info.color }}
                title={info.label}
              >
                {isChocolate ? (
                  <span className={styles.chocolateEmoji}>{info.emoji}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.iceCupCap} aria-hidden />
      <div className={styles.iceCupStraw} aria-hidden />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 하위 컴포넌트 : 레시피북 (책 표지 + 좌우 페이지 + flip + 태그)
 * ─────────────────────────────────────────────────────────────────── */

function RecipeBook({
  pageIdx,
  prevIdx,
  flipping,
  flipDir,
  onGoToPage,
}: {
  pageIdx:    number;
  prevIdx:    number | null;
  flipping:   boolean;
  flipDir:    FlipDir;
  onGoToPage: (target: number) => void;
}) {
  const currentDrink = DRINKS[DRINK_LIST[pageIdx]];
  const prevDrink    = prevIdx != null ? DRINKS[DRINK_LIST[prevIdx]] : null;

  return (
    <div className={styles.bookOuter}>
      {/* 책 본체 */}
      <div className={styles.bookWrapper}>
        {/* 표지 (짙은 갈색 가죽, 사방으로 살짝 삐져나옴) */}
        <div className={styles.bookCover} aria-hidden>
          <div className={styles.bookCoverBorder} />
        </div>

        {/* 페이지 스프레드 */}
        <div className={styles.pagesContainer}>
          <div className={styles.pageSpread}>
            {/* 좌측 페이지 : 메뉴 이미지 슬롯 */}
            <div className={styles.pageLeft}>
              <MenuImagePage drink={currentDrink} />
            </div>

            {/* 책 중앙 접힘선 */}
            <div className={styles.spineShadow} aria-hidden />

            {/* 우측 페이지 : 레시피 상세 */}
            <div className={styles.pageRight}>
              <RecipeDetailPage drink={currentDrink} />
            </div>

            {/* Flipper 오버레이 (넘어가는 종이 한 장)
              *
              * next 방향 : flipper 는 우측 자리에서 시작 → 좌로 회전.
              *             앞면 = 이전 우측 페이지 (레시피)
              *             뒷면 = 새   좌측 페이지 (메뉴 이미지)
              *
              * prev 방향 : flipper 는 좌측 자리에서 시작 → 우로 회전.
              *             앞면 = 이전 좌측 페이지 (메뉴 이미지)
              *             뒷면 = 새   우측 페이지 (레시피)
              */}
            {flipping && prevDrink ? (
              flipDir === "next" ? (
                <div className={`${styles.flipper} ${styles.flipperNext}`} aria-hidden>
                  <div className={styles.flipperFace}>
                    <RecipeDetailPage drink={prevDrink} />
                  </div>
                  <div className={`${styles.flipperFace} ${styles.flipperBack}`}>
                    <MenuImagePage drink={currentDrink} />
                  </div>
                </div>
              ) : (
                <div className={`${styles.flipper} ${styles.flipperPrev}`} aria-hidden>
                  <div className={styles.flipperFace}>
                    <MenuImagePage drink={prevDrink} />
                  </div>
                  <div className={`${styles.flipperFace} ${styles.flipperBack}`}>
                    <RecipeDetailPage drink={currentDrink} />
                  </div>
                </div>
              )
            ) : null}
          </div>
        </div>

        {/* 하단 페이지 인디케이터 + 이전/다음 화살표 */}
        <div className={styles.pageNav}>
          <button
            className={styles.navArrow}
            onClick={() => onGoToPage(pageIdx - 1)}
            disabled={pageIdx <= 0 || flipping}
            aria-label="이전 페이지"
          >
            ◀
          </button>
          <span className={styles.pageCount}>
            {pageIdx + 1} / {DRINK_LIST.length}
          </span>
          <button
            className={styles.navArrow}
            onClick={() => onGoToPage(pageIdx + 1)}
            disabled={pageIdx >= DRINK_LIST.length - 1 || flipping}
            aria-label="다음 페이지"
          >
            ▶
          </button>
        </div>
      </div>

      {/* 오른쪽 옆 북마크 탭 (8개 세로 나열) */}
      <div className={styles.tabColumn}>
        {DRINK_LIST.map((k, i) => (
          <button
            key={k}
            className={
              i === pageIdx
                ? `${styles.tab} ${styles.tabActive}`
                : styles.tab
            }
            onClick={() => onGoToPage(i)}
            disabled={flipping}
            title={DRINKS[k].label}
          >
            {DRINKS[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* 좌측 페이지 : 메뉴 이미지 슬롯 (지금은 placeholder, 이후 <img> 교체)
 *
 * DRINKS 데이터에 image 필드가 없어서 아직 이미지가 없음.
 * 리소스 준비되면 mixData.ts 에 image?: string 추가하고 여기서
 *   drink.image ? <img src={drink.image} /> : <placeholder />
 * 로 분기 가능.
 */
function MenuImagePage({ drink }: { drink: typeof DRINKS[DrinkKey] }) {
  return (
    <div className={styles.menuPage}>
      <div className={styles.menuTitle}>{drink.label}</div>
      <div className={styles.menuImageSlot}>
        <div className={styles.menuImagePlaceholder}>
          메뉴 이미지<br/>(준비 중)
        </div>
      </div>
      <div className={styles.menuLayerCount}>{drink.recipe.length}층</div>
    </div>
  );
}

/* 우측 페이지 : 레시피 상세 */
function RecipeDetailPage({ drink }: { drink: typeof DRINKS[DrinkKey] }) {
  return (
    <div className={styles.recipePage}>
      <div className={styles.pageHead}>레시피</div>
      <div className={styles.recipeText}>{recipeToText(drink.recipe)}</div>
      <ol className={styles.recipeSteps}>
        {drink.recipe.map((k, i) => {
          const info = INGREDIENTS[k];
          return (
            <li key={i} className={styles.recipeStep}>
              <span className={styles.recipeStepNum}>{i + 1}.</span>
              <span
                className={styles.recipeSwatch}
                style={{ background: info.color }}
              />
              {info.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 하위 컴포넌트 : 재료 자판 (10종, 5×2)
 * ─────────────────────────────────────────────────────────────────── */

function IngredientKeypad({
  onClick,
}: {
  onClick: (k: IngredientKey) => void;
}) {
  return (
    <div className={styles.keypad}>
      {INGREDIENT_LIST.map((k) => {
        const info = INGREDIENTS[k];
        return (
          <button
            key={k}
            className={styles.keypadBtn}
            onClick={() => onClick(k)}
            title={info.label}
          >
            {info.emoji ? (
              <span className={styles.keypadEmoji}>{info.emoji}</span>
            ) : (
              <span
                className={styles.keypadSwatch}
                style={{ background: info.color }}
              />
            )}
            <span className={styles.keypadLabel}>{info.label}</span>
          </button>
        );
      })}
    </div>
  );
}