// components/noticeboard/FolderStage.tsx
// ═══════════════════════════════════════════════════════════════════
// 폴더 스테이지 — 시안(Anima) 폴더 3층 구조
// ═══════════════════════════════════════════════════════════════════
//
// 레이어 (뒤 → 앞):
//   1) 프레임  : 폴더 겉표지 바닥면. 모든 탭에서 항상 표시 (공유 배경).
//   2) 내지    : 흰 종이. board 가 아닐 때, 그 위에 문서(공지/월드/…).
//   3) 덮개    : 폴더 앞커버. board 일 때만 표시, 그 위에 대시보드.
//
// 동작:
//   tab === "board"  → 프레임 + 덮개 + children(대시보드)   [덮개 위]
//   tab !== "board"  → 프레임 + 내지 + children(문서)        [내지 위]
//
// ── 위치·크기 조정 ──
//   아래 LAYOUT 상수만 바꾸면 폴더 전체 위치·크기가 조정된다.
//   실제 화면 띄워보며 FRAME_LEFT / FRAME_TOP / FRAME_W 를 조정할 것.
//   내지·덮개는 프레임 기준 상대 좌표(원본 SVG 좌표 비율)로 자동 정렬되므로
//   대개 프레임만 옮기면 따라온다.
//
// 좌표계: 부모 스테이지(1366×768) 기준 px. 이 컴포넌트는 그 위에 absolute.
// ═══════════════════════════════════════════════════════════════════

"use client";

import type { CSSProperties, ReactNode } from "react";

// ── SVG 원본 크기 (조정 금지, 비율 계산 기준) ──────────────
const FRAME_SVG_W = 976;
const FRAME_SVG_H = 850;
const COVER_SVG_W = 968;
const COVER_SVG_H = 729;
const PAPER_SVG_W = 915;
const PAPER_SVG_H = 720;

// ── 프레임 배치 (여기를 조정) ──────────────────────────────
//   시안 기준 초기값. 스테이지(1366×768) 안에서 중앙~상단.
//   폴더 프레임 폭을 스테이지의 약 700px 로 축소해 넣음(비율 유지).
const FRAME_LEFT = 365;
const FRAME_TOP  = 60;
const FRAME_W    = 780;

// 프레임 렌더 스케일 (원본 → 렌더)
const K = FRAME_W / FRAME_SVG_W;
const FRAME_H = FRAME_SVG_H * K;

// ── 내지/덮개의 프레임 내부 상대 위치 (원본 SVG 좌표) ──────
const PAPER_OFFSET_X = 30;
const PAPER_OFFSET_Y = 90;
//   덮개(968) 
const COVER_OFFSET_X = 4;
const COVER_OFFSET_Y = 112;

// ── SVG (data-uri 인라인) ──────────────────────────────────
const FRAME_SVG =
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg width="976" height="850" viewBox="0 0 976 850" fill="none" xmlns="http://www.w3.org/2000/svg"><g filter="url(#f)"><path d="M951.5 65H321.422C313.815 65 306.866 60.684 303.494 53.8645L282.615 11.6356C279.243 4.81605 272.294 0.5 264.686 0.5H24.5C13.4543 0.5 4.5 9.45431 4.5 20.5L4.50006 821C4.50006 832.046 13.4544 841 24.5001 841H951.5C962.546 841 971.5 832.046 971.5 821V85C971.5 73.9543 962.546 65 951.5 65Z" fill="#CCE3F8" stroke="black"/></g><defs><filter id="f" x="0" y="0" width="976" height="849.5" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="bg"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="a"/><feOffset dy="4"/><feGaussianBlur stdDeviation="2"/><feComposite in2="a" operator="out"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/><feBlend mode="normal" in2="bg" result="e"/><feBlend mode="normal" in="SourceGraphic" in2="e"/></filter></defs></svg>`
  );

const COVER_SVG =
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg width="968" height="729" viewBox="0 0 968 729" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 56.3668H651.388C658.568 56.3668 665.197 52.5177 668.757 46.2819L689.134 10.5848C692.694 4.34905 699.323 0.5 706.504 0.5H947.5C958.546 0.5 967.5 9.45432 967.5 20.5L967.5 708.5C967.5 719.546 958.546 728.5 947.5 728.5H20.5C9.45428 728.5 0.5 719.546 0.5 708.5V76.3668C0.5 65.3211 9.45428 56.3668 20.5 56.3668Z" fill="#CCE3F8" stroke="black"/></svg>`
  );

// 내지는 단순 흰 rect → SVG 대신 div 로 그려도 되지만,
// 원본과 동일하게 유지하기 위해 SVG 유지.
const PAPER_SVG =
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg width="915" height="720" viewBox="0 0 915 720" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="0.5" width="914" height="719" rx="9.5" fill="white" stroke="black"/></svg>`
  );

type Props = {
  isBoard: boolean;   // true = 덮개(대시보드), false = 내지(문서)
  children: ReactNode;
};

export default function FolderStage({ isBoard, children }: Props) {
  // 프레임 컨테이너
  const frameStyle: CSSProperties = {
    position: "absolute",
    left: FRAME_LEFT,
    top: FRAME_TOP,
    width: FRAME_W,
    height: FRAME_H,
    zIndex: 10,
  };

  // 프레임 배경 이미지 (맨 뒤)
  const frameImgStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundImage: `url("${FRAME_SVG}")`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
  };

  // 내지 (흰 종이) — board 아닐 때
  const paperStyle: CSSProperties = {
    position: "absolute",
    left: PAPER_OFFSET_X * K,
    top: PAPER_OFFSET_Y * K,
    width: PAPER_SVG_W * K,
    height: PAPER_SVG_H * K,
    backgroundImage: `url("${PAPER_SVG}")`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
  };

  // 덮개 — board 일 때
  const coverStyle: CSSProperties = {
    position: "absolute",
    left: COVER_OFFSET_X * K,
    top: COVER_OFFSET_Y * K,
    width: COVER_SVG_W * K,
    height: COVER_SVG_H * K,
    backgroundImage: `url("${COVER_SVG}")`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
  };

  // 콘텐츠 슬롯 — 내지/덮개 위에 얹힘. 스크롤 가능.
  //   board: 덮개 영역에 맞춤 / 그 외: 내지 영역에 맞춤
  const contentBox = isBoard
    ? { left: COVER_OFFSET_X * K, top: COVER_OFFSET_Y * K, width: COVER_SVG_W * K, height: COVER_SVG_H * K }
    : { left: PAPER_OFFSET_X * K, top: PAPER_OFFSET_Y * K, width: PAPER_SVG_W * K, height: PAPER_SVG_H * K };

  const contentStyle: CSSProperties = {
    position: "absolute",
    ...contentBox,
    padding: "28px 34px",
    overflow: isBoard ? "hidden" : "auto",
    zIndex: 2,
  };

  return (
    <div style={frameStyle}>
      {/* 1) 프레임 (항상) */}
      <div style={frameImgStyle} />

      {/* 2) 내지 or 3) 덮개 */}
      <div style={paperStyle} />

      {/* 3) 덮개 — board 일 때만 내지 위에 덮임 */}
      {isBoard ? <div style={coverStyle} /> : null}

      {/* 콘텐츠 (내지/덮개 위) */}
      <div style={contentStyle}>{children}</div>
    </div>
  );
}