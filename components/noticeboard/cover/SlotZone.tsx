// components/noticeboard/cover/SlotZone.tsx
// ═══════════════════════════════════════════════════════════════════
// board 커버 우측 하단 "슬롯 구역" — 정적 배치 전용
// ═══════════════════════════════════════════════════════════════════
//
// 이 컴포넌트는 마테·배경 같은 정적 장식만 얹는다.
// 슬롯머신 게임(동적: 릴 회전·결과 등)은 별도 컴포넌트로 분리 예정이며,
// 여기(zoneStyle 안)에 자식으로 얹으면 된다.
//
// 좌표계: 덮개 콘텐츠 영역 기준 절대위치 (CoverDecorations 와 동일).
// 위치·크기 조정은 각 스타일의 top/right/width/height 만 수정.
//
// 마테 3종 (public/svg):
//   · slot-mat-stack : 파랑+분홍+노랑 3겹 (드롭섀도우 포함, 319×462)
//   · slot-mat-blue  : 파랑 단색 띠 (286×84)
//   · slot-mat-pink  : 분홍 단색 띠 (296×100)
//
// z 순서 (뒤 → 앞): stack → blue → pink → (추후 슬롯머신/토끼/글씨)
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import SlotCabinetPop from "./SlotCabinetPop";

export default function SlotZone() {
  const [faceIdx, setFaceIdx] = useState(0);
  const shuffleFace = () => {
    setFaceIdx((prev) => {
      if (FACES.length <= 1) return prev;
      let next = prev;
      while (next === prev) next = Math.floor(Math.random() * FACES.length);
      return next;
    });
  };

  useEffect(() => {
    if (document.getElementById("slotzone-face-css")) return;
    const el = document.createElement("style");
    el.id = "slotzone-face-css";
    el.textContent = `@keyframes slotzone-face-pulse{
      0%,100%{ transform: rotate(-6.25deg) scale(1); }
      50%    { transform: rotate(-6.25deg) scale(1.12); }
    }`;
    document.head.appendChild(el);
  }, []);

  return (
    <div style={zoneStyle}>
      {/* 맨 뒤: 3겹 마테 */}
      <img src="/svg/slot-mat-stack.svg" alt="" style={matStackStyle} />


    <div key={faceIdx} style={faceStyle}>{FACES[faceIdx]}</div>
      <div style={slotWrapStyle}>
        <SlotCabinetPop onSpinStart={shuffleFace} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 스타일 
// ────────────────────────────────────────────────────────────────────

// 표정 6종
const FACES = ["//G_G//", "//^o^//", "//>_<//", "//˘v˘//", "//O_O//", "//^3^//"];

// 구역 전체 래퍼
const zoneStyle: CSSProperties = {
  position: "absolute",
  top: 250,        
  right: 20,
  width: 330,
  height: 300,
  overflow: "hidden", 
};

// 맨 뒤 3겹 마테 
const matStackStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 15,
  width: 250,
  height: 434,     
  zIndex: 1,
  pointerEvents: "none",
};

// 파랑 띠 
const matBlueStyle: CSSProperties = {
  position: "absolute",
  top: 150,
  right: 40,
  width: 240,
  height: 71,     
  zIndex: 2,
  pointerEvents: "none",
};

// 분홍 띠 
const matPinkStyle: CSSProperties = {
  position: "absolute",
  top: 250,
  right: 30,
  width: 250,
  height: 84,       
  zIndex: 3,
  pointerEvents: "none",
};

const slotWrapStyle: CSSProperties = {
  position: "absolute",
  top: 110,           
  right: 3,
  transform: "rotate(8deg) scale(0.34)",  
  transformOrigin: "top right",            
  zIndex: 4,          
  pointerEvents: "auto", 
};

const faceStyle: CSSProperties = {
  position: "absolute",
  top: 123,           
  right: 130,
  fontFamily: "'LOTTERIA CHAB', sans-serif",
  fontSize: 24,
  lineHeight: "34px",
  color: "#1A335E",
  textTransform: "uppercase",
  WebkitTextStroke: "10px #FFFFFF",
  paintOrder: "stroke",   
  textShadow: "0px 2px 4px rgba(0,0,0,0.1)",
  transform: "rotate(-6.25deg)",   
  whiteSpace: "nowrap",
  pointerEvents: "none",
  zIndex: 5,        
  animation: "slotzone-face-pulse 1.1s ease-in-out infinite",
};