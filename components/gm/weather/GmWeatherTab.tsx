// components/gm/weather/GmWeatherTab.tsx
// ═══════════════════════════════════════════════════════════════════
// GM 관리 페이지 · 날씨 위젯 리모콘 탭
// ═══════════════════════════════════════════════════════════════════
//
// weather_schedule 지정/수정/삭제. 여기서 지정한 날씨는 KST 자정이 지나면
// 모든 유저의 날씨 위젯에 공통 적용된다(세션 무관).
//
// 구성:
//   [ 지정 폼 ]  날짜 · 날씨종류(6종) · 온도 · 체감온도 → 저장(upsert)
//   [ 예약 목록 ] 오늘~+30일 범위의 지정 현황. 편집(폼에 불러오기)/삭제.
//
// 미지정인 날은 위젯 조회 시 서버가 랜덤으로 확정한다(source='random').
// 목록에는 이미 확정된(랜덤 포함) 날짜만 뜬다. 아직 아무도 조회 안 한
// 미래 날짜는 지정 전까지 목록에 없다(정상).
//
// RLS/RPC 가 최종 방어. 프론트 GM 판정 실패해도 서버가 거부한다.
// ═══════════════════════════════════════════════════════════════════

"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import { CALENDAR_YEAR } from "@/lib/community-events-helpers";
import {
  gmSetWeather,
  gmDeleteWeather,
  gmListWeather,
  kstTodayStr,
  addDaysStr,
  type WeatherEntry,
} from "@/lib/weather-helpers";
import type { WeatherKind } from "@/components/noticeboard/widgets/WeatherIcon";

const JUA = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

const DATE_MIN = `${CALENDAR_YEAR}-01-01`;
const DATE_MAX = `${CALENDAR_YEAR}-12-31`;

// 날씨 6종 (라벨 + 이모지). flurries(눈)도 GM 은 수동 지정 가능.
const KIND_OPTIONS: { value: WeatherKind; label: string; emoji: string }[] = [
  { value: "sunny", label: "맑음", emoji: "☀️" },
  { value: "cloudy", label: "흐림", emoji: "☁️" },
  { value: "sun-shower", label: "여우비", emoji: "🌦️" },
  { value: "rainy", label: "비", emoji: "🌧️" },
  { value: "thunder-storm", label: "뇌우", emoji: "⛈️" },
  { value: "flurries", label: "눈", emoji: "🌨️" },
];

const KIND_LABEL: Record<WeatherKind, string> = Object.fromEntries(
  KIND_OPTIONS.map((o) => [o.value, `${o.emoji} ${o.label}`])
) as Record<WeatherKind, string>;

export default function GmWeatherTab() {
  const [list, setList] = useState<WeatherEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 폼 상태
  const [date, setDate] = useState<string>(kstTodayStr());
  const [kind, setKind] = useState<WeatherKind>("sunny");
  const [tempC, setTempC] = useState<string>("30");
  const [realFeelC, setRealFeelC] = useState<string>("34");

  // 조회 범위: 오늘 ~ +30일
  const reload = useCallback(async () => {
    const from = kstTodayStr();
    const to = addDaysStr(from, 30);
    const rows = await gmListWeather(from, to);
    setList(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const handleSave = useCallback(async () => {
    const t = parseInt(tempC, 10);
    const rf = parseInt(realFeelC, 10);
    if (Number.isNaN(t) || Number.isNaN(rf)) {
      flash("온도/체감온도를 숫자로 입력해주세요.");
      return;
    }
    setSaving(true);
    const res = await gmSetWeather(date, kind, t, rf);
    setSaving(false);
    if (!res.ok) {
      flash(res.message);
      return;
    }
    flash(`${date} 날씨를 저장했습니다.`);
    await reload();
  }, [date, kind, tempC, realFeelC, flash, reload]);

  const handleEdit = useCallback((e: WeatherEntry) => {
    setDate(e.date);
    setKind(e.kind);
    setTempC(String(e.tempC));
    setRealFeelC(String(e.realFeelC));
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleDelete = useCallback(
    async (e: WeatherEntry) => {
      if (!window.confirm(`${e.date} 지정을 삭제할까요? (그 날은 다시 랜덤/미지정)`)) {
        return;
      }
      const res = await gmDeleteWeather(e.date);
      if (!res.ok) {
        flash(res.message);
        return;
      }
      flash(`${e.date} 지정을 삭제했습니다.`);
      await reload();
    },
    [flash, reload]
  );

  const today = kstTodayStr();

  return (
    <div style={containerStyle}>
      {/* 지정 폼 */}
      <div style={formCardStyle}>
        <div style={formHeaderStyle}>날씨 지정 / 예약</div>

        <label style={fieldLabelStyle}>
          날짜
          <input
            type="date"
            value={date}
            min={DATE_MIN}
            max={DATE_MAX}
            onChange={(e) => setDate(e.target.value)}
            style={dateInputStyle}
          />
        </label>

        <div style={fieldLabelStyle}>
          날씨
          <div style={kindRowStyle}>
            {KIND_OPTIONS.map((o) => {
              const active = kind === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setKind(o.value)}
                  style={{
                    ...kindBtnStyle,
                    ...(active ? kindBtnActiveStyle : null),
                  }}
                >
                  <span style={{ fontSize: 18 }}>{o.emoji}</span>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={tempRowStyle}>
          <label style={fieldLabelStyle}>
            온도(℃)
            <input
              type="number"
              value={tempC}
              onChange={(e) => setTempC(e.target.value)}
              style={numInputStyle}
            />
          </label>
          <label style={fieldLabelStyle}>
            체감온도(℃)
            <input
              type="number"
              value={realFeelC}
              onChange={(e) => setRealFeelC(e.target.value)}
              style={numInputStyle}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={primaryBtnStyle}
        >
          {saving ? "저장 중…" : "저장 (예약)"}
        </button>

        {notice ? <div style={noticeBarStyle}>{notice}</div> : null}
      </div>

      {/* 예약 목록 */}
      <div style={listHeaderStyle}>확정된 날씨 (오늘 ~ +30일)</div>
      {loading ? (
        <div style={emptyStyle}>불러오는 중…</div>
      ) : list.length === 0 ? (
        <div style={emptyStyle}>
          지정된 날씨가 없습니다. 위 폼에서 날짜별로 지정하세요.
        </div>
      ) : (
        <ul style={listStyle}>
          {list.map((e) => {
            const isToday = e.date === today;
            return (
              <li key={e.date} style={itemStyle}>
                <div style={itemMainStyle}>
                  <span style={itemDateStyle}>
                    {e.date}
                    {isToday ? <span style={todayTagStyle}>오늘</span> : null}
                  </span>
                  <span style={itemKindStyle}>{KIND_LABEL[e.kind]}</span>
                  <span style={itemTempStyle}>
                    {e.tempC}℃ · 체감 {e.realFeelC}°
                  </span>
                  <span
                    style={{
                      ...sourceTagStyle,
                      ...(e.source === "gm" ? sourceGmStyle : sourceRandomStyle),
                    }}
                  >
                    {e.source === "gm" ? "GM 지정" : "랜덤"}
                  </span>
                </div>
                <div style={itemActionsStyle}>
                  <button
                    type="button"
                    onClick={() => handleEdit(e)}
                    style={ghostBtnStyle}
                  >
                    편집
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(e)}
                    style={dangerBtnStyle}
                  >
                    삭제
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── 스타일 ── */
const containerStyle: CSSProperties = {
  fontFamily: BODY,
  color: "#1a335e",
};
const formCardStyle: CSSProperties = {
  background: "#fff",
  border: "1.5px solid rgba(0,0,0,0.1)",
  borderRadius: 14,
  padding: "18px 20px",
  marginBottom: 22,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};
const formHeaderStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize: 18,
  color: "#1a335e",
};
const fieldLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "#5a7a99",
};
const dateInputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.2)",
  fontSize: 14,
  fontFamily: BODY,
  width: "fit-content",
};
const kindRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};
const kindBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  borderRadius: 999,
  borderWidth: 1.5,
  borderStyle: "solid",
  borderColor: "rgba(0,0,0,0.15)",
  background: "#fff",
  color: "#5a7a99",
  fontSize: 13,
  cursor: "pointer",
};
const kindBtnActiveStyle: CSSProperties = {
  borderColor: "#3f88f9",
  background: "#eef4ff",
  color: "#1a335e",
  fontWeight: 600,
};
const tempRowStyle: CSSProperties = {
  display: "flex",
  gap: 16,
};
const numInputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.2)",
  fontSize: 14,
  fontFamily: BODY,
  width: 100,
};
const primaryBtnStyle: CSSProperties = {
  alignSelf: "flex-start",
  padding: "10px 22px",
  borderRadius: 10,
  border: 0,
  background: "#3f88f9",
  color: "#fff",
  fontSize: 14,
  fontFamily: JUA,
  cursor: "pointer",
};
const noticeBarStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  background: "#eef4ff",
  color: "#1a335e",
  fontSize: 13,
};
const listHeaderStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize: 16,
  color: "#1a335e",
  margin: "6px 0 12px",
};
const emptyStyle: CSSProperties = {
  padding: "24px 0",
  textAlign: "center",
  color: "#8aa0b8",
  fontSize: 14,
};
const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 16px",
  border: "1px solid rgba(0,0,0,0.1)",
  borderRadius: 12,
  background: "#fff",
  flexWrap: "wrap",
};
const itemMainStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
};
const itemDateStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize: 15,
  color: "#1a335e",
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const todayTagStyle: CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "#3f88f9",
  color: "#fff",
};
const itemKindStyle: CSSProperties = {
  fontSize: 14,
  color: "#1a335e",
};
const itemTempStyle: CSSProperties = {
  fontSize: 13,
  color: "#5a7a99",
};
const sourceTagStyle: CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
};
const sourceGmStyle: CSSProperties = {
  background: "#e8f5e9",
  color: "#2e7d32",
};
const sourceRandomStyle: CSSProperties = {
  background: "#f1f1f1",
  color: "#888",
};
const itemActionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
};
const ghostBtnStyle: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "1.5px solid rgba(0,0,0,0.15)",
  background: "#fff",
  color: "#555",
  fontSize: 13,
  cursor: "pointer",
};
const dangerBtnStyle: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "1.5px solid rgba(214,69,80,0.4)",
  background: "#fff",
  color: "#d64550",
  fontSize: 13,
  cursor: "pointer",
};
