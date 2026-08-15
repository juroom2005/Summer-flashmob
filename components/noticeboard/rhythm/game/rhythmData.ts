// components/noticeboard/rhythm/game/rhythmData.ts
// ═══════════════════════════════════════════════════════════════════
// 리듬게임 순수 로직 · 데이터 (세션 M 신설)
// ═══════════════════════════════════════════════════════════════════
//
// 태고의 달인 레퍼런스 가로형 리듬게임.
//   · 노트가 우 → 좌 로 흐름
//   · 좌측 판정선 (히트 존) 위를 지날 때 입력
//   · 판정 : PERFECT / GOOD / MISS
//
// 이 파일은 순수 로직만 담는다 (React · DOM 의존 없음).
//   · 곡 · 노트 데이터
//   · 튜닝 상수
//   · 판정 계산 · 점수 계산 함수
// 렌더 (RhythmGame.tsx) · 오디오 엔진 (lib/rhythm-engine.ts) 과 분리.
// 향후 게임 재설계 시 이 로직은 유지하고 렌더만 교체 가능.
//
// 소스 교체 방침 (사용자 요구) :
//   · 곡 · 음원 · 노트 패턴은 SONGS 배열에만 존재. 곡 교체 = 배열 수정.
//   · 음원 파일은 public/audio/rhythm/ 하위. 경로는 SONG.audioUrl 만 참조.
//   · 노트 시각은 곡 파형 분석으로 추출된 값 (librosa onset). 곡 교체 시 재추출.
//
// ═══════════════════════════════════════════════════════════════════

/* ═══════════════════════════════════════════════════════════
 * 튜닝 상수 (v13 §7 관례 : 튜닝 지점 상단 집중)
 * ─────────────────────────────────────────────────────────── */

// 판정 창 (초 단위, AudioContext 시간 기준 절대 오차)
//   |입력시각 - 노트시각| 이 이 값 이내면 해당 등급.
export const PERFECT_WINDOW_SEC = 0.08; // ±80ms
export const GOOD_WINDOW_SEC    = 0.16; // ±160ms
// GOOD_WINDOW 초과이고, 노트가 판정선을 MISS_PAST_SEC 만큼 지나면 MISS 확정.
export const MISS_PAST_SEC      = 0.18; // 판정선 지난 뒤 이만큼 더 지나면 놓침 처리

// 판정 등급별 점수 (원안 v8 §2-3)
export const SCORE_PERFECT = 4;
export const SCORE_GOOD    = 2;
export const SCORE_MISS    = 0;

// 노트가 화면 오른쪽 끝에서 판정선까지 이동하는 시간 (초).
//   작을수록 노트가 빨리 날아옴 (어려움). 태고 기본 감각에 맞춤.
export const NOTE_TRAVEL_SEC = 2.0;

// 재생 시작 전 카운트인 (초). 유저가 첫 노트 대비할 시간.
//   실제 오디오는 이 시간 뒤에 start. 이 구간에도 노트는 이미 흐르기 시작.
export const COUNT_IN_SEC = 3.0;

// 곡 종료 후 결과까지 여유 (마지막 노트 판정 여유)
export const TAIL_SEC = 1.0;

/* ═══════════════════════════════════════════════════════════
 * 타입
 * ─────────────────────────────────────────────────────────── */

// 노트 1개. 1종 노트이므로 lane 없음.
//   time : 곡(오디오) 재생 시작 후 이 노트가 판정선에 도달하는 시각 (초).
export type RhythmNote = {
  time: number;
};

// 곡 정의.
export type RhythmSong = {
  id:          string;
  title:       string;
  audioUrl:    string;   // public 기준 절대 경로. 교체 시 이 값만 변경.
  durationSec: number;   // 게임상 곡 길이 (B안 : 원본이 더 길어도 여기서 정지 · fade out)
  notes:       RhythmNote[];
};

// 판정 등급
export type Judgement = "perfect" | "good" | "miss";

// 노트 판정 결과 (렌더 · 채점 공용)
export type NoteState = {
  index:     number;      // notes 배열 인덱스
  time:      number;      // 판정 시각 (초)
  judged:    boolean;     // 판정 완료 여부
  judgement: Judgement | null;
};

// 최종 채점 결과
export type RhythmScore = {
  perfectCount: number;
  goodCount:    number;
  missCount:    number;
  rawScore:     number;   // Σ 판정 점수
  maxScore:     number;   // 노트수 × 4
  finalScore:   number;   // 0~100 정수
  maxCombo:     number;
};

/* ═══════════════════════════════════════════════════════════
 * 곡 데이터
 *
 * song_1 : 기본 곡 (저작권 프리, 사용자 제공).
 *   원본 음원은 96초이나 B안에 따라 durationSec(30) 까지만 사용.
 *   노트 시각은 librosa onset 강도 기반 상위 25개 (곡 실제 비트 정렬).
 *   곡 교체 시 : audioUrl 변경 + notes 재추출.
 * ─────────────────────────────────────────────────────────── */

export const SONGS: RhythmSong[] = [
  {
    id:          "song_1",
    title:       "기본 곡",
    audioUrl:    "/audio/rhythm/song_1.mp3",
    durationSec: 36,
    notes: [
      { time: 0.099 },
      { time: 0.619 },
      { time: 1.609 },
      { time: 2.21 },
      { time: 3.263 },
      { time: 3.843 },
      { time: 4.815 },
      { time: 5.442 },
      { time: 6.021 },
      { time: 6.865 },
      { time: 7.665 },
      { time: 8.81 },
      { time: 9.217 },
      { time: 9.992 },
      { time: 10.859 },
      { time: 11.245 },
      { time: 11.846 },
      { time: 12.837 },
      { time: 13.442 },
      { time: 14.414 },
      { time: 15.036 },
      { time: 16.026 },
      { time: 16.631 },
      { time: 17.6 },
      { time: 18.222 },
      { time: 19.236 },
      { time: 19.864 },
      { time: 20.878 },
      { time: 21.478 },
      { time: 22.516 },
      { time: 23.096 },
      { time: 24.021 },
      { time: 24.606 },
      { time: 25.639 },
      { time: 26.286 },
      { time: 27.233 },
      { time: 27.816 },
      { time: 28.81 },
      { time: 29.432 },
      { time: 30.382 },
      { time: 31.027 },
      { time: 32.043 },
      { time: 32.608 },
      { time: 33.236 },
      { time: 33.603 },
      { time: 34.254 },
      { time: 34.86 },
    ],
  },
];

// 기본 곡 조회 (초안은 단일 곡. 곡 선택 UI 는 추후).
export function getDefaultSong(): RhythmSong {
  return SONGS[0];
}

export function getSongById(id: string): RhythmSong | undefined {
  return SONGS.find((s: RhythmSong) => s.id === id);
}

/* ═══════════════════════════════════════════════════════════
 * 판정 로직
 * ─────────────────────────────────────────────────────────── */

/**
 * 입력 시각과 노트 시각 오차로 판정 등급 계산.
 * 창을 벗어나면 null (이 입력으로는 이 노트를 판정하지 않음).
 *
 * @param deltaSec  |입력시각 - 노트시각| (초, 절대값 아님. 부호 무관하게 절대값 처리)
 */
export function classifyJudgement(deltaSec: number): Judgement | null {
  const d = Math.abs(deltaSec);
  if (d <= PERFECT_WINDOW_SEC) return "perfect";
  if (d <= GOOD_WINDOW_SEC)    return "good";
  return null;
}

/**
 * 입력 시각(now) 기준, 아직 판정 안 된 노트 중 가장 가까운 판정 가능 노트를 찾는다.
 * GOOD 창 안에 든 노트 중 |오차| 최소인 것.
 *
 * @returns  판정할 노트 인덱스 · 등급. 없으면 null (헛침).
 */
export function findHitNote(
  notes: NoteState[],
  nowSec: number
): { index: number; judgement: Judgement } | null {
  let best: { index: number; judgement: Judgement; absDelta: number } | null =
    null;

  for (const n of notes) {
    if (n.judged) continue;
    const delta = nowSec - n.time;
    const j = classifyJudgement(delta);
    if (j === null) continue;
    const abs = Math.abs(delta);
    if (best === null || abs < best.absDelta) {
      best = { index: n.index, judgement: j, absDelta: abs };
    }
  }

  if (best === null) return null;
  return { index: best.index, judgement: best.judgement };
}

/**
 * 판정선을 지나쳐 MISS 확정할 노트 인덱스 목록을 찾는다.
 * (rAF 루프에서 매 프레임 호출. 아직 판정 안 됐고 now 가 노트시각 + MISS_PAST_SEC 초과.)
 */
export function findMissedNotes(notes: NoteState[], nowSec: number): number[] {
  const missed: number[] = [];
  for (const n of notes) {
    if (n.judged) continue;
    if (nowSec - n.time > MISS_PAST_SEC) {
      missed.push(n.index);
    }
  }
  return missed;
}

/* ═══════════════════════════════════════════════════════════
 * 점수 계산
 * ─────────────────────────────────────────────────────────── */

/**
 * 노트 상태 배열로 최종 점수 산정.
 * finalScore = round(rawScore / maxScore × 100), 0~100.
 * 미판정(판정 안 끝난) 노트는 MISS 취급 (곡 끝났으면 남은 건 놓친 것).
 */
export function calculateScore(notes: NoteState[]): RhythmScore {
  let perfectCount = 0;
  let goodCount = 0;
  let missCount = 0;
  let rawScore = 0;
  let combo = 0;
  let maxCombo = 0;

  for (const n of notes) {
    const j: Judgement = n.judged && n.judgement ? n.judgement : "miss";
    if (j === "perfect") {
      perfectCount += 1;
      rawScore += SCORE_PERFECT;
      combo += 1;
    } else if (j === "good") {
      goodCount += 1;
      rawScore += SCORE_GOOD;
      combo += 1;
    } else {
      missCount += 1;
      rawScore += SCORE_MISS;
      combo = 0;
    }
    if (combo > maxCombo) maxCombo = combo;
  }

  const maxScore = notes.length * SCORE_PERFECT;
  const finalScore =
    maxScore > 0 ? Math.round((rawScore / maxScore) * 100) : 0;

  return {
    perfectCount,
    goodCount,
    missCount,
    rawScore,
    maxScore,
    finalScore: Math.max(0, Math.min(100, finalScore)),
    maxCombo,
  };
}

/**
 * 초기 NoteState 배열 생성 (곡 시작 시).
 */
export function buildInitialNoteStates(song: RhythmSong): NoteState[] {
  return song.notes.map((note: RhythmNote, i: number) => ({
    index:     i,
    time:      note.time,
    judged:    false,
    judgement: null,
  }));
}