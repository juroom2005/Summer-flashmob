// components/noticeboard/rhythm/RhythmRewardPopup.tsx
// ═══════════════════════════════════════════════════════════════════
// 리듬게임 정산 팝업 (세션 M 신설)
// ═══════════════════════════════════════════════════════════════════
//
// 카페 · 연습실 RewardPopup 을 복제해서 리듬 전용으로 신설.
// 안정성 원칙 상 카페 · 연습실 컴포넌트는 절대 참조·수정하지 않는다.
//
// 리듬게임 고유 (알바와 다른 점) :
//   · mobil 지급 없음 → 영수증(₩) 대신 "스탯 리포트" 형태
//   · 선택 스탯 (리듬감 또는 표현력) 대량 exp 표시
//   · 체력 exp 표시
//   · 판정 breakdown (PERFECT/GOOD/MISS · 최대 콤보) 표시
//
// 톤 : tokens.css 변수 기반 (파랑 계열). 향후 리뉴얼 시 tokens 만 갱신.
//
// 사용 위치 : RhythmGame (완주 → 채점 → 서버 제출 후 결과 표시)
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./RhythmRewardPopup.module.css";
import type { RhythmPlayResult } from "@/lib/minigame-helpers";

// 판정 카운트 (게임에서 넘겨줌, 표시용)
export type RhythmJudgeSummary = {
  perfect:  number;
  good:     number;
  miss:     number;
  maxCombo: number;
};

type Props = {
  result:   RhythmPlayResult | null;
  score:    number;
  summary:  RhythmJudgeSummary;
  onClose:  () => void;
  onRetry?: () => void;
  canRetry: boolean;
};

// 선택 스탯 표시 라벨
function statLabel(stat: "rhythm" | "expression"): string {
  return stat === "rhythm" ? "리듬감" : "표현력";
}

export default function RhythmRewardPopup({
  result,
  score,
  summary,
  onClose,
  onRetry,
  canRetry,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  if (!mounted) return null;

  let content: React.ReactNode;

  if (result === null) {
    // ── 제출 중 ──────────────────────────────────
    content = (
      <div className={styles.backdrop}>
        <div className={styles.card}>
          <div className={styles.stamp}>⏳</div>
          <div className={styles.headline}>정산 중…</div>
          <div className={styles.subline}>보상을 계산하고 있습니다.</div>
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
              돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    // ── 성공 : 스탯 리포트 ────────────────────────
    const perfect = score === 100;
    const sel = result.selectedStat;
    const selName = statLabel(sel);

    content = (
      <div className={styles.backdrop}>
        <div className={styles.reportStack}>
          <div className={styles.report}>
            <div className={styles.reportHeader}>
              <div className={styles.reportTitle}>REHEARSAL REPORT</div>
              <div className={styles.reportSubtitle}>STUDIO FLASHMOB</div>
            </div>

            <div className={styles.reportMeta}>
              <div>
                <span>DATE</span>
                <span>{dateStr}</span>
              </div>
              <div>
                <span>성장 스탯</span>
                <span>{selName}</span>
              </div>
            </div>

            <div className={styles.scoreBlock}>
              <span className={styles.scoreLabel}>SCORE</span>
              <span className={styles.scoreValue}>{score}</span>
              {perfect ? (
                <span className={styles.perfectTag}>★ PERFECT ★</span>
              ) : null}
            </div>

            {/* 판정 breakdown */}
            <div className={styles.judgeGrid}>
              <div className={`${styles.judgeItem} ${styles.judgePerfect}`}>
                <span className={styles.judgeCount}>{summary.perfect}</span>
                <span className={styles.judgeName}>PERFECT</span>
              </div>
              <div className={`${styles.judgeItem} ${styles.judgeGood}`}>
                <span className={styles.judgeCount}>{summary.good}</span>
                <span className={styles.judgeName}>GOOD</span>
              </div>
              <div className={`${styles.judgeItem} ${styles.judgeMiss}`}>
                <span className={styles.judgeCount}>{summary.miss}</span>
                <span className={styles.judgeName}>MISS</span>
              </div>
            </div>

            <div className={styles.comboLine}>
              최대 콤보 <strong>{summary.maxCombo}</strong>
            </div>

            <div className={styles.divider} />

            {/* 스탯 보상 (mobil 없음) */}
            <div className={styles.rewardBlock}>
              <div className={styles.rewardRow}>
                <span className={styles.rewardName}>{selName} EXP</span>
                <span className={styles.rewardBig}>
                  +{result.selectedStatGained}
                </span>
              </div>
              <div className={styles.rewardRow}>
                <span className={styles.rewardName}>체력 EXP</span>
                <span className={styles.rewardMid}>
                  +{result.physicalGained}
                </span>
              </div>
            </div>

            <div className={styles.noMobilNote}>
              연습은 모빌 대신 스탯을 크게 성장시킵니다.
            </div>

            <div className={styles.remainLine}>
              오늘 남은 횟수 {result.playsRemaining}회
            </div>
          </div>

          <div className={styles.reportActions}>
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
