// components/noticeboard/cover/CoverDecorations.tsx
// ═══════════════════════════════════════════════════════════════════
// board 커버 우측 장식 요소 (덮개 위에 얹힘)
// ═══════════════════════════════════════════════════════════════════
//
// 시안(Anima) 커버의 우측 요소들을 재현. board 탭에서만 표시된다.
//
// 동적 요소:
//   · D-day    : 목표일(FLASHMOB_DATE)까지 남은 일수 자동 계산
//   · 이벤트배너: 오늘 날짜 표시 + community_events 에 오늘 이벤트가
//                있으면 노란 배너 + 제목, 없으면 "없음"
//                (데이터는 GM 일정 탭에서 관리하는 community_events)
//
// 정적 요소:
//   · 如月 토끼 원형 뱃지 (SVG)
//
// 좌표는 시안 원본(2029×1000 캔버스) 기준을 덮개 좌표계로 옮긴 값.
// 위치 조정이 필요하면 각 요소의 style top/left 만 수정.
//
// ── 목표일 변경 ──
//   FLASHMOB_DATE 상수만 바꾸면 D-day 기준일이 바뀐다.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  listCommunityEventsByYear,
  CALENDAR_YEAR,
  type CommunityEvent,
} from "@/lib/community-events-helpers";

// ── 목표일 (고정) ──────────────────────────────────────────
// 플래시몹 당일. D-day 는 이 날까지 남은 일수.
const FLASHMOB_DATE = "2026-08-31";

// ── 날짜 유틸 ──────────────────────────────────────────────
// 한자 요일 (시안이 "金" 처럼 한자 표기)
const WEEKDAY_KANJI = ["日", "月", "火", "水", "木", "金", "土"];

// 로컬 기준 오늘 "YYYY-MM-DD"
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 두 "YYYY-MM-DD" 간 일수 차 (target - base). 자정 기준.
function daysUntil(target: string, base: string): number {
  const t = new Date(`${target}T00:00:00`).getTime();
  const b = new Date(`${base}T00:00:00`).getTime();
  return Math.round((t - b) / 86400000);
}

// "2026-08-21" → { dot: "2026.08.21", kanji: "金" }
function formatEventDate(dateStr: string): { dot: string; kanji: string } {
  const [y, m, d] = dateStr.split("-");
  const wd = new Date(`${dateStr}T00:00:00`).getDay();
  return { dot: `${y}.${m}.${d}`, kanji: WEEKDAY_KANJI[wd] ?? "" };
}

export default function CoverDecorations() {
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const today = useMemo(() => todayStr(), []);

  // 이벤트 로드 (실패 시 helper 가 빈 배열 반환 → 안전)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = await listCommunityEventsByYear(CALENDAR_YEAR);
      if (alive) setEvents(rows);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // D-day: 목표일까지 남은 일수 (음수면 지난 것)
  const dday = useMemo(() => daysUntil(FLASHMOB_DATE, today), [today]);
  const ddayLabel = dday > 0 ? `D-${dday}` : dday === 0 ? "D-DAY" : `D+${-dday}`;

  // 오늘 이벤트 (여러 개면 첫 번째)
  const todayEvent = useMemo(
    () => events.find((e) => e.eventDate === today) ?? null,
    [events, today],
  );
  const todayFmt = formatEventDate(today);

  return (
    <>
      {/* ── D-day 스티커 (흰 타원 + Limelight 골드) ── */}
      <div style={ddayWrapStyle}>
        <div style={ddayEllipseStyle} />
        <div style={ddayTextStyle}>{ddayLabel}</div>
      </div>

      {/* ── 如月 토끼 원형 뱃지 (정적 SVG) ── */}
      <div style={rabbitBadgeStyle} dangerouslySetInnerHTML={{ __html: RABBIT_BADGE_SVG }} />

      {/* ── 이벤트 배너 ── */}
      {/* 날짜(마테+날짜)는 항상 표시. 오늘 이벤트가 있으면 제목,
          없으면 "없음". */}
      <div style={eventWrapStyle}>
        {/* EVENT 라벨 (Monofett, 흰 테두리) */}
        <div style={eventLabelStyle}>EVENT</div>

        {/* 노란 마테 + 오늘 날짜 (항상) */}
        <div style={eventTapeStyle} />
        <div style={eventDateStyle}>
          {todayFmt.dot}{" "}
          <span style={eventKanjiStyle}>{todayFmt.kanji}</span>
        </div>

        {/* 이벤트 제목 or 없음 */}
        {todayEvent ? (
          <div style={eventTitleStyle}>
            {todayEvent.icon} {todayEvent.title}
          </div>
        ) : (
          <div style={eventEmptyStyle}>없음</div>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 스타일 (시안 좌표 기반. 덮개 콘텐츠 영역 기준 절대위치)
// ═══════════════════════════════════════════════════════════════════

// D-day 스티커 (우측 상단)
const ddayWrapStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 20,
  width: 214,
  height: 124,
};
const ddayEllipseStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "#fff",
  borderRadius: "50%",
  transform: "rotate(1.7deg)",
  boxShadow: "0 4px 12px rgba(20,58,99,.15)",
};
const ddayTextStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "'Limelight', cursive",
  fontSize: 60,
  color: "#fbbb01",
  transform: "rotate(2.9deg)",
  textTransform: "uppercase",
};

// 如月 뱃지 (D-day 아래)
const rabbitBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 120,
  right: 60,
  width: 140,
  height: 108,
};

// 이벤트 배너 (우측 중앙)
const eventWrapStyle: CSSProperties = {
  position: "absolute",
  top: 250,
  right: 20,
  width: 262,
  height: 130,
};
const eventLabelStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 135,
  fontFamily: "'Monofett', cursive",
  fontSize: 40,
  color: "#f8e31a",
  WebkitTextStroke: "3px #fff",
  transform: "rotate(3deg)",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
const eventTapeStyle: CSSProperties = {
  position: "absolute",
  top: 33,
  left: 0,
  width: 259,
  height: 53,
  background: "#3f88f9",
  transform: "rotate(1.99deg)",
};
const eventDateStyle: CSSProperties = {
  position: "absolute",
  top: 46,
  left: 26,
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "'Hachi Maru Pop', cursive",
  fontSize: 24,
  color: "#f8e31a",
  transform: "rotate(1.34deg)",
  whiteSpace: "nowrap",
};
const eventKanjiStyle: CSSProperties = {
  border: "0.5px solid #f8e31a",
  padding: "0 2px",
};
const eventTitleStyle: CSSProperties = {
  position: "absolute",
  top: 96,
  left: 9,
  fontFamily: "'Gowun Dodum', sans-serif",
  fontSize: 16,
  color: "#1a335e",
  letterSpacing: "0.05em",
};
const eventEmptyStyle: CSSProperties = {
  position: "absolute",
  top: 96,
  left: 9,
  fontFamily: "'Gowun Dodum', sans-serif",
  fontSize: 16,
  color: "#1a335e",
};

// ── 如月 토끼 원형 뱃지 SVG (정적) ──
const RABBIT_BADGE_SVG = `<svg width="100%" height="100%" viewBox="0 0 166 128" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M52.2817 25.4124C80.0144 19.3854 106.598 34.4601 112.125 58.3615C117.643 82.2271 100.285 106.82 72.5667 112.845C44.8339 118.871 18.2503 103.797 12.7237 79.8954C7.20552 56.0297 24.5632 31.4362 52.2817 25.4124Z" fill="#3F88F9" stroke="#F8E31A" stroke-width="5"/><path d="M40.3744 62.1762C40.9039 65.8779 41.1739 69.2375 41.1845 72.2551C41.2212 75.2674 40.9724 78.0108 40.4382 80.4855C41.4379 80.991 42.3593 81.5123 43.2022 82.0495C44.0661 82.5553 44.807 83.0586 45.425 83.5596L43.1599 89.1176C42.5941 88.6061 41.9186 88.0895 41.1332 87.568C40.3739 87.0411 39.5467 86.5144 38.6515 85.9877C37.9117 87.5789 36.9964 89.0422 35.9058 90.3778C34.8204 91.7394 33.5518 93.002 32.1 94.1656C31.5863 93.5076 30.9104 92.7871 30.0722 92.0041C29.2602 91.2158 28.5086 90.5922 27.8175 90.1332C30.3509 88.3977 32.2557 86.1089 33.5319 83.2669C33.2283 83.1105 32.9274 82.9672 32.629 82.837C32.3569 82.7015 32.0716 82.5687 31.7733 82.4384L31.7049 83.7172L26.4624 82.4086C26.5796 80.6983 26.6835 78.7866 26.7739 76.6736C26.8643 74.5606 26.9074 72.3484 26.9033 70.0368L23.845 70.6541L22.7528 65.2432L26.909 64.4043C26.9013 63.0185 26.8728 61.664 26.8234 60.341C26.7948 58.9865 26.7507 57.6896 26.691 56.4502L32.299 55.9304C32.3167 57.0966 32.3293 58.3047 32.3368 59.5546C32.3389 60.7783 32.3333 62.0309 32.3199 63.3122L35.8095 62.6078L36.766 62.2924L40.3744 62.1762ZM57.4462 54.364L63.8249 85.9667L58.1788 87.1063L57.7198 84.8322L52.3089 85.9243L52.8946 88.8258L47.5229 89.91L41.0175 57.68L57.4462 54.364ZM56.6356 79.4605L52.8843 60.8753L47.4734 61.9675L51.2247 80.5527L56.6356 79.4605ZM32.275 68.9526C32.246 70.2915 32.2143 71.6173 32.18 72.93C32.1458 74.2427 32.1062 75.5293 32.0614 76.7898C32.5585 76.9615 33.0609 77.1593 33.5686 77.3833C34.1024 77.602 34.6232 77.8234 35.1309 78.0473C35.3793 76.5826 35.5308 75.0421 35.5855 73.426C35.6663 71.8047 35.6476 70.0946 35.5293 68.2957L32.275 68.9526ZM96.5787 73.9691C96.9005 75.5636 96.942 76.8475 96.7032 77.8206C96.4643 78.7938 95.8957 79.6159 94.9974 80.2869C94.0521 80.9946 92.858 81.5484 91.4153 81.9484C90.004 82.3693 88.292 82.7829 86.2793 83.1891C86.0586 82.6352 85.7438 82.0186 85.3346 81.3395C84.9255 80.6603 84.4903 79.9865 84.0289 79.3179C83.5674 78.6493 83.1298 78.0983 82.7159 77.665C83.5629 77.5484 84.4465 77.4109 85.3666 77.2523C86.3129 77.0885 87.152 76.9328 87.8839 76.7851C88.642 76.632 89.1778 76.5239 89.4915 76.4606C89.9359 76.3709 90.2337 76.2292 90.3851 76.0354C90.5311 75.8155 90.5646 75.5095 90.4854 75.1174L89.5753 70.6083L73.9308 73.766C73.8459 76.0411 73.4838 78.2906 72.8445 80.5144C72.2052 82.7382 71.1445 84.7613 69.6625 86.5839C69.2958 86.2499 68.7826 85.8638 68.1229 85.4256C67.4893 84.9822 66.8217 84.5729 66.1203 84.1976C65.445 83.817 64.8718 83.5382 64.4008 83.3612C65.5958 81.8686 66.4638 80.306 67.0048 78.6734C67.5458 77.0407 67.8514 75.3876 67.9217 73.7139C68.0181 72.035 67.9576 70.3877 67.7404 68.7721C67.5492 67.1512 67.3059 65.6089 67.0105 64.1451L64.2959 50.6963L90.8014 45.3463L96.5787 73.9691ZM71.3011 55.0769L72.0609 58.841L86.6075 55.9048L85.8478 52.1407L71.3011 55.0769ZM88.4594 65.0798L87.6996 61.3157L73.153 64.2518C73.3487 65.491 73.5235 66.7615 73.6775 68.0634L88.4594 65.0798Z" fill="#F8E31A"/></svg>`;