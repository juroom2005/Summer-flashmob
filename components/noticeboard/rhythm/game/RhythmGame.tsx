// components/noticeboard/rhythm/game/RhythmGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 리듬게임 본체 (세션 M 신설) — 태고의 달인 레퍼런스 가로형
// ═══════════════════════════════════════════════════════════════════
//
// 화면 흐름 (phase 상태머신) :
//   select    : 스탯 선택 (리듬감 / 표현력)
//   loading   : 음원 fetch · decode (엔진 load)
//   ready     : 로드 완료, "시작" 버튼 (유저 제스처 대기 · iOS unlock)
//   countin   : 카운트인 (노트 흐르기 시작, 오디오는 아직)
//   playing   : 재생 · 판정
//   submitting: 서버 제출 중
//   done      : 결과 팝업
//   failed    : 음원 로드 실패
//
// 판정 정확도 :
//   · 노트 위치 · MISS 판정은 rAF 루프 (getSongTime, 렌더용)
//   · 입력 판정은 이벤트 시각(event.timeStamp) → eventToSongTime 변환
//     후 findHitNote (AudioContext 시간축 비교)
//   · 즉 "그리기" 와 "맞히기" 를 다른 시간 소스로 분리 (v13 §6-7 정신)
//
// 입력 :
//   · 스페이스바 (keydown, 데스크탑)
//   · 화면 어디든 탭/클릭 (pointerdown, 모바일)
//   · 좌우 구분 없음 (1종 노트)
//
// 캐릭터 :
//   · 판정선 하단 이모지 스프라이트 (placeholder). 판정 시 점프 애니.
//   · 이미지 교체 시 CSS background 방식으로 마이그레이션 가능하게 클래스 분리.
//
// 안정성 :
//   · submitLock · 언마운트 시 엔진 dispose · rAF cancel · 이벤트 해제
//   · setState updater 콜백 명시 타입 (v13 §6-1)
//   · Pointer / keydown 예외는 무해 처리
//
// 톤 : tokens.css 변수 기반. 향후 리뉴얼 시 tokens 만 갱신.
// ═══════════════════════════════════════════════════════════════════

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./RhythmGame.module.css";
import RhythmRewardPopup, {
  type RhythmJudgeSummary,
} from "../RhythmRewardPopup";
import {
  playRhythmMinigame,
  type RhythmPlayResult,
  type RhythmSelectedStat,
} from "@/lib/minigame-helpers";
import { RhythmEngine } from "@/lib/rhythm-engine";
import {
  getDefaultSong,
  buildInitialNoteStates,
  findHitNote,
  findMissedNotes,
  calculateScore,
  type NoteState,
  type Judgement,
  NOTE_TRAVEL_SEC,
  COUNT_IN_SEC,
  TAIL_SEC,
} from "./rhythmData";

type Phase =
  | "select"
  | "loading"
  | "ready"
  | "countin"
  | "playing"
  | "submitting"
  | "done"
  | "failed";

type Props = {
  onExit:   () => void;
  onPlayed: () => void;
};

// 판정선의 화면 내 가로 위치 (%). 좌측.
const HIT_LINE_X_PCT = 16;
// 노트가 등장하는 오른쪽 끝 (%).
const SPAWN_X_PCT = 104;

// 최근 판정 표시 지속 (ms)
const JUDGE_FLASH_MS = 420;

export default function RhythmGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase] = useState<Phase>("select");
  const [selectedStat, setSelectedStat] =
    useState<RhythmSelectedStat | null>(null);

  // 렌더용 노트 위치 (매 프레임 갱신). x = 화면 % 좌표.
  const [noteViews, setNoteViews] = useState<
    { index: number; xPct: number; judged: boolean }[]
  >([]);

  // 최근 판정 (화면 중앙 플래시)
  const [lastJudge, setLastJudge] = useState<Judgement | null>(null);
  const [combo, setCombo] = useState(0);
  const [charJump, setCharJump] = useState(false);

  // 채점 결과
  const [finalScore, setFinalScore] = useState(0);
  const [judgeSummary, setJudgeSummary] = useState<RhythmJudgeSummary>({
    perfect: 0,
    good: 0,
    miss: 0,
    maxCombo: 0,
  });
  const [result, setResult] = useState<RhythmPlayResult | null>(null);

  // ── refs (판정 · 루프 · 정리) ──────────────────
  const engineRef = useRef<RhythmEngine | null>(null);
  const notesRef = useRef<NoteState[]>([]);      // 판정 소스 (mutable)
  const rafRef = useRef<number | null>(null);
  const submitLock = useRef(false);
  const comboRef = useRef(0);
  const judgeFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const charJumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);

  const song = getDefaultSong();

  // ── 채보 검증 디버그 모드 ────────────────────────
  //   true 면 : (1) 노트 시각마다 틱 소리, (2) 현재 곡 시각(초) 실시간 표시.
  //   채보를 다 맞춘 뒤 false 로 되돌리거나 이 블록을 제거한다.
  //   URL 에 ?rhythmDebug=1 이 있어도 켜짐 (코드 수정 없이 토글).
  const DEBUG_CHART = false;
  const debugOn =
    DEBUG_CHART ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("rhythmDebug") === "1");
  const [debugSongTime, setDebugSongTime] = useState(0);

  /* ═══════════════════════════════════════════════
   * 정리 유틸
   * ─────────────────────────────────────────────── */

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const disposeEngine = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
  }, []);

  // 언마운트 전체 정리
  useEffect(() => {
    return () => {
      stopRaf();
      disposeEngine();
      if (judgeFlashTimer.current) clearTimeout(judgeFlashTimer.current);
      if (charJumpTimer.current) clearTimeout(charJumpTimer.current);
    };
  }, [stopRaf, disposeEngine]);

  /* ═══════════════════════════════════════════════
   * 스탯 선택 → 로딩
   * ─────────────────────────────────────────────── */

  const handleSelectStat = useCallback(
    async (stat: RhythmSelectedStat) => {
      setSelectedStat(stat);
      setPhase("loading");

      // 엔진 준비 · 음원 로드
      disposeEngine();
      const engine = new RhythmEngine();
      engineRef.current = engine;

      await engine.load(song.audioUrl, song.durationSec);

      if (engine.status === "error") {
        setPhase("failed");
        return;
      }
      setPhase("ready");
    },
    [song.audioUrl, song.durationSec, disposeEngine]
  );

  /* ═══════════════════════════════════════════════
   * 시작 (유저 제스처 · iOS unlock)
   * ─────────────────────────────────────────────── */

  const handleStart = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || engine.status !== "ready") return;

    // 노트 판정 소스 초기화
    notesRef.current = buildInitialNoteStates(song);
    setNoteViews(
      notesRef.current.map((n: NoteState) => ({
        index: n.index,
        xPct: SPAWN_X_PCT,
        judged: false,
      }))
    );
    setCombo(0);
    comboRef.current = 0;
    setLastJudge(null);
    setResult(null);
    submitLock.current = false;
    finishedRef.current = false;

    setPhase("countin");

    // 디버그 : 노트 시각마다 틱 소리 (채보 검증). start 전에 설정.
    if (debugOn) {
      engine.setDebugTicks(song.notes.map((n) => n.time));
    }

    // 카운트인 후 오디오 시작 (엔진 내부에서 countIn 만큼 지연 재생)
    await engine.start(COUNT_IN_SEC);

    setPhase("playing");
    startLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, debugOn]);

  /* ═══════════════════════════════════════════════
   * rAF 루프 : 노트 위치 갱신 · MISS 판정 · 종료 감지
   *
   * 노트 x 좌표 계산 :
   *   노트는 songTime = note.time 에 판정선(HIT_LINE_X_PCT) 도달.
   *   NOTE_TRAVEL_SEC 전에 SPAWN_X_PCT 에서 출발.
   *   진행률 p = (songTime - (note.time - TRAVEL)) / TRAVEL   (0→1)
   *   xPct = SPAWN + (HIT_LINE - SPAWN) × p
   *   → songTime 이 note.time - TRAVEL 이전이면 화면 밖(오른쪽), 이후 왼쪽 이동.
   * ─────────────────────────────────────────────── */

  const startLoop = useCallback(() => {
    stopRaf();

    const loop = () => {
      const engine = engineRef.current;
      if (!engine) return;

      const songTime = engine.getSongTime();

      // ── MISS 판정 (판정선 지나침) ──────────────
      const missed = findMissedNotes(notesRef.current, songTime);
      if (missed.length > 0) {
        for (const idx of missed) {
          const n = notesRef.current[idx];
          if (n && !n.judged) {
            n.judged = true;
            n.judgement = "miss";
          }
        }
        // 콤보 끊김
        comboRef.current = 0;
        setCombo(0);
        flashJudge("miss");
      }

      // ── 노트 렌더 위치 계산 ────────────────────
      const views = notesRef.current.map((n: NoteState) => {
        const appearAt = n.time - NOTE_TRAVEL_SEC;
        const p = (songTime - appearAt) / NOTE_TRAVEL_SEC; // 0→1
        const xPct = SPAWN_X_PCT + (HIT_LINE_X_PCT - SPAWN_X_PCT) * p;
        return { index: n.index, xPct, judged: n.judged };
      });
      setNoteViews(views);

      // 디버그 : 현재 곡 시각 표시 갱신
      if (debugOn) {
        setDebugSongTime(songTime);
      }

      // ── 종료 감지 ──────────────────────────────
      // 곡 길이 + 여유 지나면 채점.
      if (
        !finishedRef.current &&
        songTime >= song.durationSec + TAIL_SEC
      ) {
        finishedRef.current = true;
        finalizeAndSubmit();
        return; // 루프 종료
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.durationSec, stopRaf, debugOn]);

  /* ═══════════════════════════════════════════════
   * 판정 플래시 · 캐릭터 점프
   * ─────────────────────────────────────────────── */

  const flashJudge = useCallback((j: Judgement) => {
    setLastJudge(j);
    if (judgeFlashTimer.current) clearTimeout(judgeFlashTimer.current);
    judgeFlashTimer.current = setTimeout(() => setLastJudge(null), JUDGE_FLASH_MS);
  }, []);

  const triggerCharJump = useCallback(() => {
    setCharJump(true);
    if (charJumpTimer.current) clearTimeout(charJumpTimer.current);
    charJumpTimer.current = setTimeout(() => setCharJump(false), 260);
  }, []);

  /* ═══════════════════════════════════════════════
   * 입력 판정 (이벤트 시각 기준)
   * ─────────────────────────────────────────────── */

  const handleHit = useCallback(
    (eventTimeStampMs: number) => {
      if (phase !== "playing") return;
      const engine = engineRef.current;
      if (!engine) return;

      const songTime = engine.eventToSongTime(eventTimeStampMs);
      const hit = findHitNote(notesRef.current, songTime);

      // 캐릭터는 입력마다 점프 (헛침도 반응, 태고 감각)
      triggerCharJump();

      if (!hit) {
        // 헛침 : 콤보 유지 (MISS 아님, 노트 없는 타이밍). 태고도 헛침은 무벌점.
        return;
      }

      const n = notesRef.current[hit.index];
      if (!n || n.judged) return;
      n.judged = true;
      n.judgement = hit.judgement;

      if (hit.judgement === "miss") {
        comboRef.current = 0;
        setCombo(0);
      } else {
        comboRef.current += 1;
        setCombo(comboRef.current);
      }
      flashJudge(hit.judgement);
    },
    [phase, flashJudge, triggerCharJump]
  );

  // 키보드 입력 (스페이스)
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        handleHit(e.timeStamp);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, handleHit]);

  // 화면 탭/클릭 입력
  const handleStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    handleHit(e.timeStamp);
  };

  /* ═══════════════════════════════════════════════
   * 채점 · 제출
   * ─────────────────────────────────────────────── */

  const finalizeAndSubmit = useCallback(async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    stopRaf();

    const score = calculateScore(notesRef.current);
    setFinalScore(score.finalScore);
    setJudgeSummary({
      perfect:  score.perfectCount,
      good:     score.goodCount,
      miss:     score.missCount,
      maxCombo: score.maxCombo,
    });

    setPhase("submitting");
    setResult(null);

    const stat: RhythmSelectedStat = selectedStat ?? "rhythm";
    const detail = {
      perfect_count: score.perfectCount,
      good_count:    score.goodCount,
      miss_count:    score.missCount,
      max_combo:     score.maxCombo,
      raw_score:     score.rawScore,
      note_count:    notesRef.current.length,
      song_id:       song.id,
    };

    const res = await playRhythmMinigame("rhythm", score.finalScore, stat, detail);
    setResult(res);
    setPhase("done");
    onPlayed();
    // 오디오 정리 (곡은 이미 끝났지만 명시적 해제)
    disposeEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStat, song.id, stopRaf, onPlayed, disposeEngine]);

  /* ═══════════════════════════════════════════════
   * 다시 하기 / 결과 닫기
   * ─────────────────────────────────────────────── */

  const canRetry = result?.ok === true ? result.playsRemaining > 0 : false;

  const handleRetry = useCallback(() => {
    if (!canRetry) return;
    // 스탯 선택부터 다시 (스탯 재선택 허용)
    stopRaf();
    disposeEngine();
    setResult(null);
    setPhase("select");
    setSelectedStat(null);
    setNoteViews([]);
    setCombo(0);
    comboRef.current = 0;
  }, [canRetry, stopRaf, disposeEngine]);

  /* ═══════════════════════════════════════════════
   * 렌더
   * ─────────────────────────────────────────────── */

  // 판정 플래시 텍스트 · 클래스
  const judgeText =
    lastJudge === "perfect"
      ? "PERFECT"
      : lastJudge === "good"
      ? "GOOD"
      : lastJudge === "miss"
      ? "MISS"
      : "";
  const judgeClass =
    lastJudge === "perfect"
      ? styles.flashPerfect
      : lastJudge === "good"
      ? styles.flashGood
      : lastJudge === "miss"
      ? styles.flashMiss
      : "";

  return (
    <div className={styles.wrap}>
      {/* ── 스탯 선택 ───────────────────────────── */}
      {phase === "select" ? (
        <div className={styles.selectView}>
          <h3 className={styles.selectTitle}>성장시킬 스탯을 선택하세요</h3>
          <p className={styles.selectDesc}>
            리듬 연습은 모빌을 주지 않는 대신, 선택한 스탯을 크게 성장시킵니다.
          </p>
          <div className={styles.statGrid}>
            <button
              className={`${styles.statCard} ${styles.statRhythm}`}
              onClick={() => handleSelectStat("rhythm")}
            >
              <span className={styles.statEmoji}>🎵</span>
              <span className={styles.statName}>리듬감</span>
              <span className={styles.statHint}>박자를 다루는 감각</span>
            </button>
            <button
              className={`${styles.statCard} ${styles.statExpression}`}
              onClick={() => handleSelectStat("expression")}
            >
              <span className={styles.statEmoji}>💃</span>
              <span className={styles.statName}>표현력</span>
              <span className={styles.statHint}>무대를 채우는 힘</span>
            </button>
          </div>
          <button className={styles.exitLink} onClick={onExit}>
            ← 나가기
          </button>
        </div>
      ) : null}

      {/* ── 로딩 ────────────────────────────────── */}
      {phase === "loading" ? (
        <div className={styles.centerView}>
          <div className={styles.spinner} />
          <span className={styles.centerText}>음원을 준비하고 있습니다…</span>
        </div>
      ) : null}

      {/* ── 로드 실패 ───────────────────────────── */}
      {phase === "failed" ? (
        <div className={styles.centerView}>
          <span className={styles.failEmoji}>⚠️</span>
          <span className={styles.centerText}>
            음원을 불러오지 못했습니다. 잠시 후 다시 시도해 주십시오.
          </span>
          <button className={styles.primaryBtn} onClick={onExit}>
            돌아가기
          </button>
        </div>
      ) : null}

      {/* ── 시작 대기 (유저 제스처) ─────────────── */}
      {phase === "ready" ? (
        <div className={styles.centerView}>
          <span className={styles.readyEmoji}>🥁</span>
          <span className={styles.centerText}>
            노트가 판정선에 닿는 순간 스페이스바 또는 화면을 탭하세요.
          </span>
          <button className={styles.primaryBtn} onClick={handleStart}>
            시작하기
          </button>
        </div>
      ) : null}

      {/* ── 플레이 · 카운트인 (동일 무대) ───────── */}
      {phase === "countin" || phase === "playing" || phase === "submitting" ? (
        <div
          className={styles.stage}
          onPointerDown={handleStagePointerDown}
        >
          {/* HUD */}
          <div className={styles.hud}>
            <span className={styles.comboBadge}>
              {combo > 0 ? `${combo} COMBO` : "\u00A0"}
            </span>
            <span className={styles.statBadge}>
              {selectedStat === "expression" ? "표현력" : "리듬감"} 성장 중
            </span>
          </div>

          {/* 레인 */}
          <div className={styles.lane}>
            {/* 판정선 */}
            <div
              className={styles.hitLine}
              style={{ left: `${HIT_LINE_X_PCT}%` }}
            />
            {/* 판정선 링 (히트 존 강조) */}
            <div
              className={styles.hitRing}
              style={{ left: `${HIT_LINE_X_PCT}%` }}
            />

            {/* 노트 */}
            {noteViews.map((nv) =>
              nv.judged || nv.xPct < -6 || nv.xPct > 110 ? null : (
                <div
                  key={nv.index}
                  className={styles.note}
                  style={{ left: `${nv.xPct}%` }}
                />
              )
            )}

            {/* 판정 플래시 */}
            {judgeText ? (
              <div
                className={`${styles.judgeFlash} ${judgeClass}`}
                style={{ left: `${HIT_LINE_X_PCT}%` }}
              >
                {judgeText}
              </div>
            ) : null}

            {/* 캐릭터 (판정선 하단, 점프) */}
            <div
              className={`${styles.character} ${charJump ? styles.charJump : ""}`}
              style={{ left: `${HIT_LINE_X_PCT}%` }}
            >
              🕺
            </div>
          </div>

          {/* 카운트인 오버레이 */}
          {phase === "countin" ? (
            <div className={styles.countinOverlay}>
              <span className={styles.countinText}>준비…</span>
            </div>
          ) : null}

          {/* 탭 안내 (모바일) */}
          <div className={styles.tapHint}>스페이스바 · 화면 탭</div>

          {/* 디버그 : 현재 곡 시각 (채보 검증) */}
          {debugOn ? (
            <div className={styles.debugClock}>
              ▶ {debugSongTime >= 0 ? debugSongTime.toFixed(2) : "0.00"}s
              <span className={styles.debugHint}> · 틱 소리로 채보 확인 중</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── 결과 팝업 ───────────────────────────── */}
      {phase === "done" || phase === "submitting" ? (
        <RhythmRewardPopup
          result={phase === "submitting" ? null : result}
          score={finalScore}
          summary={judgeSummary}
          onClose={onExit}
          onRetry={handleRetry}
          canRetry={canRetry}
        />
      ) : null}
    </div>
  );
}