// components/noticeboard/panels/MapPanel.tsx
// ═══════════════════════════════════════════════════════════════════
// MAP (WORLD 탭 하단 섹션) — 좌측 리스트 + 지도 + 핀 호버 카드
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useState, useCallback } from "react";
import styles from "./MapPanel.module.css";
import { MAP_PLACES, type MapPlace } from "./mapPlaces";

const MAP_SRC = "/svg/shibuya-map.svg";
const CLOSE_GLYPH = "✕"; // Kitten Fat 대체

function Stars({ rating }: { rating: number }) {
  const cells: ("full" | "half" | "empty")[] = [];
  for (let i = 0; i < 5; i++) {
    const diff = rating - i;
    if (diff >= 0.75) cells.push("full");
    else if (diff >= 0.25) cells.push("half");
    else cells.push("empty");
  }
  return (
    <span className={styles.stars} aria-label={`별점 ${rating}점`}>
      {cells.map((c, i) => (
        <StarIcon key={i} kind={c} />
      ))}
    </span>
  );
}

function StarIcon({ kind }: { kind: "full" | "half" | "empty" }) {
  const gold = "#FBBB01";
  const gray = "#D9D9D9";
  const gid = `half-${Math.random().toString(36).slice(2, 8)}`;
  const fill =
    kind === "full" ? gold : kind === "empty" ? gray : `url(#${gid})`;
  return (
    <svg
      className={styles.star}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {kind === "half" ? (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="50%" stopColor={gold} />
            <stop offset="50%" stopColor={gray} />
          </linearGradient>
        </defs>
      ) : null}
      <path
        d="M8 1.5l1.9 3.86 4.26.62-3.08 3 .73 4.24L8 12.77 4.19 13.22l.73-4.24-3.08-3 4.26-.62L8 1.5z"
        fill={fill}
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        opacity="0.5"
        d="M21.9997 3.66663C13.8995 3.66663 7.33301 11.0047 7.33301 19.25C7.33301 27.4307 12.0141 36.3227 19.3177 39.7364C21.0201 40.5322 22.9792 40.5322 24.6817 39.7364C31.9853 36.3227 36.6663 27.4307 36.6663 19.25C36.6663 11.0047 30.0999 3.66663 21.9997 3.66663Z"
        fill="#E91313"
      />
      <path
        d="M22.0003 22.9167C24.5316 22.9167 26.5837 20.8646 26.5837 18.3333C26.5837 15.802 24.5316 13.75 22.0003 13.75C19.469 13.75 17.417 15.802 17.417 18.3333C17.417 20.8646 19.469 22.9167 22.0003 22.9167Z"
        fill="#E91313"
      />
    </svg>
  );
}

function PlaceCard({
  place,
  onClose,
}: {
  place: MapPlace;
  onClose: () => void;
}) {
  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.cardClose}
        onClick={onClose}
        aria-label="닫기"
      >
        {CLOSE_GLYPH}
      </button>
      <h3 className={styles.cardTitle}>{place.cardTitle}</h3>
      <div className={styles.cardRating}>
        <span className={styles.ratingNum}>{place.rating.toFixed(1)}</span>
        <Stars rating={place.rating} />
        <span className={styles.ratingReviews}>{place.reviews}</span>
      </div>
      <p className={styles.cardDesc}>{place.desc}</p>
    </div>
  );
}

export default function MapPanel() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = MAP_PLACES.find((p) => p.id === activeId) ?? null;

  const show = useCallback((id: string) => setActiveId(id), []);
  const hide = useCallback(() => setActiveId(null), []);
  const toggle = useCallback(
    (id: string) => setActiveId((cur) => (cur === id ? null : id)),
    [],
  );

  return (
    <div className={styles.wrap}>
      <ul className={styles.list}>
        {MAP_PLACES.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={`${styles.listItem} ${
                activeId === p.id ? styles.listItemActive : ""
              }`}
              onMouseEnter={() => show(p.id)}
              onFocus={() => show(p.id)}
              onClick={() => toggle(p.id)}
            >
              <span className={styles.listPin}>
                <PinIcon />
              </span>
              <span className={styles.listText}>
                <span className={styles.listName}>{p.listName}</span>
                <span className={styles.listSub}>{p.listSub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.mapArea}>
        <img className={styles.mapImg} src={MAP_SRC} alt="시부야 지도" />

        <div className={styles.markerLayer}>
          {MAP_PLACES.map((p) =>
            p.marker.kind === "pin" ? (
              <button
                key={p.id}
                type="button"
                className={`${styles.pin} ${
                  activeId === p.id ? styles.pinActive : ""
                }`}
                style={{ left: `${p.marker.x}%`, top: `${p.marker.y}%` }}
                onMouseEnter={() => show(p.id)}
                onMouseLeave={hide}
                onClick={() => toggle(p.id)}
                aria-label={p.cardTitle}
              >
                <PinIcon />
                <span className={styles.pinLabel}>{p.listName}</span>
              </button>
            ) : (
              <button
                key={p.id}
                type="button"
                className={styles.areaHot}
                style={{
                  left: `${p.marker.x}%`,
                  top: `${p.marker.y}%`,
                  width: `${p.marker.w}%`,
                  height: `${p.marker.h}%`,
                }}
                onMouseEnter={() => show(p.id)}
                onMouseLeave={hide}
                onClick={() => toggle(p.id)}
                aria-label={p.cardTitle}
              />
            ),
          )}
        </div>

        <div
          className={`${styles.cardHost} ${active ? styles.cardHostOpen : ""}`}
          onMouseEnter={() => active && show(active.id)}
          onMouseLeave={hide}
        >
          {active ? <PlaceCard place={active} onClose={hide} /> : null}
        </div>
      </div>
    </div>
  );
}
