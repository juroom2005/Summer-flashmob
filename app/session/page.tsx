// app/session/page.tsx
//
// 세션 채팅 라우트. 화면 자체는 components/session-chat/SessionShell 에 있음.
// 공개 게시판 스테이지(NoticeBoard, 고정 폭 스케일)와 분리된 전용 전체화면 레이아웃.
//   · 데스크톱: 방 목록 | 스크립트(넓게) | 채팅
//   · 모바일: 목록 ↔ 방(스크립트/채팅 탭)

import type { Metadata } from "next";
import SessionShell from "@/components/session-chat/SessionShell";

export const metadata: Metadata = {
  title: "세션 채팅 · Summer FlashMob",
  robots: { index: false, follow: false },
};

export default function SessionPage() {
  return <SessionShell />;
}
