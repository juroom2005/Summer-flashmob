// components/noticeboard/FolderStage.tsx
// ═══════════════════════════════════════════════════════════════════
// 폴더 스테이지 — 시안(Anima) 폴더 3층 구조 + 좌측 북마크(NavRail)
// ═══════════════════════════════════════════════════════════════════
//
// 쌓임 순서는 z-index 를 쓰지 않고 DOM 순서로만 만든다(원본 방식 유지).
// 뒤 → 앞(DOM 순서):
//   1) 북마크(NavRail)  ← 맨 먼저 = 맨 뒤. 프레임에 오른쪽이 가려짐.
//   2) 프레임           ← 북마크를 덮는 폴더 겉면
//   3) 내지            ← 프레임 위. 항상 표시(흰 종이).
//   3') 덮개           ← board 일 때만 내지 위에 얹음.
//   4) 콘텐츠           ← 내지/덮개 위 실제 내용
//
//   시안 요구(겹침): "프레임 > 북마크", "내지/덮개 > 프레임". 위 DOM 순서가
//   두 관계를 동시에 만족. 북마크(폴더 왼쪽 밖)와 내지(폴더 안쪽)는 서로
//   안 겹치므로 사이에 프레임이 껴도 시각 충돌 없음.
//
//   ※ z-index 를 섞지 않는 이유: 자식 일부에만 z-index 를 주면 stacking
//     context 가 갈려 예기치 않게 내지가 프레임 뒤로 숨는 문제가 났었음.
//     DOM 순서 단일 규칙이 가장 안전. 프레임 img 는 pointerEvents:none 이라
//     뒤 북마크의 삐져나온 부분 클릭이 통과해 정상 동작.
//
// 동작:
//   내지는 항상 그림(board 에서도 흰 종이가 보여야 함).
//   tab === "board"  → 북마크 + 프레임 + 내지 + 덮개(내지 위) + children(대시보드)
//   tab !== "board"  → 북마크 + 프레임 + 내지 + children(문서)
//
// ── 세로 점프(덜컹거림) 방지 ──
//   콘텐츠 슬롯의 top/height 를 board/내지 공통 고정값으로 둔다.
//   (예전엔 isBoard 로 내지↔덮개 영역을 통째로 바꿔 top 이 +17.6px 튀었고,
//    가로 슬라이드와 겹쳐 "구조물이 세로로 쑥 내려갔다 올라오는" 덜컹거림 발생.)
//   좌우(left/width)는 board/내지 각자 유지 → 가로 슬라이드 애니메이션은 그대로.
//
// ── 위치·크기 조정 ──
//   아래 LAYOUT 상수만 바꾸면 폴더 전체 위치·크기가 조정된다.
//   실제 화면 띄워보며 FRAME_LEFT / FRAME_TOP / FRAME_W 를 조정할 것.
//   북마크(NavRail)는 프레임 기준 상대좌표(RAIL_LEFT/RAIL_TOP)로 붙으므로
//   프레임을 옮기면 탭도 함께 따라온다.
//
// 좌표계: 부모 스테이지(1366×768) 기준 px. 이 컴포넌트는 그 위에 absolute.
// ═══════════════════════════════════════════════════════════════════

"use client";

import type { CSSProperties, ReactNode } from "react";
import NavRail, { type Tab } from "./NavRail";

// ── SVG 원본 크기 (조정 금지, 비율 계산 기준) ──────────────
const FRAME_SVG_W = 976;
const FRAME_SVG_H = 850;
const COVER_SVG_W = 968;
const COVER_SVG_H = 729;
const PAPER_SVG_W = 915;
const PAPER_SVG_H = 720;

// ── 프레임 배치 (여기를 조정) ──────────────────────────────
//   시안 기준 초기값. 스테이지(1366×768) 안에서 중앙~상단.
//   폴더 프레임 폭을 스테이지의 약 780px 로 축소해 넣음(비율 유지).
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

// ── 북마크(NavRail) 프레임 내부 상대 위치 ──────────────────
//   프레임 왼쪽 모서리(렌더상 상대 x≈3.6)에 탭 오른쪽이 물리도록
//   왼쪽 밖으로 삐져나오게 둔다. 탭 폭 132 기준 겹침 약 19px.
//   음수 = 프레임 왼쪽 경계보다 바깥.
const RAIL_LEFT = -113;
const RAIL_TOP  = 58;

// ── 콘텐츠 슬롯 세로 고정값 (덜컹거림 방지) ────────────────
//   덮개 기준으로 고정(대시보드가 실제로 놓이는 영역).
//   내지 문서는 top 이 약 17px 위로 올라오지만 문서 자체 여백으로 흡수됨.
const CONTENT_TOP = COVER_OFFSET_Y * K;
const CONTENT_H   = COVER_SVG_H * K;

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
  isBoard: boolean;                 // true = 덮개(대시보드), false = 내지(문서)
  activeTab: Tab;                   // 좌측 북마크 현재 탭
  onTabClick: (key: Tab) => void;   // 탭 클릭 핸들러
  children: ReactNode;
};

export default function FolderStage({
  isBoard,
  activeTab,
  onTabClick,
  children,
}: Props) {
  // 프레임 컨테이너
  const frameStyle: CSSProperties = {
    position: "absolute",
    left: FRAME_LEFT,
    top: FRAME_TOP,
    width: FRAME_W,
    height: FRAME_H,
    zIndex: 10,
  };

  // 프레임 배경 이미지 — 북마크(앞서 렌더=뒤)를 덮음.
  //   pointerEvents:none → 뒤 북마크의 삐져나온 부분 클릭을 막지 않음.
  const frameImgStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundImage: `url("${FRAME_SVG}")`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
    pointerEvents: "none",
  };

  // 북마크(NavRail) 래퍼 — DOM 상 맨 먼저 = 맨 뒤. z-index 없음.
  const railWrapStyle: CSSProperties = {
    position: "absolute",
    left: RAIL_LEFT,
    top: RAIL_TOP,
  };

  // 내지 (흰 종이) — board 아닐 때. z-index 없음(DOM 순서로 프레임 위).
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

  // 덮개 — board 일 때. z-index 없음.
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

  // 콘텐츠 슬롯 — 내지/덮개 위에 얹힘(DOM 상 맨 마지막 = 맨 앞).
  //   세로(top/height)는 고정 → board↔내지 전환 시 세로 점프 없음.
  //   좌우(left/width)만 board/내지 각각 → 가로 슬라이드 애니메이션 유지.
  const contentBoxX = isBoard
    ? { left: COVER_OFFSET_X * K, width: COVER_SVG_W * K }
    : { left: PAPER_OFFSET_X * K, width: PAPER_SVG_W * K };

  const contentStyle: CSSProperties = {
    position: "absolute",
    top: CONTENT_TOP,
    height: CONTENT_H,
    ...contentBoxX,
    padding: "28px 34px",
    overflow: isBoard ? "hidden" : "auto",
  };

  return (
    <div style={frameStyle}>
      {/* 1) 북마크 (맨 뒤) — 프레임에 오른쪽이 가려짐 */}
      <div style={railWrapStyle}>
        <NavRail activeTab={activeTab} onTabClick={onTabClick} />
      </div>

      {/* 2) 프레임 — 북마크를 덮는 폴더 겉면 */}
      <div style={frameImgStyle} />

      {/* 3) 내지 — 항상 그림(board 에서도 흰 종이가 보여야 함) */}
      <div style={paperStyle} />

      {/* 3') 덮개 — board 일 때만 내지 위에 얹음 */}
      {isBoard ? <div style={coverStyle} /> : null}

      {/* 4) 콘텐츠 — 내지/덮개 위 (맨 앞) */}
      <div style={contentStyle}>{children}</div>
    </div>
  );
}