// components/noticeboard/panels/SystemDetailView.tsx
// ═══════════════════════════════════════════════════════════════════
// SYSTEM 상세 페이지 (스탯/뱃지/일일활동/일지/매점)
// ═══════════════════════════════════════════════════════════════════
//
// 리뉴얼(2026-08):
//   · 상단(흰): SYSTEM 헤딩 + 폴더 5개 가로 나열(스탯/뱃지/일일활동/일지/매점).
//     각 폴더 클릭 → 해당 상세로 이동. 현재 보는 항목은 강조(activeId).
//     (기존의 왼쪽 텍스트 메뉴 sideMenu 는 제거하고 폴더 5개로 대체.)
//   · 일일활동 안내박스(callout)는 폴더줄 아래에 배치.
//   · 하단(회색): 좌측 바코드 + 설명 블록 + (스탯 카드 / 뱃지·일일 아이콘).
//     회색 배경은 내지(흰종이) 좌우 끝까지 꽉 차게(부모 contentStyle 패딩 상쇄).
//   · 우상단: 뒤로가기.
//
// 블록/아이콘 종류는 systemDetails.ts 참고. 인라인 **볼드** 지원.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { Fragment } from "react";
import styles from "./SystemDetailView.module.css";
import {
  SYSTEM_DETAILS,
  SYSTEM_ORDER,
  type DetailBlock,
  type IconKey,
} from "./systemDetails";

const FOLDER_SRC = "/svg/system-folder-open.svg";
const ICON_SRC: Record<IconKey, string> = {
  note: "/svg/sys-icon-note.svg",
  heart: "/svg/sys-icon-heart.svg",
  sparkle: "/svg/sys-icon-sparkle.svg",
  cafe: "/svg/sys-icon-cafe.svg",
  headset: "/svg/sys-icon-headset.svg",
  badgeNote: "/svg/badges/badge-note-common.svg",
  badgeHeart: "/svg/badges/badge-heart-common.svg",
  badgeStar: "/svg/badges/badge-star-common.svg",
};

// **볼드** 인라인 파서
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Block({ block }: { block: DetailBlock }) {
  switch (block.type) {
    case "p":
      return (
        <p className={styles.para}>
          <RichText text={block.text} />
        </p>
      );
    case "grade":
      return <p className={styles.grade}>{block.text}</p>;
    case "note":
      return <p className={styles.note}>{block.text}</p>;
    case "list":
      return (
        <ul className={styles.list}>
          {block.items.map((it, i) => (
            <li key={i} className={styles.listItem}>
              <RichText text={it} />
            </li>
          ))}
        </ul>
      );
    case "bubble":
      return (
        <div className={styles.bubbleWrap}>
          {block.ex ? <p className={styles.exLabel}>Ex.</p> : null}
          <span className={styles.bubble}>{block.text}</span>
        </div>
      );
    default:
      return null;
  }
}

export default function SystemDetailView({
  activeId,
  onBack,
  onNavigate,
}: {
  activeId: string;
  onBack: () => void;
  onNavigate: (id: string) => void;
}) {
  const detail = SYSTEM_DETAILS[activeId];
  if (!detail) return null;

  // 상단 우측 안내 박스(callout) 분리 (일일활동)
  const callout = detail.blocks.find((b) => b.type === "callout");
  const bodyBlocks = detail.blocks.filter((b) => b.type !== "callout");

  return (
    <div className={styles.detail}>
      {/* 상단 (흰) */}
      <div className={styles.top}>
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
          aria-label="메뉴로 돌아가기"
        >
          ← 뒤로
        </button>

        <h2 className={styles.heading}>SYSTEM</h2>

        {/* 폴더 5개 가로 나열 (현재 항목 강조, 클릭 시 이동) */}
        <div className={styles.folderRow}>
          {SYSTEM_ORDER.map((id) => {
            const d = SYSTEM_DETAILS[id];
            if (!d) return null;
            const isActive = id === activeId;
            return (
              <button
                key={id}
                type="button"
                className={`${styles.folderItem} ${
                  isActive ? styles.folderItemActive : ""
                }`}
                onClick={() => {
                  if (!isActive) onNavigate(id);
                }}
                aria-current={isActive ? "true" : undefined}
                aria-label={`${d.navLabel} 상세`}
              >
                <img
                  className={styles.folderImg}
                  src={FOLDER_SRC}
                  alt=""
                  aria-hidden
                />
                <span className={styles.folderLabel}>{d.navLabel}</span>
              </button>
            );
          })}
        </div>

        {/* 안내 박스 (일일활동) — 폴더줄 아래 */}
        {callout && callout.type === "callout" ? (
          <div
            className={`${styles.callout} ${
              callout.hand ? styles.calloutHand : ""
            }`}
          >
            {callout.lines.map((ln, i) => (
              <p key={i} className={styles.calloutLine}>
                {ln === "" ? "\u00A0" : ln}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* 하단 (회색) — 내지 좌우 끝까지 꽉 차게 */}
      <div className={styles.bottom}>
        <div className={styles.bottomInner}>
          <div className={styles.blocks}>
            {bodyBlocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </div>

          {/* 스탯 카드 (제목+설명) */}
          {detail.cards && detail.cards.length > 0 ? (
            <div className={styles.cards}>
              {detail.cards.map((c, i) => (
                <div key={i} className={styles.card}>
                  <h3 className={styles.cardTitle}>{c.title}</h3>
                  <p className={styles.cardDesc}>{c.desc}</p>
                </div>
              ))}
            </div>
          ) : null}

          {/* 아이콘 그룹 (뱃지·일일활동) */}
          {detail.iconGroups && detail.iconGroups.length > 0 ? (
            <div className={styles.iconGroups}>
              {detail.iconGroups.map((g, gi) => (
                <div key={gi} className={styles.iconGroup}>
                  {g.title ? (
                    <p className={styles.groupTitle}>{g.title}</p>
                  ) : null}
                  {g.subtitle ? (
                    <p className={styles.groupSub}>{g.subtitle}</p>
                  ) : null}
                  <div className={styles.iconRow}>
                    {g.items.map((it, ii) => (
                      <div key={ii} className={styles.iconItem}>
                        <img
                          className={styles.icon}
                          src={ICON_SRC[it.icon]}
                          alt=""
                          aria-hidden
                        />
                        <span className={styles.iconLabel}>{it.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}