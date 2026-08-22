// components/noticeboard/panels/gift/GiftInboxModal.tsx
//
// 선물함(받은 선물) 모달. 매점 헤더의 "선물함" 버튼으로 연다.
//
// 동작:
//   · 열릴 때 list_my_gifts 로 받은 선물 목록 로드(최신순).
//   · 동시에 mark_gifts_read 로 전체 읽음 처리 → 배지 사라짐.
//     (onRead 콜백으로 상위 배지 카운트 갱신)
//   · 각 행: 보낸 사람 · 내용(모빌 N 🪙 / 아이템명 N개) · 받은 시각 · 안읽음 점.
//
// 안전:
//   · ModalPortal 필수(transform:scale 회피).
//   · 조회/읽음 실패해도 조용히 빈 목록/무동작(운영 사고 방지).
//
// 디자인: GiftModal 과 동일 토큰.

"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import ModalPortal from "../ModalPortal";
import useModalKeys from "@/components/shared/useModalKeys";
import { useModalA11y } from "@/lib/useModalA11y";
import {
  listMyGifts,
  markGiftsRead,
  type ReceivedGift,
} from "@/lib/gift-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";
const C = {
  primary:    "#3f88f9",
  textStrong: "#1a335e",
  textMid:    "#14406f",
  textDim:    "#7fb3d4",
  bgCard:     "#ffffff",
  border:     "#cfe2fb",
  danger:     "#ff6f7f",
  unread:     "#3f88f9",
  unreadBg:   "#eaf2ff",
};

/** 상대 시각 표기(간단). */
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

/** 선물 1건의 내용 문구. */
function giftText(g: ReceivedGift): string {
  if (g.kind === "mobil") {
    return `${g.amount.toLocaleString()} 🪙`;
  }
  const name = g.itemName ?? "아이템";
  return `${name} ${g.amount}개`;
}

export type GiftInboxModalProps = {
  onClose: () => void;
  /** 읽음 처리 후 상위 배지 갱신용(안읽음 0 으로). */
  onRead?: () => void;
};

export default function GiftInboxModal({ onClose, onRead }: GiftInboxModalProps) {
  const [gifts,   setGifts]   = useState<ReceivedGift[]>([]);
  const [loading, setLoading] = useState(true);

  // 키보드 접근성: Esc 로 닫기. (읽기 전용이라 Enter 매핑 없음)
  useModalKeys({ onCancel: onClose });

  // 포커스 트랩·초기 포커스·복귀만 보강. Esc 는 위 useModalKeys 가 담당하므로
  // 여기선 closeOnEsc:false 로 꺼서 이중 발동을 막는다.
  const cardRef = useRef<HTMLDivElement>(null);
  useModalA11y(cardRef, { open: true, closeOnEsc: false });

  // onRead 최신값을 참조하되, effect 재실행 트리거로 삼지 않는다.
  // (인라인 콜백이 매 렌더 새 참조라 의존성에 넣으면 반복 로드됨)
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  // 마운트 시 1회: 목록 로드 후 전체 읽음 처리 → 상위 배지 갱신.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const list = await listMyGifts(100);
      if (!alive) return;
      setGifts(list);
      setLoading(false);
      await markGiftsRead();
      onReadRef.current?.();
    })();
    return () => {
      alive = false;
    };
  }, []);

  const overlay: CSSProperties = {
    position: "fixed", inset: 0, zIndex: 9999,
    background: "rgba(20,40,80,0.42)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 16, fontFamily: BODY,
  };
  const card: CSSProperties = {
    width: "min(520px, 94vw)", maxHeight: "88vh",
    background: C.bgCard, borderRadius: 18, border: `1px solid ${C.border}`,
    boxShadow: "0 12px 40px rgba(20,40,80,0.28)",
    display: "flex", flexDirection: "column", overflow: "hidden",
  };
  const header: CSSProperties = {
    padding: "16px 20px", borderBottom: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  };

  return (
    <ModalPortal>
      <div style={overlay} onClick={onClose} role="presentation">
        <div
          ref={cardRef}
          style={card}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="선물함"
        >
          <div style={header}>
            <h2 style={{ fontFamily: JUA, fontSize: 20, color: C.textStrong, margin: 0 }}>
              선물함 🎁
            </h2>
            <button
              onClick={onClose}
              aria-label="닫기"
              style={{
                border: "none", background: "transparent", cursor: "pointer",
                fontSize: 22, color: C.textDim, lineHeight: 1, padding: 4,
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
            {loading ? (
              <p style={{ color: C.textDim, textAlign: "center", padding: "32px 0" }}>
                불러오는 중…
              </p>
            ) : gifts.length === 0 ? (
              <p style={{ color: C.textDim, textAlign: "center", padding: "40px 0", margin: 0 }}>
                아직 받은 선물이 없습니다.
              </p>
            ) : (
              gifts.map((g) => {
                const unread = g.readAt === null;
                return (
                  <div
                    key={g.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 12px", borderRadius: 12,
                      background: unread ? C.unreadBg : "transparent",
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    {/* 안읽음 점 */}
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                        background: unread ? C.unread : "transparent",
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: C.textStrong }}>
                        <strong style={{ fontFamily: JUA, color: C.textMid }}>
                          {g.fromName ?? "누군가"}
                        </strong>
                        님이 보낸 선물
                      </div>
                      <div style={{ fontSize: 15, color: C.primary, marginTop: 2, fontFamily: JUA }}>
                        {giftText(g)}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: C.textDim, flexShrink: 0 }}>
                      {timeAgo(g.createdAt)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}