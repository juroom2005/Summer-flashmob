// components/noticeboard/rhythm/game/RhythmGame.tsx
// ═══════════════════════════════════════════════════════════════════
// 리듬게임 본체 — 1c 시안 전체 화면 이식판 (사용자 수정 색상)
// ═══════════════════════════════════════════════════════════════════
//
// 로직(엔진 · 판정 · 채점 · 제출 · phase 상태머신)은 기존과 100% 동일.
// 렌더(return)만 1c 시안 레이아웃으로 교체:
//   좌  : 곡 정보 패널 + MP3 플레이어(장식, 재생/정지 토글)
//   우상: 성장 스탯 pill + COMBO / 노트 레인(판정선·링·노트·플래시)
//   우중: 아이콘 레일 + 캐릭터 스프라이트(판정 시 점프)
//   우하: 트랜스포트 + 파형
// select / loading / ready / failed / countin 은 셸 위 오버레이로 표시.
// ═══════════════════════════════════════════════════════════════════

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
import { getMySpriteUrl } from "@/lib/auth-helpers";

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
  onExit: () => void;
  onPlayed: () => void;
};

// 판정선의 화면 내 가로 위치 (%). 좌측.
const HIT_LINE_X_PCT = 15;
// 노트가 등장하는 오른쪽 끝 (%).
const SPAWN_X_PCT = 104;
// 최근 판정 표시 지속 (ms)
const JUDGE_FLASH_MS = 420;

// 음원(song_1.mp3) 0~36초 진폭 포락선. 0.2초 간격 180프레임, 0~1 정규화.
//   MP3 화면 EQ 막대가 현재 재생 위치의 진폭 창을 표시하는 데 사용.
//   곡 교체 시 : 새 음원으로 같은 방식(0~durationSec, 0.2초 RMS) 재추출.
const SONG_ENVELOPE = [
  0.0, 0.0, 0.79, 0.22, 0.22, 0.54, 0.22, 0.22, 0.22, 0.22, 0.65, 0.23, 0.22,
  0.52, 0.05, 0.01, 0.0, 0.0, 0.57, 0.24, 0.22, 0.59, 0.24, 0.22, 0.22, 0.22,
  0.48, 0.23, 0.22, 0.7, 0.25, 0.04, 0.24, 0.0, 0.84, 0.59, 0.62, 0.92, 0.57,
  0.41, 0.78, 0.52, 0.79, 0.49, 0.53, 0.93, 0.45, 0.22, 0.78, 0.41, 0.92, 0.51,
  0.54, 0.88, 0.51, 0.28, 0.75, 0.47, 0.78, 0.5, 0.53, 0.84, 0.43, 0.41, 0.5,
  0.06, 0.96, 0.67, 0.67, 0.96, 0.54, 0.42, 0.82, 0.56, 0.85, 0.53, 0.56, 0.9,
  0.42, 0.26, 0.67, 0.32, 0.89, 0.43, 0.51, 0.86, 0.53, 0.3, 0.78, 0.53, 0.9,
  0.58, 0.54, 0.84, 0.4, 0.38, 0.55, 0.12, 0.85, 0.61, 0.63, 0.77, 0.51, 0.4,
  0.79, 0.53, 0.88, 0.51, 0.6, 0.97, 0.43, 0.21, 0.7, 0.33, 0.86, 0.42, 0.5,
  0.84, 0.51, 0.3, 0.81, 0.56, 0.89, 0.59, 0.55, 0.84, 0.44, 0.41, 0.48, 0.06,
  0.87, 0.64, 0.65, 0.88, 0.53, 0.42, 0.82, 0.6, 0.9, 0.56, 0.61, 0.99, 0.41,
  0.31, 0.74, 0.42, 0.84, 0.61, 0.63, 0.88, 0.61, 0.43, 0.79, 0.58, 0.85, 0.59,
  0.6, 0.93, 0.61, 0.44, 0.61, 0.52, 1.0, 0.66, 0.48, 0.7, 0.5, 0.39, 0.41,
  0.36, 0.69, 0.42, 0.32, 0.7, 0.68, 0.37, 0.57, 0.33, 0.93, 0.6,
];
const ENVELOPE_FRAME_SEC = 0.2;
const EQ_BAR_COUNT = 26;

export default function RhythmGame({ onExit, onPlayed }: Props) {
  const [phase, setPhase] = useState<Phase>("select");
  const [selectedStat, setSelectedStat] =
    useState<RhythmSelectedStat | null>(null);

  const [noteViews, setNoteViews] = useState<
    { index: number; xPct: number; judged: boolean }[]
  >([]);

  const [lastJudge, setLastJudge] = useState<Judgement | null>(null);
  const [combo, setCombo] = useState(0);
  // 캐릭터 점프 : 판정 성공마다 증가하는 카운터. img 의 key 로 써서
  //   매 판정마다 애니메이션을 처음부터 재시작시킨다(연타 시에도 매번 튐).
  //   boolean + 타이머 방식은 이미 true 인 동안 재트리거가 안 먹어(리렌더 없음)
  //   연타가 씹히므로 key 재마운트 방식으로 교체.
  const [jumpTick, setJumpTick] = useState(0);

  // 캐릭터 스프라이트 : 세션 유저(본인)의 profiles.sprite_url.
  //   GM 이 유저관리 탭(SpriteSetPanel)에서 설정한 값을 본인이 읽어 캐릭터로 쓴다.
  //   null(미설정·미로그인·조회실패) → 인라인 배경을 주입하지 않아
  //   CSS .sprite 의 기본 이미지(/rhythm/character.png)로 폴백된다.
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getMySpriteUrl()
      .then((url) => {
        if (alive) setSpriteUrl(url);
      })
      .catch(() => {
        // 조회 실패는 무시 → 기본 이미지 폴백(게임 진행에 영향 없음).
      });
    return () => {
      alive = false;
    };
  }, []);

  // MP3/진행바 애니메이션 : 게임이 실제 재생(playing)일 때만 흐른다.
  //   정지 버튼은 없앴다(일시정지 미지원). 항상 "재생 중" 표시로 고정하고,
  //   진행바·파형·시간은 곡 길이(song.durationSec)에 맞춰 CSS 로 흐른다.
  const isPlaying = phase === "playing";

  const [finalScore, setFinalScore] = useState(0);
  const [judgeSummary, setJudgeSummary] = useState<RhythmJudgeSummary>({
    perfect: 0,
    good: 0,
    miss: 0,
    maxCombo: 0,
  });
  const [result, setResult] = useState<RhythmPlayResult | null>(null);

  const engineRef = useRef<RhythmEngine | null>(null);
  const notesRef = useRef<NoteState[]>([]);
  const rafRef = useRef<number | null>(null);
  const submitLock = useRef(false);
  const comboRef = useRef(0);
  const judgeFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);

  const song = getDefaultSong();

  const DEBUG_CHART = false;
  const debugOn =
    DEBUG_CHART ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("rhythmDebug") === "1");
  const [debugSongTime, setDebugSongTime] = useState(0);

  /* ═══════ 정리 유틸 ═══════ */
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

  useEffect(() => {
    return () => {
      stopRaf();
      disposeEngine();
      if (judgeFlashTimer.current) clearTimeout(judgeFlashTimer.current);
    };
  }, [stopRaf, disposeEngine]);

  /* ═══════ 스탯 선택 → 로딩 ═══════ */
  const handleSelectStat = useCallback(
    async (stat: RhythmSelectedStat) => {
      setSelectedStat(stat);
      setPhase("loading");

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

  /* ═══════ 시작 (유저 제스처) ═══════ */
  const handleStart = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || engine.status !== "ready") return;

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

    if (debugOn) {
      engine.setDebugTicks(song.notes.map((n) => n.time));
    }

    await engine.start(COUNT_IN_SEC);

    setPhase("playing");
    startLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, debugOn]);

  /* ═══════ rAF 루프 ═══════ */
  const startLoop = useCallback(() => {
    stopRaf();

    const loop = () => {
      const engine = engineRef.current;
      if (!engine) return;

      const songTime = engine.getSongTime();

      const missed = findMissedNotes(notesRef.current, songTime);
      if (missed.length > 0) {
        for (const idx of missed) {
          const n = notesRef.current[idx];
          if (n && !n.judged) {
            n.judged = true;
            n.judgement = "miss";
          }
        }
        comboRef.current = 0;
        setCombo(0);
        flashJudge("miss");
      }

      const views = notesRef.current.map((n: NoteState) => {
        const appearAt = n.time - NOTE_TRAVEL_SEC;
        const p = (songTime - appearAt) / NOTE_TRAVEL_SEC;
        const xPct = SPAWN_X_PCT + (HIT_LINE_X_PCT - SPAWN_X_PCT) * p;
        return { index: n.index, xPct, judged: n.judged };
      });
      setNoteViews(views);

      if (debugOn) setDebugSongTime(songTime);

      if (!finishedRef.current && songTime >= song.durationSec + TAIL_SEC) {
        finishedRef.current = true;
        finalizeAndSubmit();
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.durationSec, stopRaf, debugOn]);

  /* ═══════ 판정 플래시 · 캐릭터 점프 ═══════ */
  const flashJudge = useCallback((j: Judgement) => {
    setLastJudge(j);
    if (judgeFlashTimer.current) clearTimeout(judgeFlashTimer.current);
    judgeFlashTimer.current = setTimeout(() => setLastJudge(null), JUDGE_FLASH_MS);
  }, []);

  const triggerCharJump = useCallback(() => {
    // key 를 바꿔 img 를 재마운트 → 애니메이션이 매번 처음부터 재생.
    // 연타(짧은 간격 판정)에도 매번 튄다. 타이머 불필요(애니메이션이 끝나면 정지).
    setJumpTick((n) => n + 1);
  }, []);

  /* ═══════ 입력 판정 ═══════ */
  const handleHit = useCallback(
    (eventTimeStampMs: number) => {
      if (phase !== "playing") return;
      const engine = engineRef.current;
      if (!engine) return;

      const songTime = engine.eventToSongTime(eventTimeStampMs);
      const hit = findHitNote(notesRef.current, songTime);

      triggerCharJump();

      if (!hit) return;

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

  const handleStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    handleHit(e.timeStamp);
  };

  /* ═══════ 채점 · 제출 ═══════ */
  const finalizeAndSubmit = useCallback(async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    stopRaf();

    const score = calculateScore(notesRef.current);
    setFinalScore(score.finalScore);
    setJudgeSummary({
      perfect: score.perfectCount,
      good: score.goodCount,
      miss: score.missCount,
      maxCombo: score.maxCombo,
    });

    setPhase("submitting");
    setResult(null);

    const stat: RhythmSelectedStat = selectedStat ?? "rhythm";
    const detail = {
      perfect_count: score.perfectCount,
      good_count: score.goodCount,
      miss_count: score.missCount,
      max_combo: score.maxCombo,
      raw_score: score.rawScore,
      note_count: notesRef.current.length,
      song_id: song.id,
    };

    const res = await playRhythmMinigame("rhythm", score.finalScore, stat, detail);
    setResult(res);
    setPhase("done");
    onPlayed();
    disposeEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStat, song.id, stopRaf, onPlayed, disposeEngine]);

  /* ═══════ 다시 하기 ═══════ */
  const canRetry = result?.ok === true ? result.playsRemaining > 0 : false;

  const handleRetry = useCallback(() => {
    if (!canRetry) return;
    stopRaf();
    disposeEngine();
    setResult(null);
    setPhase("select");
    setSelectedStat(null);
    setNoteViews([]);
    setCombo(0);
    comboRef.current = 0;
  }, [canRetry, stopRaf, disposeEngine]);

  /* ═══════ 렌더 파생값 ═══════ */
  const statLabel = selectedStat === "expression" ? "표현력" : "리듬감";

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

  // 하단 파형 막대 : 실제 음원(song_1.mp3)의 0~36초 구간을 46등분해
  //   구간별 RMS(소리 크기)를 추출한 값. 게임 곡 길이(durationSec=36)와 일치하므로
  //   진행률(progressRatio)에 따라 색이 차오르면 실제 곡 진행과 맞는다.
  //   곡 교체 시 : 새 음원으로 같은 방식(0~durationSec, 46구간 RMS) 재추출해 교체.
  const waveBars = useMemo(
    () =>
      [
        19, 16, 18, 15, 16, 17, 15, 18, 20, 27, 26, 25, 26, 26, 24, 25, 21, 30,
        25, 28, 19, 28, 23, 28, 18, 28, 25, 28, 22, 25, 25, 26, 23, 26, 27, 27,
        26, 26, 27, 27, 27, 27, 22, 21, 23, 26,
      ].map((h) => ({ h })),
    []
  );

  // 진행 시간(초) : 진행 표시(파형·바·시간) 전용. 게임 판정과 무관.
  //   playing 이 되는 순간의 시각을 기록하고 경과를 직접 계산한다.
  //   엔진 시계에 의존하지 않아 견고하다. rAF 가 아닌 가벼운 interval(200ms)이라
  //   게임 성능·타이밍에 영향 없음. durationSec 도달 시 정지.
  const [progressSec, setProgressSec] = useState(0);
  const playStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying) {
      playStartRef.current = null;
      return;
    }
    // playing 진입 시각 기록 (한 번)
    playStartRef.current = performance.now();
    setProgressSec(0);
    const id = setInterval(() => {
      if (playStartRef.current == null) return;
      const elapsed = (performance.now() - playStartRef.current) / 1000;
      setProgressSec(Math.max(0, Math.min(elapsed, song.durationSec)));
    }, 200);
    return () => clearInterval(id);
  }, [isPlaying, song.durationSec]);

  // 진행률 0~1, 시간 문자열
  const progressRatio =
    song.durationSec > 0 ? progressSec / song.durationSec : 0;
  const fmtTime = (s: number) => {
    const sec = Math.max(0, Math.floor(s));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  const curTimeStr = fmtTime(progressSec);
  const totalTimeStr = fmtTime(song.durationSec);

  // MP3 EQ 막대 : 현재 재생 위치의 진폭 포락선을 26칸에 뿌린다.
  //   progressSec 이 바뀔 때마다(200ms) 재계산 → 음악 흐름에 맞춰 출렁인다.
  //   각 막대는 현재 프레임 주변을 살짝 어긋나게 읽어 이퀄라이저처럼 보이게 한다.
  const eqHeights = useMemo(() => {
    const frame = Math.floor(progressSec / ENVELOPE_FRAME_SEC);
    return Array.from({ length: EQ_BAR_COUNT }, (_, i) => {
      if (!isPlaying) return 0.12; // 정지 시 낮게 깔림
      const idx = frame + ((i * 7) % 13) - 6;
      const amp = SONG_ENVELOPE[
        ((idx % SONG_ENVELOPE.length) + SONG_ENVELOPE.length) % SONG_ENVELOPE.length
      ];
      return 0.12 + amp * 0.88;
    });
  }, [progressSec, isPlaying]);

  const showOverlay =
    phase === "loading" ||
    phase === "ready" ||
    phase === "failed";

  // ── select 단계 : 큰 게임 화면(shell) 없이 작은 선택 팝업만 ──
  //    스탯을 고르면 phase 가 loading→ready→playing 으로 넘어가며
  //    아래 shell(게임 화면)이 렌더된다. 예전 팝업과 동일한 크기감 유지.
  if (phase === "select") {
    return (
      <div className={styles.selectPopup}>
        <h3 className={styles.overlayTitle}>성장시킬 스탯을 선택하세요</h3>
        <p className={styles.overlayDesc}>
          리듬 연습은 모빌을 주지 않는 대신, 선택한 스탯을 크게 성장시킵니다.
        </p>
        <div className={styles.selectGrid}>
          <button
            type="button"
            className={styles.selectCard}
            onClick={() => handleSelectStat("rhythm")}
          >
            <img className={styles.selectEmoji} src="/svg/badges/badge-note-common.svg" alt="리듬감" />
            <span className={styles.selectName}>리듬감</span>
            <span className={styles.selectHint}>박자를 다루는 감각</span>
          </button>
          <button
            type="button"
            className={styles.selectCard}
            onClick={() => handleSelectStat("expression")}
          >
            <img className={styles.selectEmoji} src="/svg/badges/badge-star-common.svg" alt="표현력" />
            <span className={styles.selectName}>표현력</span>
            <span className={styles.selectHint}>무대를 채우는 힘</span>
          </button>
        </div>
        <button type="button" className={styles.exitLink} onClick={onExit}>
          ← 나가기
        </button>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {/* ══════ 좌 : 곡 패널 + MP3 ══════ */}
      <aside className={styles.left}>
        <div className={styles.brand}>RHYTHM</div>
        <div className={styles.brandSub}>NOW PLAYING</div>

        <div className={styles.songBlock}>
          <div className={styles.songTitle}>ぷるぷるプリン</div>
          <div className={styles.songArtist}>にゃるぱかBGM工房</div>
          <div className={styles.songBadges}>
            <span>★★★</span>
            <span>NoCopyrightMusic</span>
          </div>
        </div>

        {/* MP3 플레이어 (장식) */}
        <div className={styles.mp3}>
          <div className={styles.mp3Body} />
          <div className={styles.mp3Screen}>
            <div className={styles.mp3StatusRow}>
              <span className={styles.mp3Kind}>MP3</span>
              <span className={styles.mp3Play}>
                ▶ PLAY
              </span>
            </div>
            <div className={styles.mp3Thumb} />
            <div className={styles.mp3Track}>
              <div className={styles.mp3TrackName}>ぷるぷるプリン</div>
              <div className={styles.mp3TrackArtist}>にゃるぱかBGM工房</div>
            </div>
            <div className={styles.mp3Eq}>
              {eqHeights.map((h, i) => (
                <span
                  key={i}
                  style={{ transform: `scaleY(${h})` }}
                />
              ))}
            </div>
            <div className={styles.mp3Progress}>
              <div className={styles.mp3Bar}>
                <div
                  className={styles.mp3BarFill}
                  style={{ width: `${Math.round(progressRatio * 100)}%` }}
                />
              </div>
              <div className={styles.mp3Time}>
                <span>{curTimeStr}</span>
                <span>{totalTimeStr}</span>
              </div>
            </div>
          </div>

          <div className={styles.mp3Wheel}>
            <div className={`${styles.mp3WheelLabel} ${styles.mp3WheelMenu}`}>MENU</div>
            <div className={`${styles.mp3WheelLabel} ${styles.mp3WheelPrev}`}>◀◀</div>
            <div className={`${styles.mp3WheelLabel} ${styles.mp3WheelNext}`}>▶▶</div>
            <div className={`${styles.mp3WheelLabel} ${styles.mp3WheelPlay}`}>▶‖</div>
            <div className={styles.mp3Center} aria-hidden>
              <span className={styles.mp3CenterPlay} />
            </div>
          </div>
        </div>
      </aside>

      {/* ══════ 우 : 게임 + 트랜스포트 ══════ */}
      <section className={styles.right}>
        <div className={styles.gamePane}>
          {/* 성장 스탯 */}
          <div className={styles.statRow}>
            <span className={styles.statLabel}>성장 스탯</span>
            <div className={styles.statPills}>
              <button
                type="button"
                className={`${styles.statPill} ${
                  selectedStat !== "expression" ? styles.statPillActive : ""
                }`}
              >
                리듬감
              </button>
              <button
                type="button"
                className={`${styles.statPill} ${
                  selectedStat === "expression" ? styles.statPillActive : ""
                }`}
              >
                표현력
              </button>
            </div>
            <span className={styles.comboBadge}>
              {combo} <small>COMBO</small>
            </span>
          </div>

          {/* 노트 레인 */}
          <div className={styles.lane} onPointerDown={handleStagePointerDown}>
            <div className={styles.hitLine} style={{ left: `${HIT_LINE_X_PCT}%` }} />
            <div className={styles.hitRing} style={{ left: `${HIT_LINE_X_PCT}%` }} />

            {noteViews.map((nv) =>
              nv.judged || nv.xPct < -6 || nv.xPct > 110 ? null : (
                <div
                  key={nv.index}
                  className={styles.note}
                  style={{ left: `${nv.xPct}%` }}
                />
              )
            )}

            {judgeText ? (
              <div
                className={`${styles.judgeFlash} ${judgeClass}`}
                style={{ left: `${HIT_LINE_X_PCT}%` }}
              >
                {judgeText}
              </div>
            ) : null}

            {phase === "countin" ? (
              <div className={styles.overlay}>
                <span className={styles.countinText}>준비…</span>
              </div>
            ) : null}
          </div>

          {/* 아이콘 레일 + 캐릭터 */}
          <div className={styles.charRow}>
            <div className={styles.iconRail}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 3 10.5V21h6v-6h6v6h6V10.5z" /></svg>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.7C6.5 16.9 3 13.6 3 9.7 3 7.1 5 5.2 7.4 5.2c1.5 0 2.9.8 3.6 2 .7-1.2 2.1-2 3.6-2C19 5.2 21 7.1 21 9.7c0 3.9-3.5 7.2-9 11z" /></svg>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18.2a2.6 2.6 0 1 1-1.7-2.45V6.1l9.4-1.9v8.6a2.6 2.6 0 1 1-1.7-2.45V6.6L9 8.1z" /></svg>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></svg>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 4v6M6 14v6M12 4v3M12 11v9M18 4v9M18 17v3" /><circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="12" cy="9" r="1.7" fill="currentColor" stroke="none" /><circle cx="18" cy="15" r="1.7" fill="currentColor" stroke="none" /></svg>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.2" cy="8.2" r="1.4" fill="currentColor" stroke="none" /></svg>
            </div>
            <div
              className={styles.sprite}
              onPointerDown={handleStagePointerDown}
            >
              <img
                key={jumpTick}
                className={`${styles.spriteImg} ${jumpTick > 0 ? styles.spriteJump : ""}`}
                src={spriteUrl ?? "/rhythm/character.png"}
                alt=""
                draggable={false}
              />
            </div>
          </div>
        </div>

        {/* 하단 트랜스포트 */}
        <div className={styles.transport}>
          <button type="button" className={styles.transIcon}>◀◀</button>
          <button type="button" className={styles.transIcon}>▶▶</button>
          <span className={styles.transTime}>{curTimeStr}</span>
          <div className={styles.wave}>
            {waveBars.map((b, i) => {
              const played = i / waveBars.length < progressRatio;
              return (
                <span
                  key={i}
                  style={{ height: `${b.h}px`, background: played ? "#3f88f9" : "#c3d3f0" }}
                />
              );
            })}
          </div>
          <span className={styles.transTimeEnd}>{totalTimeStr}</span>
        </div>
      </section>

      {/* ══════ 오버레이 (loading / ready / failed) ══════ */}
      {showOverlay ? (
        <div className={styles.overlay}>
          {phase === "loading" ? (
            <>
              <div className={styles.spinner} />
              <span className={styles.overlayText}>음원을 준비하고 있습니다…</span>
            </>
          ) : null}

          {phase === "ready" ? (
            <>
              <span className={styles.readyEmoji}>🥁</span>
              <span className={styles.overlayText}>
                노트가 판정선에 닿는 순간 스페이스바 또는 화면을 탭하세요.
              </span>
              <button type="button" className={styles.primaryBtn} onClick={handleStart}>
                시작하기
              </button>
            </>
          ) : null}

          {phase === "failed" ? (
            <>
              <span className={styles.failEmoji}>⚠️</span>
              <span className={styles.overlayText}>
                음원을 불러오지 못했습니다. 잠시 후 다시 시도해 주십시오.
              </span>
              <button type="button" className={styles.primaryBtn} onClick={onExit}>
                돌아가기
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ══════ 결과 팝업 ══════ */}
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