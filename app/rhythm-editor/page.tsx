// app/rhythm-editor/page.tsx
// ═══════════════════════════════════════════════════════════════════
// 채보 에디터 (개발 도구, 세션 M)
// ═══════════════════════════════════════════════════════════════════
//
// 곡을 들으며 노트 시각(초)을 직접 찍어 채보를 만드는 독립 도구.
// 게임 코드와 분리 (이 페이지만으로 완결). 채보 완성 후엔 이 라우트를
// 삭제하거나 남겨둬도 무방 (운영 화면과 연결 없음).
//
// 기능 :
//   · 곡 재생 / 일시정지 / 처음으로 / 5초 뒤로·앞으로
//   · 재생 속도 (0.5x / 0.75x / 1x) — 느리게 들으며 정밀하게 찍기
//   · 스페이스바 또는 "노트 찍기" 버튼 → 현재 재생 시각을 목록에 추가
//   · 찍은 노트 목록 (시간순 자동 정렬) · 개별 삭제 · 전체 삭제
//   · rhythmData 형식(`{ time: n.nnn },`) 으로 즉시 복사
//   · 기존 채보 불러오기 (rhythmData 배열 붙여넣기 → 이어서 편집)
//
// 정확도 :
//   판정 게임이 아니므로 HTMLAudioElement.currentTime 로 충분.
//   멈춰가며·느리게 찍으므로 사람 반응 지연 문제 없음.
//   찍은 뒤 목록에서 미세 조정도 가능 (± 버튼).
//
// 곡 경로 : 기본 game 음원(/audio/rhythm/song_1.mp3). 다른 곡은 URL 입력칸.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_AUDIO = "/audio/rhythm/song_1.mp3";

// 미세 조정 단위 (초)
const NUDGE = 0.02;

export default function RhythmEditorPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [audioUrl, setAudioUrl] = useState(DEFAULT_AUDIO);
  const [loadedUrl, setLoadedUrl] = useState(DEFAULT_AUDIO);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  // 찍은 노트 시각(초) 목록 (항상 오름차순 유지)
  const [notes, setNotes] = useState<number[]>([]);

  // 붙여넣기 입력 (기존 채보 불러오기)
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);

  const rafRef = useRef<number | null>(null);

  /* ── 재생 시각 추적 (rAF) ─────────────────────── */
  useEffect(() => {
    const tick = () => {
      const a = audioRef.current;
      if (a) setCurTime(a.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ── 오디오 이벤트 ───────────────────────────── */
  const handleLoaded = () => {
    const a = audioRef.current;
    if (a) setDuration(a.duration || 0);
  };
  const handleEnded = () => setPlaying(false);

  /* ── 재생 제어 ───────────────────────────────── */
  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  const seekTo = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a) return;
    const clamped = Math.max(0, Math.min(t, a.duration || t));
    a.currentTime = clamped;
    setCurTime(clamped);
  }, []);

  const restart = useCallback(() => seekTo(0), [seekTo]);
  const back5 = useCallback(
    () => seekTo((audioRef.current?.currentTime ?? 0) - 5),
    [seekTo]
  );
  const fwd5 = useCallback(
    () => seekTo((audioRef.current?.currentTime ?? 0) + 5),
    [seekTo]
  );

  const changeRate = useCallback((r: number) => {
    const a = audioRef.current;
    if (a) a.playbackRate = r;
    setRate(r);
  }, []);

  /* ── 노트 찍기 ───────────────────────────────── */
  const stampNote = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const t = Math.round(a.currentTime * 1000) / 1000; // 소수 3자리
    setNotes((prev: number[]) => {
      // 0.05초 이내 중복 방지
      if (prev.some((p) => Math.abs(p - t) < 0.05)) return prev;
      return [...prev, t].sort((x, y) => x - y);
    });
  }, []);

  const removeNote = useCallback((idx: number) => {
    setNotes((prev: number[]) => prev.filter((_, i) => i !== idx));
  }, []);

  const nudgeNote = useCallback((idx: number, delta: number) => {
    setNotes((prev: number[]) => {
      const next = prev.slice();
      next[idx] = Math.max(0, Math.round((next[idx] + delta) * 1000) / 1000);
      return next.sort((x, y) => x - y);
    });
  }, []);

  const clearAll = useCallback(() => {
    if (confirm("찍은 노트를 모두 지울까요?")) setNotes([]);
  }, []);

  /* ── 스페이스바 = 노트 찍기 ───────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 입력창 포커스 중이면 무시
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        stampNote();
      } else if (e.code === "KeyP") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stampNote, togglePlay]);

  /* ── 곡 로드 ─────────────────────────────────── */
  const loadAudio = useCallback(() => {
    setLoadedUrl(audioUrl);
    setPlaying(false);
    setCurTime(0);
    setDuration(0);
    // audio 엘리먼트는 key 변경으로 재생성됨
  }, [audioUrl]);

  /* ── 배열 복사 ───────────────────────────────── */
  const arrayText = notes.map((t) => `      { time: ${t} },`).join("\n");
  const fullText = `notes: [\n${arrayText}\n    ],`;

  const copyArray = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 실패 시 아래 textarea 에서 수동 복사
    }
  }, [fullText]);

  /* ── 기존 채보 불러오기 ──────────────────────── */
  const importNotes = useCallback(() => {
    // "{ time: 2.647 }" 또는 "2.647" 형태 모두에서 숫자 추출
    const nums = importText.match(/\d+\.?\d*/g);
    if (!nums) return;
    const parsed = nums
      .map((s) => parseFloat(s))
      .filter((n) => !Number.isNaN(n) && n >= 0);
    setNotes(Array.from(new Set(parsed)).sort((a, b) => a - b));
    setImportText("");
  }, [importText]);

  /* ── 렌더 ────────────────────────────────────── */
  const progress = duration > 0 ? (curTime / duration) * 100 : 0;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>🥁 채보 에디터</h1>
        <p style={styles.subtitle}>
          곡을 들으며 <b>스페이스바</b>(또는 노트 찍기 버튼)로 노트 시각을
          기록합니다. 느린 속도 · 되감기로 정확히 찍고, 목록에서 미세 조정한 뒤
          배열을 복사해 <code>rhythmData.ts</code> 에 붙여넣으세요.
        </p>

        {/* 곡 선택 */}
        <div style={styles.row}>
          <input
            style={styles.urlInput}
            value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            placeholder="/audio/rhythm/song_1.mp3"
          />
          <button style={styles.btn} onClick={loadAudio}>
            곡 불러오기
          </button>
        </div>

        {/* 오디오 (숨김, 커스텀 컨트롤 사용) */}
        <audio
          key={loadedUrl}
          ref={audioRef}
          src={loadedUrl}
          onLoadedMetadata={handleLoaded}
          onEnded={handleEnded}
          preload="auto"
        />

        {/* 시각 표시 */}
        <div style={styles.clockBox}>
          <span style={styles.clock}>{curTime.toFixed(2)}</span>
          <span style={styles.clockUnit}>
            / {duration.toFixed(2)}s · {rate}x
          </span>
        </div>

        {/* 진행바 (클릭 시 seek) */}
        <div
          style={styles.progressTrack}
          onClick={(e) => {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seekTo(ratio * duration);
          }}
        >
          <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          {/* 찍은 노트 마커 */}
          {notes.map((t, i) =>
            duration > 0 ? (
              <div
                key={i}
                style={{
                  ...styles.marker,
                  left: `${(t / duration) * 100}%`,
                }}
                title={`${t}s`}
              />
            ) : null
          )}
        </div>

        {/* 재생 컨트롤 */}
        <div style={styles.controls}>
          <button style={styles.ctrlBtn} onClick={restart} title="처음으로">
            ⏮
          </button>
          <button style={styles.ctrlBtn} onClick={back5} title="5초 뒤로">
            ⏪
          </button>
          <button
            style={{ ...styles.ctrlBtn, ...styles.playBtn }}
            onClick={togglePlay}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button style={styles.ctrlBtn} onClick={fwd5} title="5초 앞으로">
            ⏩
          </button>
        </div>

        {/* 속도 */}
        <div style={styles.rateRow}>
          <span style={styles.rateLabel}>재생 속도</span>
          {[0.5, 0.75, 1].map((r) => (
            <button
              key={r}
              style={{
                ...styles.rateBtn,
                ...(rate === r ? styles.rateBtnActive : {}),
              }}
              onClick={() => changeRate(r)}
            >
              {r}x
            </button>
          ))}
        </div>

        {/* 노트 찍기 (큰 버튼) */}
        <button style={styles.stampBtn} onClick={stampNote}>
          ● 노트 찍기 (Space)
        </button>

        {/* 목록 */}
        <div style={styles.listHeader}>
          <span>
            찍은 노트 <b>{notes.length}</b>개
          </span>
          <button style={styles.clearBtn} onClick={clearAll}>
            전체 삭제
          </button>
        </div>

        <div style={styles.list}>
          {notes.length === 0 ? (
            <div style={styles.empty}>아직 찍은 노트가 없습니다.</div>
          ) : (
            notes.map((t, i) => (
              <div key={i} style={styles.noteRow}>
                <span style={styles.noteIdx}>{i + 1}</span>
                <span style={styles.noteTime}>{t.toFixed(3)}s</span>
                <button
                  style={styles.miniBtn}
                  onClick={() => nudgeNote(i, -NUDGE)}
                  title="0.02초 당김"
                >
                  −
                </button>
                <button
                  style={styles.miniBtn}
                  onClick={() => nudgeNote(i, NUDGE)}
                  title="0.02초 밈"
                >
                  +
                </button>
                <button
                  style={styles.miniBtn}
                  onClick={() => seekTo(t - 1)}
                  title="이 지점 1초 전부터 듣기"
                >
                  ▶
                </button>
                <button
                  style={{ ...styles.miniBtn, ...styles.delBtn }}
                  onClick={() => removeNote(i)}
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {/* 배열 출력 */}
        <div style={styles.outputHeader}>
          <span>rhythmData 형식</span>
          <button style={styles.copyBtn} onClick={copyArray}>
            {copied ? "복사됨 ✓" : "배열 복사"}
          </button>
        </div>
        <textarea style={styles.output} readOnly value={fullText} rows={8} />

        {/* 불러오기 */}
        <details style={styles.details}>
          <summary style={styles.summary}>기존 채보 불러오기</summary>
          <p style={styles.importHint}>
            기존 <code>notes</code> 배열이나 숫자 목록을 붙여넣고 불러오면
            이어서 편집할 수 있습니다.
          </p>
          <textarea
            style={styles.importArea}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="{ time: 2.647 }, { time: 5.642 } ... 또는 2.647, 5.642 ..."
            rows={4}
          />
          <button style={styles.btn} onClick={importNotes}>
            불러오기
          </button>
        </details>
      </div>
    </div>
  );
}

/* ── 인라인 스타일 (독립 도구, 전역 CSS 오염 없이) ── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0c2233",
    color: "#e8f4fb",
    padding: "24px 16px 60px",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  container: { maxWidth: 560, margin: "0 auto" },
  title: { fontSize: 26, fontWeight: 900, margin: "0 0 8px" },
  subtitle: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "#9fc3d8",
    margin: "0 0 20px",
  },
  row: { display: "flex", gap: 8, marginBottom: 16 },
  urlInput: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #2c5570",
    background: "#0f2c40",
    color: "#e8f4fb",
    fontSize: 13,
  },
  btn: {
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    background: "#1a9edb",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  clockBox: {
    textAlign: "center",
    margin: "8px 0",
    fontFamily: "ui-monospace, Menlo, monospace",
  },
  clock: { fontSize: 44, fontWeight: 900, color: "#ffef3e" },
  clockUnit: { fontSize: 16, color: "#9fc3d8", marginLeft: 8 },
  progressTrack: {
    position: "relative",
    height: 32,
    background: "#0f2c40",
    borderRadius: 8,
    margin: "12px 0",
    cursor: "pointer",
    overflow: "hidden",
    border: "1px solid #2c5570",
  },
  progressFill: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    background: "rgba(26,158,219,0.35)",
    pointerEvents: "none",
  },
  marker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    background: "#ff8a5c",
    transform: "translateX(-50%)",
    pointerEvents: "none",
  },
  controls: {
    display: "flex",
    justifyContent: "center",
    gap: 10,
    margin: "8px 0",
  },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    border: "1px solid #2c5570",
    background: "#0f2c40",
    color: "#e8f4fb",
    fontSize: 20,
    cursor: "pointer",
  },
  playBtn: { background: "#1a9edb", border: "none", width: 60, height: 60 },
  rateRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    margin: "12px 0",
  },
  rateLabel: { fontSize: 13, color: "#9fc3d8", marginRight: 4 },
  rateBtn: {
    padding: "6px 14px",
    borderRadius: 8,
    border: "1px solid #2c5570",
    background: "#0f2c40",
    color: "#e8f4fb",
    fontSize: 13,
    cursor: "pointer",
  },
  rateBtnActive: { background: "#1a9edb", border: "none", fontWeight: 700 },
  stampBtn: {
    width: "100%",
    padding: "18px 0",
    borderRadius: 12,
    border: "none",
    background: "#e8562c",
    color: "#fff",
    fontSize: 18,
    fontWeight: 900,
    cursor: "pointer",
    margin: "12px 0 20px",
    boxShadow: "0 4px 0 #b23e1a",
  },
  listHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 14,
    marginBottom: 8,
  },
  clearBtn: {
    padding: "5px 12px",
    borderRadius: 6,
    border: "1px solid #7a3030",
    background: "transparent",
    color: "#ff9a8a",
    fontSize: 12,
    cursor: "pointer",
  },
  list: {
    maxHeight: 260,
    overflowY: "auto",
    background: "#0f2c40",
    borderRadius: 10,
    padding: 8,
    marginBottom: 20,
  },
  empty: { textAlign: "center", color: "#6b8ba0", padding: "20px 0", fontSize: 13 },
  noteRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 4px",
    borderBottom: "1px solid #1a3a4f",
  },
  noteIdx: {
    width: 28,
    fontSize: 12,
    color: "#6b8ba0",
    textAlign: "right",
  },
  noteTime: {
    flex: 1,
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 15,
    fontWeight: 700,
  },
  miniBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    border: "1px solid #2c5570",
    background: "#123449",
    color: "#e8f4fb",
    fontSize: 14,
    cursor: "pointer",
  },
  delBtn: { color: "#ff9a8a", borderColor: "#7a3030" },
  outputHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 14,
    marginBottom: 8,
  },
  copyBtn: {
    padding: "6px 16px",
    borderRadius: 8,
    border: "none",
    background: "#4db6a0",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  output: {
    width: "100%",
    background: "#0f2c40",
    color: "#c9f2e6",
    border: "1px solid #2c5570",
    borderRadius: 10,
    padding: 12,
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: 13,
    resize: "vertical",
    boxSizing: "border-box",
  },
  details: { marginTop: 20 },
  summary: { cursor: "pointer", fontSize: 14, color: "#9fc3d8" },
  importHint: { fontSize: 12, color: "#6b8ba0", lineHeight: 1.5 },
  importArea: {
    width: "100%",
    background: "#0f2c40",
    color: "#e8f4fb",
    border: "1px solid #2c5570",
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    boxSizing: "border-box",
    marginBottom: 8,
  },
};