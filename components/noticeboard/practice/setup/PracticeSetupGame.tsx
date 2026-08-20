// components/noticeboard/practice/setup/PracticeSetupGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습실 장비 세팅 (practice_setup) — 사운드 웨이브 매칭
// ═══════════════════════════════════════════════════════════════════
//
// 화면 구성 :
//   상단 : HUD (타이머 · 진행률)
//   중단 : 웨이브 스코프 SVG
//          - 목표 웨이브 (회색, 고정) + 유저 웨이브 (파랑, 실시간)
//          - fader 값 변화 → 유저 웨이브 즉시 갱신 → 시각 피드백
//   하단 : 세로 fader 3~5개 (콘솔 감각)
//          - 각 fader = 웨이브 파라미터 하나 담당
//          - 위(y=0)가 100, 아래(y=full)가 0 (아날로그 콘솔 관습)
//          - 오차 ≤ 3 자동 잠금 · 잠긴 fader 재조정 불가
//
// 조작 :
//   · pointerdown : Pointer Capture 로 트랙 위임 · y → 값 변환 · updateFader
//   · pointermove : y → 값 재계산 · updateFader
//   · pointerup   : releasePointerCapture · 드래그 종료
//
// 안정성 :
//   · submitLock · 언마운트 정리 · setState 부작용 규칙 준수
//   · SVG path 는 useMemo 로 값 변경 시에만 재계산
//   · 잠긴 fader 는 CSS pointer-events: none + updateFader 안 이중 차단
//
// 톤 :
//   · tokens.css 변수 사용 (var(--color-primary) 등)
//   · 하드코딩 색 최소화 → 향후 전체 프론트 리뉴얼 시 tokens.css 만 갱신하면 반영

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./PracticeSetupGame.module.css";
import PracticeRewardPopup from "../PracticeRewardPopup";
import {
  playPracticeMinigame,
  type PracticePlayResult,
} from "@/lib/minigame-helpers";
import {
  generateFaders,
  updateFader,
  faderToWaveParams,
  wavePath,
  calculateFinalScore,
  isAllPerfect,
  FADER_LABEL,
  TIME_LIMIT_SEC,
  type Fader,
} from "./setupData";

type Phase = "intro" | "playing" | "submitting" | "done";

type Props = {
  onExit:   () => void;
  onPlayed: () => void;
};

// SVG viewBox (반응형은 CSS 로 스케일)
const WAVE_WIDTH  = 400;
const WAVE_HEIGHT = 120;

export default function PracticeSetupGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase]                 = useState<Phase>("intro");
  const [faders, setFaders]               = useState<Fader[]>([]);
  const [remainingSec, setRemainingSec]   = useState(TIME_LIMIT_SEC);
  const [finalScore, setFinalScore]       = useState(0);
  const [result, setResult]               = useState<PracticePlayResult | null>(null);
  const [activeFaderId, setActiveFaderId] = useState<string | null>(null);

  const submitLock = useRef(false);
  const gameTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ═══════════════════════════════════════════════
   * 타이머
   * ─────────────────────────────────────────────── */

  const clearGameTimer = useCallback(() => {
    if (gameTimer.current) {
      clearInterval(gameTimer.current);
      gameTimer.current = null;
    }
  }, []);

  /* ═══════════════════════════════════════════════
   * 시작
   * ─────────────────────────────────────────────── */

  const startGame = useCallback(() => {
    const fresh = generateFaders();
    setFaders(fresh);
    setRemainingSec(TIME_LIMIT_SEC);
    setFinalScore(0);
    setResult(null);
    setActiveFaderId(null);
    submitLock.current = false;
    setPhase("playing");

    clearGameTimer();
    gameTimer.current = setInterval(() => {
      setRemainingSec((prev: number) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  }, [clearGameTimer]);

  /* ═══════════════════════════════════════════════
   * 완주 → 채점 → 제출
   * ─────────────────────────────────────────────── */

  const finalizeAndSubmit = useCallback(async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    clearGameTimer();
    setActiveFaderId(null);

    const score = calculateFinalScore(faders, remainingSec);

    setFinalScore(score.finalScore);
    setPhase("submitting");
    setResult(null);

    const detail = {
      total_count:    score.totalCount,
      perfect_count:  score.perfectCount,
      avg_error:      score.avgError,
      accuracy_score: score.accuracyScore,
      time_bonus:     score.timeBonus,
      remaining_sec:  remainingSec,
      time_out:       remainingSec === 0,
      user_finished:  remainingSec > 0,   // 유저가 완료 버튼 눌러 마무리
    };

    const res = await playPracticeMinigame("practice_setup", score.finalScore, detail);
    setResult(res);
    setPhase("done");
    onPlayed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faders, remainingSec, onPlayed, clearGameTimer]);

  useEffect(() => {
    if (phase === "playing" && remainingSec === 0) finalizeAndSubmit();
  }, [phase, remainingSec, finalizeAndSubmit]);

  // 자동 조기 종료 제거 : 잠금 개념 없어짐. 유저가 "완료" 버튼 눌러야 채점.

  useEffect(() => {
    return () => {
      clearGameTimer();
    };
  }, [clearGameTimer]);

  const canRetry = result?.ok === true ? result.playsRemaining > 0 : false;
  const handleRetry = () => {
    if (canRetry) startGame();
  };

  /* ═══════════════════════════════════════════════
   * 세로 fader 드래그 처리
   *
   * 위(y=0) = 값 100, 아래(y=track height) = 값 0
   * ─────────────────────────────────────────────── */

  const clientYToValue = (trackEl: HTMLElement, clientY: number): number => {
    const rect = trackEl.getBoundingClientRect();
    if (rect.height === 0) return 0;
    const rel = (clientY - rect.top) / rect.height;
    return Math.max(0, Math.min(100, Math.round((1 - rel) * 100)));
  };

  const handleTrackPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    faderId: string,
  ) => {
    if (phase !== "playing") return;
    // 잠금 개념 없음 : 항상 조정 가능
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Safari 방어
    }
    const value = clientYToValue(e.currentTarget, e.clientY);
    setActiveFaderId(faderId);
    setFaders((prev: Fader[]) => updateFader(prev, faderId, value));
  };

  const handleTrackPointerMove = (
    e: ReactPointerEvent<HTMLDivElement>,
    faderId: string,
  ) => {
    if (phase !== "playing") return;
    if (activeFaderId !== faderId) return;
    const value = clientYToValue(e.currentTarget, e.clientY);
    setFaders((prev: Fader[]) => updateFader(prev, faderId, value));
  };

  const handleTrackPointerUp = (
    e: ReactPointerEvent<HTMLDivElement>,
    faderId: string,
  ) => {
    if (activeFaderId !== faderId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 방어
    }
    setActiveFaderId(null);
  };

  const handleTrackPointerCancel = (
    e: ReactPointerEvent<HTMLDivElement>,
    faderId: string,
  ) => {
    if (activeFaderId !== faderId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 방어
    }
    setActiveFaderId(null);
  };

  /* ═══════════════════════════════════════════════
   * 웨이브 path 계산 (memo, 값 변경 시에만 재계산)
   * ─────────────────────────────────────────────── */

  const targetPath = useMemo(() => {
    if (faders.length === 0) return "";
    const targetParams = faderToWaveParams(faders, true);
    return wavePath(targetParams, WAVE_WIDTH, WAVE_HEIGHT);
  }, [faders]);

  const currentPath = useMemo(() => {
    if (faders.length === 0) return "";
    const currentParams = faderToWaveParams(faders, false);
    return wavePath(currentParams, WAVE_WIDTH, WAVE_HEIGHT);
  }, [faders]);

  const allPerfect = faders.length > 0 && isAllPerfect(faders);

  /* ═══════════════════════════════════════════════
   * intro
   * ─────────────────────────────────────────────── */

  if (phase === "intro") {
    return (
      <div className={styles.wrap}>
        <div className={styles.intro}>
          <div className={styles.introTitle}>사운드 웨이브 매칭</div>
          <p className={styles.introBody}>
            아래 노브 4개를 조정해 유저 웨이브 (밝은 파랑) 를 목표 웨이브
            (희미한 흰선) 에 겹치도록 맞춰 주세요. 정확히 맞으면 웨이브가
            녹색으로 바뀝니다. 준비되면 "완료" 를 눌러 채점하며, 40초가 지나면
            자동 채점됩니다.
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

  const totalCount   = faders.length;
  const perfectCount = faders.filter((f: Fader) => Math.abs(f.target - f.current) <= 2).length;
  const progressPct  = totalCount === 0 ? 0 : (perfectCount / totalCount) * 100;
  const lowTime      = remainingSec <= 8;
  const midTime      = remainingSec <= 20 && !lowTime;
  const timerClass   =
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
              완벽 매칭 {perfectCount} / {totalCount}
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* 웨이브 스코프 */}
        <div className={styles.scope}>
          <svg
            className={styles.scopeSvg}
            viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* 가이드선 제거 (별 3 · 힌트 최소화) */}

            {/* 목표 웨이브 (회색, 고정) */}
            <path
              d={targetPath}
              className={styles.waveTarget}
              fill="none"
            />

            {/* 유저 웨이브 (파랑, 실시간) */}
            <path
              d={currentPath}
              className={
                allPerfect
                  ? `${styles.waveCurrent} ${styles.waveMatched}`
                  : styles.waveCurrent
              }
              fill="none"
            />
          </svg>

          {allPerfect ? (
            <div className={styles.matchBadge}>웨이브 일치</div>
          ) : null}
        </div>

        {/* Fader 그리드 */}
        <div className={styles.faderRow}>
          {faders.map((fader: Fader) => {
            // 잠금 개념 없음 : 항상 조정 가능 · 상태 표시 없음
            const knobTopPct = 100 - fader.current;

            return (
              <div key={fader.id} className={styles.faderCol}>
                <div className={styles.faderReadout}>
                  <span className={styles.readoutCurrent}>{fader.current}</span>
                </div>

                <div
                  className={styles.faderTrack}
                  style={{ touchAction: "none" }}
                  onPointerDown={(e) => handleTrackPointerDown(e, fader.id)}
                  onPointerMove={(e) => handleTrackPointerMove(e, fader.id)}
                  onPointerUp={(e) => handleTrackPointerUp(e, fader.id)}
                  onPointerCancel={(e) => handleTrackPointerCancel(e, fader.id)}
                >
                  {/* 채워진 부분 (아래에서 knob 까지) */}
                  <div
                    className={styles.fillFromBottom}
                    style={{ height: `${fader.current}%` }}
                    aria-hidden
                  />
                  {/* 노브 */}
                  <div
                    className={styles.knob}
                    style={{ top: `${knobTopPct}%` }}
                    aria-hidden
                  />
                </div>

                <div className={styles.faderLabel}>
                  {FADER_LABEL[fader.key]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.actionRow}>
        <button className={styles.ghostBtn} onClick={onExit}>
          그만두기
        </button>
        <button
          className={styles.primaryBtn}
          onClick={finalizeAndSubmit}
          disabled={submitLock.current}
        >
          완료
        </button>
      </div>

      {phase === "submitting" || phase === "done" ? (
        <PracticeRewardPopup
          result={result}
          score={finalScore}
          gameName="장비 세팅"
          onClose={onExit}
          onRetry={handleRetry}
          canRetry={canRetry}
        />
      ) : null}
    </div>
  );
}