// components/noticeboard/practice/PracticeRewardPopup.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습실알바 미니게임 정산 팝업 (영수증 프린트 연출)
// ═══════════════════════════════════════════════════════════════════
//
// 카페 RewardPopup 을 복제해서 연습실 전용으로 신설.
// 안정성 원칙 상 카페 컴포넌트는 절대 참조·수정하지 않는다.
//
// 카페와의 차이 (필드·라벨 rename 만) :
//   · import type      : PlayResult → PracticePlayResult
//   · 스탯 필드        : expressionBase/Bonus → rhythmBase/Bonus
//   · EXP 라벨         : "표현력 EXP" → "리듬감 EXP"
//   · 영수증 헤더      : "CAFÉ FLASHMOB" → "STUDIO FLASHMOB"
//   · 서브 헤더        : "ORDER STATION" → "REHEARSAL STUDIO"
//   · 돌아가기 문구    : "카페로 돌아가기" → "연습실로 돌아가기"
//
// 그 외 (레이아웃 · 애니메이션 · 프린터 프레임 · 톱니 SVG 등) 은 카페와 완전 동일.
// CSS 도 같은 톤 유지를 위해 파일만 복제 (PracticeRewardPopup.module.css).
//
// 사용 위치 : PracticeCleanGame (완주 → 채점 → 서버 제출 후 결과 표시)
//            향후 PracticeStockGame / PracticeSetupGame 도 동일하게 사용
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./PracticeRewardPopup.module.css";
import type { PracticePlayResult } from "@/lib/minigame-helpers";

type Props = {
  result:   PracticePlayResult | null;
  score:    number;
  gameName: string;        // 영수증 ITEM 표시용 (예: "연습실 청소")
  onClose:  () => void;
  onRetry?: () => void;
  canRetry: boolean;
};

export default function PracticeRewardPopup({
  result,
  score,
  gameName,
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
              연습실로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    // ── 성공 : 영수증 인쇄 연출 ────────────────────
    const perfect = score === 100;

    // 서버 breakdown 사용 (하드코딩 제거).
    const diff        = result.difficulty;
    const stars       = "★".repeat(diff) + "☆".repeat(Math.max(0, 3 - diff));
    const mobilBase   = result.mobilBase;
    const mobilDiff   = result.mobilDifficultyBonus;
    const mobilPerf   = result.mobilPerfectBonus;
    const rhyBase     = result.rhythmBase;
    const rhyBonus    = result.rhythmBonus;
    const phyBase     = result.physicalBase;
    const phyBonus    = result.physicalBonus;

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
                <div className={styles.receiptTitle}>STUDIO FLASHMOB</div>
                <div className={styles.receiptSubtitle}>REHEARSAL STUDIO</div>

                <div className={styles.receiptDividerHeavy}>
                  ══════════════════════
                </div>

                <div className={styles.receiptMeta}>
                  <div><span>DATE</span><span>{dateStr}</span></div>
                  <div><span>ORDER</span><span>#{orderNo}</span></div>
                  <div><span>ITEM</span><span>{gameName}</span></div>
                  <div><span>DIFFICULTY</span><span>{stars}</span></div>
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
                  <span>₩{mobilBase.toLocaleString()}</span>
                </div>
                {mobilDiff > 0 ? (
                  <div className={styles.receiptRow}>
                    <span>난이도 ({stars})</span>
                    <span>+₩{mobilDiff.toLocaleString()}</span>
                  </div>
                ) : null}
                {mobilPerf > 0 ? (
                  <div className={styles.receiptRow}>
                    <span>퍼펙트 보너스</span>
                    <span>+₩{mobilPerf.toLocaleString()}</span>
                  </div>
                ) : null}

                <div className={styles.receiptDivider}>
                  - - - - - - - - - - - - - -
                </div>

                <div className={styles.receiptRow}>
                  <span>리듬감 EXP</span>
                  <span>+{rhyBase}</span>
                </div>
                {rhyBonus > 0 ? (
                  <div className={styles.receiptRow}>
                    <span>난이도 EXP</span>
                    <span>+{rhyBonus}</span>
                  </div>
                ) : null}
                <div className={styles.receiptRow}>
                  <span>체력 EXP</span>
                  <span>+{phyBase}</span>
                </div>
                {phyBonus > 0 ? (
                  <div className={styles.receiptRow}>
                    <span>난이도 EXP</span>
                    <span>+{phyBonus}</span>
                  </div>
                ) : null}
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
            연습실로
          </button>
        </div>
        </div>
      </div>
    );
  }

  return createPortal(content, document.body);
}
