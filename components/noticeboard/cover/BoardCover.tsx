// components/noticeboard/cover/BoardCover.tsx
// ═══════════════════════════════════════════════════════════════════
// board 대시보드 커버 (폴더 덮개 위 레이아웃)
// ═══════════════════════════════════════════════════════════════════
//
// 시안(Anima) 커버 재현. board 탭에서만 표시.
// 덮개 콘텐츠 영역 기준 절대위치로 요소 배치.
//
// 구성:
//   좌측 상단 : NoticeBoardList (노트 모양 · UPDATE · 필터 · 리스트 · 팝업)
//   좌측 하단 : AttendanceCard (출석 커맨드)
//   우측      : CoverDecorations (D-day · 如月 · 이벤트 배너)
//
// 각 컴포넌트가 자기 모양·상태·요소를 캡슐화하므로
// 여기서는 위치와 폭만 잡는다.
// ═══════════════════════════════════════════════════════════════════

"use client";

import type { CSSProperties } from "react";
import NoticeBoardList from "../panels/NoticeBoardList";
import AttendanceCard from "../panels/AttendanceCard";
import CoverDecorations from "./CoverDecorations";

type Props = {
  onOpenLogin: () => void;
  onToast: (msg: string) => void;
};

export default function BoardCover({ onOpenLogin, onToast }: Props) {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* ── 좌측 상단: 공지 노트 ── */}
      <div style={noticeSlotStyle}>
        <NoticeBoardList />
      </div>

      {/* ── 좌측 하단: 출석 ── */}
      <div style={attendanceSlotStyle}>
        <AttendanceCard onOpenLogin={onOpenLogin} onToast={onToast} />
      </div>

      {/* ── 우측: 장식 (D-day · 如月 · 이벤트) ── */}
      <CoverDecorations />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 스타일 (덮개 콘텐츠 영역 기준 절대위치)
// 각 슬롯은 자식 컴포넌트가 알아서 자기 모양을 채운다.
// ═══════════════════════════════════════════════════════════════════

const noticeSlotStyle: CSSProperties = {
  position: "absolute",
  top: 20,
  left: 40,      // 폴더 좌측에서 좀 더 안쪽으로
  width: 420,
};

const attendanceSlotStyle: CSSProperties = {
  position: "absolute",
  top: 300,
  left: 40,      // 공지와 같은 좌측 정렬
  width: 420,
};