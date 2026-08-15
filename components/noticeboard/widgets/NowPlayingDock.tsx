// components/noticeboard/widgets/NowPlayingDock.tsx
// ═══════════════════════════════════════════════════════════════════
// Now Playing 도크 — 뷰포트 오른쪽 아래 고정, 화면 바닥에서 올라오는 플레이어
// ═══════════════════════════════════════════════════════════════════
//
// 배치: 스테이지(1366×768 scale) 밖 = 뷰포트 기준. 스케일 영향 안 받고
//   항상 화면 오른쪽 아래에 붙는다. NoticeBoard 의 뷰포트 셸 직속으로 렌더.
//
// 동작:
//   평소   → 위젯이 아래로 내려가 화면 바닥 밖으로 대부분 나가고 위쪽만 빼꼼.
//   hover  → 위젯 전체가 위로 쏙 올라옴.
//
// ── 덜컹거림(hover flicker) 방지 원리 ──
//   hover 판정은 "고정 크기 도크 컨테이너"가 담당(위젯 자체가 아님).
//   도크는 위젯의 올라온 상태까지 덮는 고정 높이라, 위젯이 어느 위치든
//   마우스는 도크 안 → hover 안 풀림. 위젯만 도크 안에서 transform 으로
//   오르내린다. overflow:hidden + bottom:0 → 파묻힌 부분이 화면 바닥 밖으로.
//
// 배치(뷰포트 기준)는 아래 상수로 조정. 화면 보며 미세조정.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useState, type CSSProperties } from "react";
import NowPlayingWidget from "./NowPlayingWidget";

// ── 배치 (뷰포트 기준) ── 화면 보며 조정
const DOCK_RIGHT = 40;    // 화면 오른쪽 끝에서 떨어진 거리
const DOCK_W     = 280;   // 플레이어 폭
const WIDGET_H   = 250;   // 플레이어 대략 높이(헤더 + 유튜브 16:9 + 여백)
const PEEK       = 52;    // 평소 노출 높이(헤더만 빼꼼)

type Props = {
  title?: string;
  singer?: string;
  albumArtUrl?: string;
};

export default function NowPlayingDock(props: Props) {
  const [open, setOpen] = useState(false);

  // 도크: 뷰포트 오른쪽 아래 고정. 화면 바닥(bottom:0)에 하단이 붙음.
  //   높이 = 위젯 높이(올라온 상태를 다 덮음). hover 트리거 + clip.
  const dockStyle: CSSProperties = {
    position: "absolute",
    right: DOCK_RIGHT,
    bottom: 0,
    width: DOCK_W,
    height: WIDGET_H,
    overflow: "hidden",   // 파묻힌 부분(화면 바닥 밖)을 잘라냄
    zIndex: 30,          // MyPanel 서랍(40)보다 아래 → 마이패널 열리면 그 밑으로.
  };

  // 위젯 래퍼: 평소 아래로 내려가 화면 밖으로(PEEK 만 노출), hover 시 원위치.
  const slideStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    transform: open ? "translateY(0)" : `translateY(${WIDGET_H - PEEK}px)`,
    transition: "transform 0.32s cubic-bezier(.22,.9,.3,1)",
    padding: "0 8px",
  };

  return (
    <div
      style={dockStyle}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div style={slideStyle}>
        <NowPlayingWidget {...props} />
      </div>
    </div>
  );
}