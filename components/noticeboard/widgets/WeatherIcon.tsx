// components/noticeboard/widgets/WeatherIcon.tsx
// ═══════════════════════════════════════════════════════════════════
// 날씨 애니메이션 아이콘 (CSS only)
// ═══════════════════════════════════════════════════════════════════
//
// 원작: dribbble "Widget Weather" by kylor (CSS 아이콘, 재구성).
// 6종: sunny · cloudy · rainy · sun-shower · thunder-storm · flurries
//
// 크기 조절: font-size(em 기반). 부모에서 style={{ fontSize }} 로 축소.
// 색: 아이콘 본체는 currentColor(구름·해) + 흰색 디테일. 부모 color 로 톤 조절.
//
// 지금은 표시용(정적). 실제 날씨 종류는 추후 GM 지정/동적 데이터로 주입.
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./WeatherIcon.module.css";

export type WeatherKind =
  | "sunny"
  | "cloudy"
  | "rainy"
  | "sun-shower"
  | "thunder-storm"
  | "flurries";

type Props = {
  kind?: WeatherKind;
  /** em 기준 크기. 기본 아이콘은 12em×10em → fontSize 로 전체 축소. */
  fontSize?: number | string;
};

export default function WeatherIcon({ kind = "sunny", fontSize = 10 }: Props) {
  const size =
    typeof fontSize === "number" ? `${fontSize}px` : fontSize;

  return (
    <div className={styles.icon} style={{ fontSize: size }}>
      {kind === "sun-shower" && (
        <>
          <div className={styles.cloud} />
          <div className={styles.sun}>
            <div className={styles.rays} />
          </div>
          <div className={styles.rain} />
        </>
      )}

      {kind === "thunder-storm" && (
        <>
          <div className={styles.cloud} />
          <div className={styles.lightning}>
            <div className={styles.bolt} />
            <div className={styles.bolt} />
          </div>
        </>
      )}

      {kind === "cloudy" && (
        <>
          <div className={styles.cloud} />
          <div className={styles.cloud} />
        </>
      )}

      {kind === "flurries" && (
        <>
          <div className={styles.cloud} />
          <div className={styles.snow}>
            <div className={styles.flake} />
            <div className={styles.flake} />
          </div>
        </>
      )}

      {kind === "sunny" && (
        <div className={styles.sun}>
          <div className={styles.rays} />
        </div>
      )}

      {kind === "rainy" && (
        <>
          <div className={styles.cloud} />
          <div className={styles.rain} />
        </>
      )}
    </div>
  );
}
