// components/noticeboard/widgets/NowPlayingWidget.tsx
// ═══════════════════════════════════════════════════════════════════
// Now Playing 플레이어 (유튜브 IFrame Player API)
// ═══════════════════════════════════════════════════════════════════
//
// 방식: enablejsapi=1 로 임베드하고 YT.Player 로 감싸 JS 제어.
//   · 커스텀 볼륨 슬라이더 제공(위젯이 작아 유튜브 내장 슬라이더 접근이
//     어렵다는 피드백 반영).
//   · 초기 볼륨을 낮게(DEFAULT_VOLUME) 설정 → "기본 소리가 크다" 피드백 반영.
//   · 음소거 토글.
//
// 재생: autoplay 안 함. 사용자가 재생 눌러야 시작(브라우저 정책·UX).
//
// 주의(모바일): iOS/안드로이드 브라우저는 setVolume 이 무시되고 하드웨어
//   볼륨만 적용된다(유튜브/브라우저 정책). 슬라이더는 표시하되 모바일에선
//   효과가 없을 수 있어 안내 문구를 둔다.
//
// 곡: 緑黄色社会 『Mela!』  video id: aRDURmIYBZ4
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import styles from "./SideWidgets.module.css";
import { loadYouTubeIframeAPI } from "@/lib/youtube-iframe-api";

/* 초기 볼륨(0~100). 낮게 시작. */
const DEFAULT_VOLUME = 30;

type Props = {
  videoId?: string;
  title?: string;
  singer?: string;
};

/* YT.Player 최소 타입(우리가 쓰는 메서드만). */
type YTPlayer = {
  setVolume: (v: number) => void;
  getVolume: () => number;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  destroy: () => void;
};

export default function NowPlayingWidget({
  videoId = "aRDURmIYBZ4",
  title = "Mela!",
  singer = "緑黄色社会 (Ryokuoushoku Shakai)",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);   // YT.Player 가 붙을 컨테이너
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);

  /* 플레이어 생성 (마운트 시 1회). */
  useEffect(() => {
    let cancelled = false;

    loadYouTubeIframeAPI().then(() => {
      if (cancelled || !hostRef.current) return;

      const w = window as unknown as {
        YT: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };
      };

      playerRef.current = new w.YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          // autoplay 미지정(사용자 재생). 필요 시 여기서 조정.
        },
        events: {
          onReady: (e: { target: YTPlayer }) => {
            if (cancelled) return;
            // 초기 볼륨 낮게 설정 + 현재 상태로 UI 동기화.
            e.target.setVolume(DEFAULT_VOLUME);
            setVolume(DEFAULT_VOLUME);
            setMuted(e.target.isMuted());
            setReady(true);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      // 언마운트 정리(사고 방지: 남은 player 파괴).
      try {
        playerRef.current?.destroy();
      } catch {
        /* 이미 파괴됐거나 준비 전 — 무시 */
      }
      playerRef.current = null;
    };
    // videoId 바뀌면 재생성.
  }, [videoId]);

  /* 볼륨 슬라이더 변경. */
  const onVolumeChange = useCallback((v: number) => {
    setVolume(v);
    const p = playerRef.current;
    if (!p) return;
    p.setVolume(v);
    // 볼륨을 0보다 크게 올리면 음소거 해제.
    if (v > 0 && p.isMuted()) {
      p.unMute();
      setMuted(false);
    }
  }, []);

  /* 음소거 토글. */
  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) {
      p.unMute();
      setMuted(false);
      // 음소거 해제 시 볼륨이 0이면 기본값으로 살짝 올림.
      if (volume === 0) {
        p.setVolume(DEFAULT_VOLUME);
        setVolume(DEFAULT_VOLUME);
      }
    } else {
      p.mute();
      setMuted(true);
    }
  }, [volume]);

  return (
    <div className={styles.player}>
      {/* 헤더: 곡 라벨 + 제목 (YouTube 출처 명시 — YouTube API 정책 준수) */}
      <div className={styles.playerHeader}>
        <div className={styles.playerLabelRow}>
          <span className={styles.playerLabel}>Now Playing</span>
          <a
            className={styles.ytAttribution}
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            title="YouTube에서 보기"
          >
            ▶ YouTube
          </a>
        </div>
        <div className={styles.playerTitle}>{title}</div>
        <div className={styles.playerSingerHead}>{singer}</div>
      </div>

      {/* 유튜브 임베드 (16:9). host div 에 YT.Player 가 iframe 을 만든다. */}
      <div className={styles.ytWrap}>
        <div ref={hostRef} className={styles.ytFrame} />
      </div>

      {/* 커스텀 볼륨 컨트롤 */}
      <div className={styles.volumeRow}>
        <button
          type="button"
          className={styles.volumeBtn}
          onClick={toggleMute}
          disabled={!ready}
          aria-label={muted ? "음소거 해제" : "음소거"}
        >
          {muted || volume === 0 ? "🔇" : volume < 50 ? "🔉" : "🔊"}
        </button>
        <input
          type="range"
          className={styles.volumeSlider}
          min={0}
          max={100}
          step={1}
          value={muted ? 0 : volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          disabled={!ready}
          aria-label="볼륨"
        />
        <span className={styles.volumeValue}>{muted ? 0 : volume}</span>
      </div>
    </div>
  );
}