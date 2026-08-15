// components/noticeboard/widgets/WeatherWidget.tsx
// ═══════════════════════════════════════════════════════════════════
// 날씨 위젯 (파랑)
// ═══════════════════════════════════════════════════════════════════
//
// 시안: 파랑(#3f88f9) 카드. 📍시부야 구, 도쿄(고정) / 좌: 날씨 아이콘 /
//   우: 큰 온도 + RealFeel.
//
// 동적 계획(추후): KST 날짜별로 날씨종류·온도를 GM 이 지정 → 자정 넘어가면
//   공통으로 바뀜(세션 무관). 지금은 아래 값 하드코딩(임시).
//   "시부야 구, 도쿄" 는 고정 문구.
// ═══════════════════════════════════════════════════════════════════

"use client";

import styles from "./SideWidgets.module.css";
import WeatherIcon, { type WeatherKind } from "./WeatherIcon";

type Props = {
  // 추후 GM 지정/동적 데이터로 주입. 지금은 기본값(하드코딩) 사용.
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
  return (
    <div className={styles.weather}>
      <div className={styles.weatherLoc}>
        <span className={styles.pin}>📍</span>
        {LOCATION}
      </div>

      <div className={styles.weatherBody}>
        <div className={styles.weatherIconBox}>
          <WeatherIcon kind={kind} fontSize={7} />
        </div>

        <div className={styles.weatherTemp}>
          <div className={styles.tempMain}>
            {tempC}
            <span className={styles.tempUnit}>℃</span>
          </div>
          <div className={styles.realFeel}>RealFeel {realFeelC}°</div>
        </div>
      </div>
    </div>
  );
}
