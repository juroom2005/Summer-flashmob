// components/noticeboard/widgets/WeatherWidget.tsx
// ═══════════════════════════════════════════════════════════════════
// 날씨 위젯 (파랑)
// ═══════════════════════════════════════════════════════════════════
//
// 시안: 파랑 카드. 📍시부야 구, 도쿄(고정) / 좌: 날씨 아이콘 /
//   우: 큰 온도 + RealFeel.
//
// 동적: KST 오늘 날짜의 날씨를 서버에서 조회(getTodayWeather).
//   · GM 이 지정했으면 그 값, 없으면 서버가 랜덤 확정한 값(그 날 고정).
//   · 조회 실패 시 props/기본값으로 폴백(위젯이 비지 않도록).
//   · 리모콘(지정)은 GM 관리 페이지 "날씨" 탭.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useState } from "react";
import styles from "./SideWidgets.module.css";
import WeatherIcon, { type WeatherKind } from "./WeatherIcon";
import { getTodayWeather } from "@/lib/weather-helpers";

type Props = {
  // 폴백 기본값(조회 실패/로딩 중). 평소엔 서버 값이 우선.
  kind?: WeatherKind;
  tempC?: number;
  realFeelC?: number;
};

const LOCATION = "시부야 구, 도쿄"; // 고정

export default function WeatherWidget({
  kind = "sunny",
  tempC = 29,
  realFeelC = 35,
}: Props) {
  const [data, setData] = useState<{
    kind: WeatherKind;
    tempC: number;
    realFeelC: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTodayWeather().then((w) => {
      if (cancelled || !w) return;
      setData({ kind: w.kind, tempC: w.tempC, realFeelC: w.realFeelC });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 서버 값 우선, 없으면 props 기본값.
  const shownKind = data?.kind ?? kind;
  const shownTemp = data?.tempC ?? tempC;
  const shownFeel = data?.realFeelC ?? realFeelC;

  return (
    <div className={styles.weather}>
      <div className={styles.weatherLoc}>
        <span className={styles.pin}>📍</span>
        {LOCATION}
      </div>

      <div className={styles.weatherBody}>
        <div className={styles.weatherIconBox}>
          <WeatherIcon kind={shownKind} fontSize={7} />
        </div>

        <div className={styles.weatherTemp}>
          <div className={styles.tempMain}>
            {shownTemp}
            <span className={styles.tempUnit}>℃</span>
          </div>
          <div className={styles.realFeel}>RealFeel {shownFeel}°</div>
        </div>
      </div>
    </div>
  );
}