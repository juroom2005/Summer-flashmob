// components/noticeboard/cafe/RewardPopup.tsx
// ═══════════════════════════════════════════════════════════════════
// 미니게임 완주 리워드 팝업 (세 카페 게임 공통)
// ═══════════════════════════════════════════════════════════════════
//
// 세 상태를 가진다:
//   1) submitting : playCafeMinigame 호출 중 (로딩 카드)
//   2) 실패       : 서버 예외 (실패 카드)
//   3) 성공       : POS 프린터에서 영수증이 인쇄되어 나오는 연출
//                   (Courier 흑백 영수증 · clip-path 위→아래 인쇄 · 정착 흔들림)
//
// Portal 처리:
//   · 부모 오버레이(.panel) 에 CSS animation transform 이 걸려있어,
//     그 안에서 렌더되면 position:fixed 가 panel 기준으로 잡힘(갇힘).
//   · 이걸 피하려면 이 팝업도 document.body 로 Portal 렌더가 필요하다.
//   · SSR 안전을 위해 mounted 가드.
//
// 성공 영수증 항목 :
//   · 상단  : CAFÉ FLASHMOB / ORDER STATION 헤더
//   · 메타  : DATE (KST 오늘) · ORDER #랜덤(마운트 시 확정) · ITEM 종류
//   · SCORE : 큰 숫자. 100 점이면 PERFECT 도장
//   · 내역  : 기본 보상 / (퍼펙트 보너스) / 표현력·체력 EXP / 지급 모빌 합계
//   · 하단  : THANK YOU! · 남은 횟수 · 톱니 절취선
//   · 액션  : 인쇄 완료 후 페이드인 (다시 하기 / 카페로)
//
// 중요 (세션 J 확정):
//   · "게임 완료 → 리워드 팝업을 봐야 카운트 차감". 카운트 차감은 서버 RPC 담당.
//     이 팝업은 표시 전용. 재시도 로직만 부모에 위임.
//
// props:
//   · result     : playCafeMinigame 반환값. null 이면 제출 중.
//   · score      : 이번 라운드 점수
//   · onClose    : 팝업 닫기 (카페 홈으로)
//   · onRetry    : 다시 하기 (남은 횟수 있을 때만)
//   · canRetry   : 남은 횟수 있는지

"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./RewardPopup.module.css";
import type { PlayResult } from "@/lib/minigame-helpers";

type Props = {
  result:   PlayResult | null;
  score:    number;
  onClose:  () => void;
  onRetry?: () => void;
  canRetry: boolean;
};

export default function RewardPopup({
  result,
  score,
  onClose,
  onRetry,
  canRetry,
}: Props) {
  // Portal 은 클라이언트에서만.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 성공 렌더용 값 (hooks 는 항상 호출되어야 하므로 조건 분기 앞에 배치.
  // 다른 상태일 때는 사용되지 않으나 계산 비용이 적어 무해.)
  const dateStr = useMemo(
    () =>
      new Date().toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    []
  );
  const orderNo = useMemo(() => {
    // 혼동 쉬운 문자(I·O·Q·L) 제외
    const letters = "ABCDEFGHJKMNPRSTUVWXYZ";
    const l = letters[Math.floor(Math.random() * letters.length)];
    const n = String(Math.floor(Math.random() * 900) + 100);
    return `${l}${n}`;
  }, []);

  if (!mounted) return null;

  // ── 제출 중 ──────────────────────────────────────
  let content: React.ReactNode;
  if (result === null) {
    content = (
      <div className={styles.backdrop}>
        <div className={styles.card}>
          <div className={styles.stamp}>⏳</div>
          <div className={styles.headline}>정산 중…</div>
          <div className={styles.scoreLine}>보상을 계산하고 있습니다.</div>
        </div>
      </div>
    );
  } else if (!result.ok) {
    // ── 실패 (서버 예외) ──────────────────────────
    content = (
      <div className={styles.backdrop}>
        <div className={styles.card}>
          <div className={styles.stamp}>⚠️</div>
          <div className={styles.headline}>정산 실패</div>
          <div className={styles.errorBox}>{result.message}</div>
          <div className={styles.actions}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onClose}
            >
              카페로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    // ── 성공 : 영수증 인쇄 연출 ────────────────────
    const perfect = score === 100;
    const perfectBonus = perfect ? 300 : 0;
    const baseMobil = result.mobilGained - perfectBonus;

    content = (
      <div className={styles.backdrop}>
        <div className={styles.receiptStack}>
          <div className={styles.printerFrame}>
          {/* 프린터 상단 슬롯 */}
          <div className={styles.printerSlot} aria-hidden="true" />

          {/* 인쇄되는 영수증 */}
          <div className={styles.receipt}>
            <div className={styles.receiptBody}>
              <div className={styles.receiptContent}>
                <div className={styles.receiptTitle}>CAFÉ FLASHMOB</div>
                <div className={styles.receiptSubtitle}>ORDER STATION</div>

                <div className={styles.receiptDividerHeavy}>
                  ══════════════════════
                </div>

                <div className={styles.receiptMeta}>
                  <div><span>DATE</span><span>{dateStr}</span></div>
                  <div><span>ORDER</span><span>#{orderNo}</span></div>
                  <div><span>ITEM</span><span>주문 받기</span></div>
                </div>

                <div className={styles.receiptDivider}>
                  - - - - - - - - - - - - - -
                </div>

                <div className={styles.receiptScore}>
                  <span className={styles.receiptScoreLabel}>SCORE</span>
                  <span className={styles.receiptScoreValue}>{score}</span>
                </div>
                {perfect ? (
                  <div className={styles.receiptPerfect}>★ PERFECT ★</div>
                ) : null}

                <div className={styles.receiptDivider}>
                  - - - - - - - - - - - - - -
                </div>

                <div className={styles.receiptRow}>
                  <span>기본 보상</span>
                  <span>₩{baseMobil.toLocaleString()}</span>
                </div>
                {perfect ? (
                  <div className={styles.receiptRow}>
                    <span>퍼펙트 보너스</span>
                    <span>₩{perfectBonus.toLocaleString()}</span>
                  </div>
                ) : null}

                <div className={styles.receiptDivider}>
                  - - - - - - - - - - - - - -
                </div>

                <div className={styles.receiptRow}>
                  <span>표현력 EXP</span>
                  <span>+{result.expressionGained}</span>
                </div>
                <div className={styles.receiptRow}>
                  <span>체력 EXP</span>
                  <span>+{result.physicalGained}</span>
                </div>
                <div className={`${styles.receiptRow} ${styles.receiptTotal}`}>
                  <span>지급 모빌</span>
                  <span>₩{result.mobilGained.toLocaleString()}</span>
                </div>

                <div className={styles.receiptDividerHeavy}>
                  ══════════════════════
                </div>

                <div className={styles.receiptFooter}>THANK YOU!</div>
                <div className={styles.receiptRemain}>
                  오늘 남은 횟수 {result.playsRemaining}회
                </div>
              </div>
            </div>

            {/* 하단 톱니 (currentColor = 종이색) */}
            <svg
              className={styles.receiptTeeth}
              viewBox="0 0 200 10"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon
                fill="currentColor"
                points="0,0 200,0 200,4 195,10 190,4 185,10 180,4 175,10 170,4 165,10 160,4 155,10 150,4 145,10 140,4 135,10 130,4 125,10 120,4 115,10 110,4 105,10 100,4 95,10 90,4 85,10 80,4 75,10 70,4 65,10 60,4 55,10 50,4 45,10 40,4 35,10 30,4 25,10 20,4 15,10 10,4 5,10 0,4"
              />
            </svg>
          </div>
        </div>

        {/* 인쇄 완료 후 페이드인 */}
        <div className={styles.receiptActions}>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onRetry}
            disabled={!canRetry || !onRetry}
          >
            다시 하기
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onClose}
          >
            카페로
          </button>
        </div>
        </div>
      </div>
    );
  }

  return createPortal(content, document.body);
}