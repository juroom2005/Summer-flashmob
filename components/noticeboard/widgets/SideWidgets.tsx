// components/noticeboard/widgets/SideWidgets.tsx
// ═══════════════════════════════════════════════════════════════════
// 좌측 사이드 위젯 묶음 (폴더 왼쪽 바깥, NavRail 아래 세로 배치)
// ═══════════════════════════════════════════════════════════════════
//
// 시안: 위에서부터 연습일지(핑크) · 날씨(파랑).
//   (Now Playing 은 폴더 오른쪽 바깥 슬롯머신 옆으로 분리 → NowPlayingDock)
// 각 위젯은 자기 모양을 캡슐화. 여기서는 세로로 쌓고 위치만 잡는다.
//
// 위치(스테이지 1366×768 절대좌표)는 아래 컨테이너 스타일에서 조정.
// 화면 보며 left/top 미세조정.
//
// 동적 기능(연습일지 클릭·날씨 GM 지정 등)은 추후. 지금은 모양만.
// ═══════════════════════════════════════════════════════════════════

"use client";

import type { CSSProperties } from "react";
import PracticeLogWidget from "./PracticeLogWidget";
import WeatherWidget from "./WeatherWidget";

// ── 배치 (스테이지 절대좌표) ── 화면 보며 조정
const WRAP_LEFT = 200;
const WRAP_TOP  = 530;
const WRAP_W    = 155;

type Props = {
  onPracticeLog?: () => void;
};

export default function SideWidgets({ onPracticeLog }: Props) {
  const wrapStyle: CSSProperties = {
    position: "absolute",
    left: WRAP_LEFT,
    top: WRAP_TOP,
    width: WRAP_W,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    zIndex: 8,
  };

  return (
    <div style={wrapStyle}>
      <PracticeLogWidget onClick={onPracticeLog} />
      <WeatherWidget />
    </div>
  );
}