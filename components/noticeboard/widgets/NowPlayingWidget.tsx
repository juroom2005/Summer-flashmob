// components/noticeboard/widgets/NowPlayingWidget.tsx
// ═══════════════════════════════════════════════════════════════════
// Now Playing 플레이어 (유튜브 임베드)
// ═══════════════════════════════════════════════════════════════════
//
// 방식 1: 유튜브 iframe 을 그대로 넣고 유튜브 자체 컨트롤 사용.
//   커스텀 컨트롤(재생/이전/다음/랜덤/반복)·CD 원·자체 진행바는 제거.
//   헤더(Now Playing + 곡 제목)만 유지.
//
// 자동재생 안 함(autoplay 미지정) → hover 로 올라온 뒤 유튜브 재생 버튼을
//   눌러야 재생. 곡 한 곡이라 플레이리스트·이전/다음 없음.
//
// 곡: 緑黄色社会 『Mela!』 (Ryokuoushoku Shakai – Mela!)  video id: aRDURmIYBZ4
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./SideWidgets.module.css";

type Props = {
  videoId?: string;
  title?: string;
  singer?: string;
};

export default function NowPlayingWidget({
  videoId = "aRDURmIYBZ4",
  title = "Mela!",
  singer = "緑黄色社会 (Ryokuoushoku Shakai)",
}: Props) {
  // enablejsapi 없이 기본 임베드. autoplay 미지정 = 자동재생 안 함.
  // rel=0(관련영상 최소), modestbranding=1(로고 최소).
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;

  return (
    <div className={styles.player}>
      {/* 헤더: 곡 라벨 + 제목 */}
      <div className={styles.playerHeader}>
        <div className={styles.playerLabel}>Now Playing</div>
        <div className={styles.playerTitle}>{title}</div>
        <div className={styles.playerSingerHead}>{singer}</div>
      </div>

      {/* 유튜브 임베드 (16:9) */}
      <div className={styles.ytWrap}>
        <iframe
          className={styles.ytFrame}
          src={src}
          title={`${title} - ${singer}`}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    </div>
  );
}