// lib/rhythm-engine.ts
// ═══════════════════════════════════════════════════════════════════
// 리듬게임 오디오 · 타이밍 엔진 (세션 M 신설)
// ═══════════════════════════════════════════════════════════════════
//
// 리듬게임 판정 정확도의 핵심. 순수 오디오 · 시간 관리만 담당한다.
// React · DOM 렌더에 의존하지 않는다 (RhythmGame.tsx 가 이 엔진을 소비).
//
// 왜 AudioContext 기준인가 :
//   · HTMLAudioElement.currentTime 은 브라우저마다 20~100ms 오차 · 지터.
//   · AudioContext.currentTime 은 오디오 하드웨어 클럭 기반 고정밀.
//   · 판정은 반드시 AudioContext 시간축에서 한다.
//
// 시간축 3개를 명확히 구분 :
//   1) ctx.currentTime         : AudioContext 하드웨어 클럭 (판정 기준)
//   2) event.timeStamp         : performance.now() origin (입력 이벤트)
//   3) song time (곡 내 경과)  : ctx 시간 - 재생 시작 ctx 시각
//
//   입력 이벤트가 오면 event.timeStamp(ms) 를 ctx 시간으로 변환한 뒤
//   song time 으로 바꿔 노트 시각과 비교한다.
//   변환 : ctxTime ≈ (perfNowMs - startPerfMs)/1000 + startCtxTime
//   (start 시점에 두 클럭의 대응점을 저장해 offset 계산)
//
// B안 (곡 길이 제한) :
//   원본 음원이 durationSec 보다 길어도 durationSec 시점에 fade out · 정지.
//   fade 는 GainNode 로 부드럽게 (뚝 끊김 방지).
//
// 모바일 대응 :
//   · iOS Safari 는 유저 제스처 없이 AudioContext 시작 불가.
//     → 반드시 유저 클릭(시작 버튼) 핸들러 안에서 unlockAndStart 호출.
//   · resume() 후 무음 버퍼 1회 재생으로 오디오 파이프라인 warm-up.
//
// 안정성 :
//   · 모든 리소스 (ctx · source · gain) 는 dispose 에서 정리.
//   · decode 실패 · 재생 실패는 예외로 던지지 않고 상태 플래그로 노출
//     (호출부가 로딩 실패 UI 처리).
//   · 언마운트 시 dispose 필수 (메모리 · 오디오 노드 누수 방지).
// ═══════════════════════════════════════════════════════════════════

export type RhythmEngineStatus =
  | "idle"       // 생성 직후
  | "loading"    // 음원 fetch · decode 중
  | "ready"      // 로드 완료, 재생 대기
  | "playing"    // 재생 중
  | "ended"      // 곡 정상 종료
  | "error";     // 로드 · 재생 실패

type StatusListener = (status: RhythmEngineStatus) => void;

export class RhythmEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  private _status: RhythmEngineStatus = "idle";
  private statusListeners: StatusListener[] = [];

  // start 시점의 두 클럭 대응점 (시간축 변환용)
  private startCtxTime = 0;      // 재생 시작 시 ctx.currentTime
  private startPerfMs = 0;       // 재생 시작 시 performance.now()
  private started = false;

  // 곡 길이 (B안 정지 · fade 기준). 초.
  private durationSec = 0;
  // fade out 길이 (초)
  private static readonly FADE_OUT_SEC = 0.6;

  private endTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 디버그 : 채보 검증용 틱 ──────────────────────
  //   setDebugTicks 로 노트 시각 배열을 넘기면 재생 시 각 시각에 비프.
  //   운영에선 사용 안 함.
  private debugTickTimes: number[] | null = null;
  private tickNodes: OscillatorNode[] = [];

  /* ─────────────────────────────────────────────
   * 상태
   * ───────────────────────────────────────────── */

  get status(): RhythmEngineStatus {
    return this._status;
  }

  private setStatus(s: RhythmEngineStatus) {
    this._status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  onStatusChange(fn: StatusListener): () => void {
    this.statusListeners.push(fn);
    return () => {
      this.statusListeners = this.statusListeners.filter((f) => f !== fn);
    };
  }

  /* ─────────────────────────────────────────────
   * 로딩
   * ───────────────────────────────────────────── */

  /**
   * 음원 fetch + decode. 재생 시작 전에 반드시 완료해야 한다.
   * AudioContext 는 아직 생성만 (suspended 가능). unlock 은 start 에서.
   *
   * @param audioUrl     public 기준 경로
   * @param durationSec  곡 길이 (B안 정지 기준)
   */
  async load(audioUrl: string, durationSec: number): Promise<void> {
    this.durationSec = durationSec;
    this.setStatus("loading");

    try {
      // AudioContext 생성 (webkit prefix 방어)
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        this.setStatus("error");
        return;
      }
      this.ctx = new Ctor();

      const res = await fetch(audioUrl);
      if (!res.ok) {
        this.setStatus("error");
        return;
      }
      const arrayBuf = await res.arrayBuffer();

      // decodeAudioData : Safari 는 Promise 미지원 버전 있어 콜백 폴백 병행.
      this.buffer = await this.decode(arrayBuf);
      if (!this.buffer) {
        this.setStatus("error");
        return;
      }

      this.setStatus("ready");
    } catch {
      this.setStatus("error");
    }
  }

  private decode(arrayBuf: ArrayBuffer): Promise<AudioBuffer | null> {
    return new Promise((resolve) => {
      if (!this.ctx) {
        resolve(null);
        return;
      }
      try {
        // 표준 Promise 방식
        const p = this.ctx.decodeAudioData(arrayBuf);
        if (p && typeof p.then === "function") {
          p.then(
            (buf) => resolve(buf),
            () => resolve(null)
          );
        } else {
          // 구형 콜백 방식
          this.ctx.decodeAudioData(
            arrayBuf,
            (buf) => resolve(buf),
            () => resolve(null)
          );
        }
      } catch {
        resolve(null);
      }
    });
  }

  /* ─────────────────────────────────────────────
   * 재생 (유저 제스처 안에서 호출 필수)
   * ───────────────────────────────────────────── */

  /**
   * AudioContext unlock + 재생 시작.
   * 반드시 유저 클릭 등 제스처 핸들러 안에서 호출 (iOS Safari).
   *
   * @param countInSec  카운트인 (오디오 실제 시작을 이만큼 뒤로 미룸).
   *                    이 구간에도 곡 시간축은 흐른다고 보되, 오디오는
   *                    아직 안 남 (첫 노트 대비 시간).
   *
   * 곡 시간축 정의 :
   *   songTime = ctx.currentTime - startCtxTime
   *   startCtxTime 은 "오디오가 실제로 소리 나기 시작하는 ctx 시각".
   *   즉 카운트인이 끝난 시점. 노트 time 은 songTime 기준.
   */
  async start(countInSec: number): Promise<void> {
    if (!this.ctx || !this.buffer) {
      this.setStatus("error");
      return;
    }

    // suspended 면 resume (유저 제스처 컨텍스트 안이라 통과)
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        // resume 실패해도 시도는 계속
      }
    }

    const now = this.ctx.currentTime;
    const audioStartAt = now + countInSec; // 실제 소리 시작 ctx 시각

    // GainNode (fade out 용)
    this.gain = this.ctx.createGain();
    this.gain.gain.setValueAtTime(1, now);

    // Source
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gain);
    this.gain.connect(this.ctx.destination);

    // B안 : durationSec 시점 fade out 후 정지
    const fadeStart = audioStartAt + this.durationSec - RhythmEngine.FADE_OUT_SEC;
    const stopAt = audioStartAt + this.durationSec;
    if (fadeStart > audioStartAt) {
      this.gain.gain.setValueAtTime(1, Math.max(now, fadeStart));
      this.gain.gain.linearRampToValueAtTime(0.0001, stopAt);
    }

    // 재생 : 오프셋 0 부터, audioStartAt 에 시작
    this.source.start(audioStartAt, 0, this.durationSec);

    // ── 디버그 : 노트 시각마다 틱(비프) 예약 재생 ────
    //   채보 검증용. tickTimes 가 주어지면 각 시각에 짧은 오실레이터 재생.
    //   오디오와 같은 ctx 시간축(audioStartAt 기준)에 예약하므로 완벽 동기.
    //   운영 빌드에선 tickTimes 를 넘기지 않아 아무 일도 안 함.
    if (this.debugTickTimes && this.debugTickTimes.length > 0) {
      this.scheduleTicks(this.debugTickTimes, audioStartAt);
    }

    // 시간축 대응점 저장 : songTime 원점 = audioStartAt
    this.startCtxTime = audioStartAt;
    this.startPerfMs = performance.now() + countInSec * 1000;
    this.started = true;

    this.setStatus("playing");

    // 종료 처리 (fade 완료 + 약간 여유)
    const totalMs = (countInSec + this.durationSec) * 1000 + 100;
    this.endTimer = setTimeout(() => {
      if (this._status === "playing") this.setStatus("ended");
    }, totalMs);
  }

  /* ─────────────────────────────────────────────
   * 디버그 : 채보 검증용 틱
   * ───────────────────────────────────────────── */

  /**
   * 채보 검증용 틱 시각 설정. start() 전에 호출.
   * @param times  노트 시각 배열 (곡 시작 후 초). rhythmData 의 note.time 그대로.
   */
  setDebugTicks(times: number[]): void {
    this.debugTickTimes = times.slice();
  }

  /**
   * 각 노트 시각에 짧은 비프(오실레이터) 를 ctx 시간축에 예약.
   * audioStartAt(songTime=0 의 ctx 시각) 기준이므로 음악과 정확히 동기.
   */
  private scheduleTicks(times: number[], audioStartAt: number): void {
    if (!this.ctx) return;
    const TICK_FREQ = 1400;   // Hz (높은 톡 소리)
    const TICK_DUR = 0.035;   // 초 (짧게)
    const TICK_GAIN = 0.35;

    for (const t of times) {
      if (t < 0 || t > this.durationSec) continue;
      const at = audioStartAt + t;

      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(TICK_FREQ, at);

      // 짧은 감쇠 엔벨로프 (클릭 노이즈 방지)
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(TICK_GAIN, at + 0.005);
      g.gain.linearRampToValueAtTime(0.0001, at + TICK_DUR);

      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(at);
      osc.stop(at + TICK_DUR + 0.01);
      this.tickNodes.push(osc);
    }
  }

  /* ─────────────────────────────────────────────
   * 시간축 조회 · 변환
   * ───────────────────────────────────────────── */

  /**
   * 현재 곡 시간 (초). 재생 시작 전 · 카운트인 중이면 음수 가능.
   *   songTime < 0  : 아직 오디오 시작 전 (카운트인)
   *   songTime >= 0 : 오디오 재생 중
   * rAF 루프에서 매 프레임 호출해 노트 위치 · MISS 판정.
   */
  getSongTime(): number {
    if (!this.ctx || !this.started) return -Infinity;
    return this.ctx.currentTime - this.startCtxTime;
  }

  /**
   * 입력 이벤트 시각(event.timeStamp, ms) 을 곡 시간(초) 으로 변환.
   *
   * event.timeStamp 는 performance.now() origin (High Resolution Time).
   * 재생 시작 시 저장한 startPerfMs (songTime=0 에 해당하는 perf ms) 로 환산.
   *
   * @param eventTimeStampMs  React/DOM 이벤트의 timeStamp (ms)
   * @returns 곡 시간 (초). 노트 time 과 직접 비교 가능.
   *
   * 폴백 : 일부 환경에서 timeStamp 가 0 이거나 신뢰 불가하면
   *        getSongTime() (현재 시각) 으로 대체.
   */
  eventToSongTime(eventTimeStampMs: number): number {
    if (!this.started) return -Infinity;
    if (!eventTimeStampMs || eventTimeStampMs <= 0) {
      return this.getSongTime();
    }
    return (eventTimeStampMs - this.startPerfMs) / 1000;
  }

  isPlaying(): boolean {
    return this._status === "playing";
  }

  hasEnded(): boolean {
    return this._status === "ended";
  }

  /* ─────────────────────────────────────────────
   * 정리
   * ───────────────────────────────────────────── */

  /**
   * 모든 오디오 리소스 정리. 언마운트 · 재시작 전 필수 호출.
   */
  dispose(): void {
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // 이미 정지됐거나 시작 안 함
      }
      try {
        this.source.disconnect();
      } catch {
        /* noop */
      }
      this.source = null;
    }
    if (this.gain) {
      try {
        this.gain.disconnect();
      } catch {
        /* noop */
      }
      this.gain = null;
    }
    // 디버그 틱 노드 정리
    for (const osc of this.tickNodes) {
      try {
        osc.stop();
      } catch {
        /* 이미 정지 */
      }
      try {
        osc.disconnect();
      } catch {
        /* noop */
      }
    }
    this.tickNodes = [];
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        /* noop */
      }
      this.ctx = null;
    }
    this.buffer = null;
    this.started = false;
    this.statusListeners = [];
  }
}