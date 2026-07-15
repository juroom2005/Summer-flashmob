"use client";
// components/noticeboard/panels/MyPanel.tsx — 마이패널 서랍
// 닉네임 버튼 클릭 → 오른쪽에서 슬라이드로 열리는 개인 패널.
// 학생증(배경 커스텀 + 서명 캔버스) · 유리병 파도 스탯 · 코르크보드 인벤토리 · 스탬프 달력(개인 메모)
//
// 데이터 정책:
//   - 학생증(성명·학교·학년·성별)과 유리병 스탯은 부모가 넘겨준 실 데이터를 사용.
//   - 인벤토리·공용 일정은 아직 DB 스키마 없음 → props 미지정 시 DEFAULT 더미 표시.
//     추후 별도 세션에서 스키마·EF·GM UI와 함께 실데이터로 교체.
//   - 개인 메모·서명·카드 배경 선택(bgIdx)은 localStorage(storageKey 기준)에 저장.
//     계정별 분리를 위해 부모는 storageKey에 profile.id를 넣어 넘기는 것을 권장.
//
// 스타일 원칙(핸드오프 4-3):
//   - 본체 레이아웃은 인라인 style 유지 (마이패널은 프론트 리뉴얼 대상 밖).
//   - keyframes와 hover 인터랙션·animation 참조는 MyPanel.module.css로 격리.

import { useEffect, useMemo, useRef, useState } from "react";
import { JUA, GAEGU, BODY } from "../../auth/fonts";
import styles from "./MyPanel.module.css";

/* ── 타입 ─────────────────────────────────────── */
export type MyPanelProfile = {
  familyName:    string | null;                       // profiles.family_name (등록 완료 전엔 null)
  givenName:     string | null;                       // profiles.given_name
  schoolName:    string | null;                       // profiles.school_name
  grade:         number | null;                       // profiles.grade (1~3)
  gender:        "male" | "female" | "other" | null;  // profiles.gender
  avatarUrl?:    string;                              // 캐릭터 두상 이미지 (미래)
  cardImageUrl?: string;                              // 학생증 배경 사진 (미래)
};
export type MyPanelStat = { label: string; value: number; color: string }; // value 0~100
export type MyPanelItem = { name: string; icon: string; qty: number; effect: string }; // 인벤토리 (미래 스키마)
export type MyPanelEvent = { day: number; title: string; icon: string };               // 공용 일정 (미래 스키마)

type Props = {
  open: boolean;
  onClose: () => void;
  profile: MyPanelProfile;
  stats?: MyPanelStat[];
  items?: MyPanelItem[];
  events?: MyPanelEvent[];
  /** 유저별 저장 키 (profile id 권장). 기본 "mypanel" */
  storageKey?: string;
};

/* ── 팔레트 / 데모 데이터 ─────────────────────── */
const NAVY = "#14406f";
const PALETTES = [
  "linear-gradient(135deg,#a5dbf7,#6fc3ee)",
  "linear-gradient(135deg,#b9efdd,#7fd8bd)",
  "linear-gradient(135deg,#ffe9a8,#ffd95e)",
  "linear-gradient(135deg,#ffd7c9,#f5a988)",
  "linear-gradient(135deg,#dcd6fb,#b3a8ef)",
];
const TAPE = ["rgba(205,238,255,.88)", "rgba(201,242,230,.88)", "rgba(255,243,166,.92)", "rgba(255,215,201,.88)"];
const GENDER_LABEL: Record<NonNullable<MyPanelProfile["gender"]>, string> = { male: "남", female: "여", other: "기타" };

// stats prop 미지정 시 폴백 (원본 시안값). 실데이터 붙일 땐 부모에서 stats 넘겨야 함.
const DEFAULT_STATS: MyPanelStat[] = [
  { label: "리듬감", value: 82, color: "#1a9edb" },
  { label: "보컬", value: 64, color: "#4db6a0" },
  { label: "체력", value: 71, color: "#e0a500" },
  { label: "매력", value: 90, color: "#ef8f6a" },
  { label: "팀워크", value: 58, color: "#4a7fe0" },
];
// TODO(인벤토리): items 테이블 설계 후 실데이터 교체
const DEFAULT_ITEMS: MyPanelItem[] = [
  { name: "밀짚모자", icon: "👒", qty: 1, effect: "착용하면 한여름 더위를 잊어요" },
  { name: "응원봉", icon: "🪄", qty: 3, effect: "플래시몹 응원 효과 +10" },
  { name: "모래 유리병", icon: "🫙", qty: 2, effect: "학생증 배경 1회 변경권" },
  { name: "조개 피크", icon: "🐚", qty: 1, effect: "연주 리듬감 +5" },
  { name: "여름 필름", icon: "🎞️", qty: 5, effect: "추억 사진 1장 현상 가능" },
  { name: "시원한 사이다", icon: "🥤", qty: 2, effect: "체력 +20 즉시 회복" },
];
// TODO(공용 일정): events 테이블 + GM 관리 UI 붙이면 실데이터 교체
const DEFAULT_EVENTS: MyPanelEvent[] = [
  { day: 4, title: "파트 모집 시작", icon: "📣" },
  { day: 11, title: "안무 1차 합주", icon: "🕺" },
  { day: 15, title: "보컬 연습", icon: "🎤" },
  { day: 24, title: "중간 점검 촬영", icon: "📷" },
  { day: 28, title: "지원 폼 마감", icon: "⏰" },
];

/* ── 컴포넌트 ─────────────────────────────────── */
export default function MyPanel({
  open, onClose, profile,
  stats = DEFAULT_STATS, items = DEFAULT_ITEMS, events = DEFAULT_EVENTS,
  storageKey = "mypanel",
}: Props) {
  const [bgIdx, setBgIdx] = useState(0);
  const [hovItem, setHovItem] = useState(-1);
  const today = useMemo(() => new Date(), []);
  const [selDay, setSelDay] = useState(today.getDate());
  const [memos, setMemos] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  /* 파생값: 프로필 표시명 (family + given 조합, 둘 다 null이면 안내 문구) */
  const characterName =
    [profile.familyName, profile.givenName].filter(Boolean).join(" ") || "이름 미등록";

  /* 저장된 상태 복원 — TODO: supabase에서 profile별 로드로 교체 */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:state`);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.bgIdx === "number") setBgIdx(s.bgIdx);
        if (s.memos) setMemos(s.memos);
      }
      const sig = localStorage.getItem(`${storageKey}:sig`);
      if (sig && canvasRef.current) {
        const img = new Image();
        img.onload = () => canvasRef.current?.getContext("2d")?.drawImage(img, 0, 0);
        img.src = sig;
      }
    } catch { /* ignore */ }
    setLoaded(true);
  }, [storageKey]);

  /* 상태 저장 — TODO: supabase upsert로 교체 */
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(`${storageKey}:state`, JSON.stringify({ bgIdx, memos })); } catch { /* ignore */ }
  }, [bgIdx, memos, loaded, storageKey]);

  /* ── 서명 캔버스 ── */
  const sigCtx = () => {
    const el = canvasRef.current;
    if (!el) return null;
    const c = el.getContext("2d")!;
    c.lineWidth = 2.2; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = NAVY;
    return c;
  };
  const sigPos = (e: React.PointerEvent) => {
    const el = canvasRef.current!;
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) * el.width / r.width, y: (e.clientY - r.top) * el.height / r.height };
  };
  const sigDown = (e: React.PointerEvent) => {
    const c = sigCtx(); if (!c) return;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = sigPos(e);
    drawing.current = true;
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 0.01, p.y + 0.01); c.stroke();
  };
  const sigMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = sigCtx(); if (!c) return;
    const p = sigPos(e); c.lineTo(p.x, p.y); c.stroke();
  };
  const sigUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    try { localStorage.setItem(`${storageKey}:sig`, canvasRef.current!.toDataURL()); } catch { /* ignore */ }
    // TODO: supabase — 서명 dataURL(또는 stroke 데이터) 저장
  };
  const sigClear = () => {
    const el = canvasRef.current;
    if (el) el.getContext("2d")!.clearRect(0, 0, el.width, el.height);
    try { localStorage.removeItem(`${storageKey}:sig`); } catch { /* ignore */ }
  };

  /* ── 달력 ── */
  const year = today.getFullYear(), month = today.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const evMap = useMemo(() => {
    const m: Record<number, MyPanelEvent> = {};
    events.forEach((e) => { m[e.day] = e; });
    return m;
  }, [events]);
  const saveMemo = () => {
    const d = draft.trim();
    if (!d) return;
    setMemos((m) => ({ ...m, [selDay]: d }));
    setDraft("");
  };
  const selEv = evMap[selDay];

  const secTitle: React.CSSProperties = { fontFamily: JUA, fontSize: 19, color: "#0d6fa8" };
  const secHint: React.CSSProperties = { fontFamily: GAEGU, fontWeight: 700, fontSize: 15, color: "#2ea3dd" };
  const chip: React.CSSProperties = { fontFamily: JUA, fontSize: 11, background: "rgba(255,255,255,.85)", color: "#0d6fa8", borderRadius: 999, padding: "2px 9px" };
  const gaeguVal: React.CSSProperties = { fontFamily: GAEGU, fontWeight: 700, fontSize: 16, color: NAVY };

  return (
    <>
      {/* 딤 오버레이 */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0, background: "rgba(8,60,105,.28)", backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity .4s", zIndex: 35,
        }}
      />

      {/* 서랍 */}
      <div style={{
        position: "absolute", top: 0, bottom: 0, right: 0, width: 470, zIndex: 40,
        transform: open ? "translateX(0)" : "translateX(112%)",
        transition: "transform .55s cubic-bezier(.25,.9,.3,1)",
      }}>
        <div style={{
          position: "absolute", inset: 0, background: "#fffdf4", borderLeft: "2.5px solid #2ea3dd",
          borderRadius: "18px 0 0 18px", boxShadow: "-16px 0 40px rgba(20,58,99,.3)",
          backgroundImage: "repeating-linear-gradient(180deg,transparent,transparent 31px,rgba(46,163,221,.08) 31px,rgba(46,163,221,.08) 32px)",
        }} />
        {/* 왼쪽 가장자리 마스킹테이프 */}
        <div style={{ position: "absolute", left: -13, top: 96, width: 26, height: 62, background: "repeating-linear-gradient(45deg,#cdeeff 0 8px,#e9f8ff 8px 16px)", opacity: .92, transform: "rotate(3deg)", borderRadius: 2, boxShadow: "0 2px 5px rgba(20,58,99,.15)", zIndex: 2 }} />
        <div style={{ position: "absolute", left: -13, top: 330, width: 26, height: 62, background: "repeating-linear-gradient(45deg,#fff3a6 0 8px,#fff9d6 8px 16px)", opacity: .92, transform: "rotate(-2deg)", borderRadius: 2, boxShadow: "0 2px 5px rgba(20,58,99,.15)", zIndex: 2 }} />
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 18, width: 34, height: 34, borderRadius: "50%", border: "2px solid #2ea3dd", background: "#fff", color: "#0d6fa8", fontFamily: JUA, fontSize: 16, zIndex: 6 }}>✕</button>

        <div style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "20px 24px 28px", fontFamily: BODY }}>
          <div style={{ fontFamily: JUA, fontSize: 23, color: "#0d6fa8" }}>🎒 {characterName}의 마이 패널</div>
          <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 17, color: "#2ea3dd", marginTop: 2 }}>여름 플래시몹 학생 수첩</div>

          {/* ── 학생증 ── */}
          <div style={{ position: "relative", marginTop: 14, borderRadius: 16, overflow: "hidden", border: `2.5px solid ${NAVY}`, boxShadow: "4px 5px 0 rgba(20,58,99,.22)" }}>
            {profile.cardImageUrl && (
              <img src={profile.cardImageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            )}
            <div style={{ position: "absolute", inset: 0, background: PALETTES[bgIdx], opacity: .85, pointerEvents: "none", transition: "opacity .3s" }} />
            <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle,rgba(255,255,255,.5) 1px,transparent 1.4px)", backgroundSize: "6px 6px", opacity: .3, pointerEvents: "none" }} />
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(255,255,255,.8)", borderBottom: "1.5px dashed rgba(20,64,111,.3)" }}>
              <span style={{ fontFamily: JUA, fontSize: 15, color: NAVY }}>학생증</span>
              <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 13, color: "#2a5878", letterSpacing: 1 }}>STUDENT ID CARD</span>
              <span style={{ marginLeft: "auto", fontFamily: JUA, fontSize: 10.5, background: NAVY, color: "#fff", borderRadius: 999, padding: "2px 9px" }}>여름 플래시몹 학생회</span>
            </div>
            <div style={{ position: "absolute", top: 44, right: 12, width: 34, height: 34, borderRadius: "50%", background: "conic-gradient(from 0deg,#ffd1e8,#d1e6ff,#d6ffe3,#fff3c9,#ffd1e8)", opacity: .85, boxShadow: "0 0 8px rgba(255,255,255,.8)", pointerEvents: "none" }} />
            <div style={{ position: "relative", display: "flex", gap: 14, padding: "12px 14px 0" }}>
              <div style={{ width: 112, height: 126, background: "#fff", border: "3px solid #fff", borderRadius: 10, boxShadow: "0 3px 8px rgba(20,58,99,.25)", overflow: "hidden", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {profile.avatarUrl
                  ? <img src={profile.avatarUrl} alt="캐릭터 두상" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 7 }} />
                  : <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 13, color: "#a4b6cc", textAlign: "center" }}>캐릭터<br />두상</span>}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ fontFamily: JUA, fontSize: 24, color: NAVY, lineHeight: 1.1 }}>
                  {characterName}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={chip}>학교</span><span style={gaeguVal}>{profile.schoolName ?? "—"}</span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={chip}>학년</span>
                  <span style={gaeguVal}>{profile.grade != null ? `${profile.grade}학년` : "—"}</span>
                  <span style={{ ...chip, marginLeft: 8 }}>성별</span>
                  <span style={gaeguVal}>{profile.gender ? GENDER_LABEL[profile.gender] : "—"}</span>
                </div>
              </div>
            </div>
            {/* 서명 */}
            <div style={{ position: "relative", margin: "10px 14px 0", background: "rgba(255,255,255,.85)", border: "1.5px dashed rgba(20,64,111,.35)", borderRadius: 10, display: "flex", alignItems: "center", gap: 8, padding: "3px 10px" }}>
              <span style={{ fontFamily: JUA, fontSize: 11, color: "#2a5878", flex: "none" }}>서명<br />SIGN</span>
              <canvas
                ref={canvasRef} width={240} height={38}
                onPointerDown={sigDown} onPointerMove={sigMove} onPointerUp={sigUp} onPointerLeave={sigUp}
                style={{ width: 240, height: 38, touchAction: "none", cursor: "crosshair", flex: "none" }}
              />
              <button onClick={sigClear} style={{ marginLeft: "auto", height: 24, padding: "0 9px", border: "1.5px solid #2ea3dd", borderRadius: 999, background: "#fff", color: "#0d6fa8", fontFamily: JUA, fontSize: 11, flex: "none" }}>지움</button>
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 10px" }}>
              <div style={{ width: 104, height: 20, background: `repeating-linear-gradient(90deg,${NAVY} 0 2px,transparent 2px 5px,${NAVY} 5px 6px,transparent 6px 9px)`, opacity: .85 }} />
              <span style={{ fontFamily: JUA, fontSize: 11, color: NAVY }}>NO. 2026-0715</span>
              <span style={{ marginLeft: "auto", fontFamily: GAEGU, fontWeight: 700, fontSize: 13, color: "#2a5878" }}>발급 2026.07.15</span>
            </div>
          </div>
          {/* 배경 스와치 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
            <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 15, color: "#2a5878" }}>카드 배경</span>
            {PALETTES.map((g, i) => (
              <button key={i} className={styles.swatch} onClick={() => setBgIdx(i)}
                style={{ width: 22, height: 22, borderRadius: "50%", background: g, boxShadow: `0 0 0 2.5px ${bgIdx === i ? NAVY : "rgba(20,64,111,.18)"}` }} />
            ))}
          </div>

          {/* ── 스탯 : 유리병 파도 ── */}
          <div style={{ marginTop: 20, borderTop: "2.5px dashed #a8dcf5", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={secTitle}>🫧 이번 여름 스탯</span>
              <span style={secHint}>병에 마우스를 올리면 파도가 찰랑—</span>
            </div>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", alignItems: "flex-end", marginTop: 12, background: "linear-gradient(180deg,#eaf6fe,#fff)", border: "2px solid #cdeeff", borderRadius: 14, padding: "16px 10px 12px" }}>
              {stats.map((s) => (
                <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 20, height: 12, background: "#d9a05b", borderRadius: "4px 4px 0 0", boxShadow: "inset 0 -2px 0 rgba(0,0,0,.15)" }} />
                  <div className={styles.bottle} style={{ position: "relative", width: 54, height: 108, marginTop: -4, background: "rgba(255,255,255,.6)", border: "2px solid rgba(46,163,221,.5)", borderRadius: "11px 11px 16px 16px", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${s.value}%`, backgroundColor: s.color, opacity: .78 }}>
                      <div style={{ position: "absolute", top: -1, left: 0, right: 0, height: 6, backgroundImage: "radial-gradient(circle at 5px 0px,rgba(255,255,255,.95) 4px,transparent 4.5px)", backgroundSize: "10px 6px" }} />
                      <div className={styles.bubbleBlink1} style={{ position: "absolute", left: 10, bottom: 12, width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,.8)" }} />
                      <div className={styles.bubbleBlink2} style={{ position: "absolute", right: 12, bottom: 28, width: 4, height: 4, borderRadius: "50%", background: "rgba(255,255,255,.7)" }} />
                    </div>
                    <span style={{ position: "absolute", left: 0, right: 0, bottom: 7, textAlign: "center", fontFamily: JUA, fontSize: 14, color: "#fff", textShadow: "0 1px 2px rgba(8,50,90,.5)" }}>{s.value}</span>
                  </div>
                  <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 15, color: "#2a5878" }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── 인벤토리 : 코르크보드 ── */}
          <div style={{ marginTop: 20, borderTop: "2.5px dashed #a8dcf5", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={secTitle}>🧺 인벤토리</span>
              <span style={secHint}>메모지에 마우스를 올리면 효과가 보여요</span>
            </div>
            <div style={{ marginTop: 10, background: "#f2e0bd", border: "2.5px solid #d8bd8a", borderRadius: 14, padding: "18px 12px 16px", backgroundImage: "radial-gradient(circle,rgba(160,120,60,.16) 1.5px,transparent 2px)", backgroundSize: "9px 9px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px 10px" }}>
                {items.map((it, i) => (
                  <div key={it.name} className={styles.memo}
                    onMouseEnter={() => setHovItem(i)} onMouseLeave={() => setHovItem(-1)}
                    style={{ position: "relative", background: "#fff", borderRadius: 3, boxShadow: "0 4px 9px rgba(90,60,20,.28)", padding: "14px 6px 9px", textAlign: "center", transform: `rotate(${(i % 2 ? 1 : -1) * (1 + (i % 3)) * 1.3}deg)`, cursor: "help" }}>
                    <div style={{ position: "absolute", top: -7, left: "50%", width: 46, height: 15, marginLeft: -23, background: TAPE[i % 4], transform: "rotate(-3deg)", boxShadow: "0 1px 3px rgba(90,60,20,.25)" }} />
                    {/* 아이콘 자리 — 제작한 아이템 아이콘 이미지로 교체 예정 */}
                    <div style={{ fontSize: 26, lineHeight: 1 }}>{it.icon}</div>
                    <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 14, color: "#2a5878", marginTop: 4 }}>{it.name}</div>
                    <div style={{ position: "absolute", right: -6, bottom: -6, minWidth: 22, height: 22, borderRadius: "50%", background: "#ffef3e", border: "2px solid #e2d15a", fontFamily: JUA, fontSize: 11, color: "#7a6a12", display: "flex", alignItems: "center", justifyContent: "center" }}>x{it.qty}</div>
                    {hovItem === i && (
                      <div className={styles.tooltipPop} style={{ position: "absolute", left: "50%", bottom: -42, width: 154, marginLeft: -77, background: NAVY, color: "#fff", fontFamily: GAEGU, fontWeight: 700, fontSize: 14, lineHeight: 1.3, padding: "6px 9px", borderRadius: 9, zIndex: 30, boxShadow: "0 8px 18px rgba(8,50,90,.35)", pointerEvents: "none" }}>{it.effect}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── 달력 : 스탬프 달력 + 개인 메모 ── */}
          <div style={{ marginTop: 20, borderTop: "2.5px dashed #a8dcf5", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={secTitle}>📅 나의 {month + 1}월</span>
              <span style={secHint}>날짜를 눌러 나만의 메모를 남겨요</span>
            </div>
            <div style={{ marginTop: 10, background: "#fff", border: "2px solid #cdeeff", borderRadius: 14, padding: "12px 10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, textAlign: "center", fontFamily: JUA, fontSize: 11, color: "#7fb3d4" }}>
                <span style={{ color: "#e2695f" }}>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span style={{ color: "#2ea3dd" }}>토</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginTop: 4 }}>
                {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = i + 1;
                  const ev = evMap[d];
                  const isSel = selDay === d;
                  const isToday = d === today.getDate();
                  return (
                    <div key={d} className={styles.day} onClick={() => setSelDay(d)}
                      style={{
                        position: "relative", height: 37, borderRadius: 9, display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", cursor: "pointer",
                        backgroundColor: isSel ? "#ffef3e" : ev ? "#cdeeff" : "transparent",
                        border: isToday ? "2px solid #2ea3dd" : "2px solid transparent",
                      }}>
                      <span style={{ fontFamily: JUA, fontSize: 13, color: isSel ? NAVY : "#2a5878", lineHeight: 1.1 }}>{d}</span>
                      {ev && <span style={{ fontSize: 9, lineHeight: 1, color: "#e0721f", fontFamily: JUA }}>♪</span>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: 10, background: "#e8f7ff", border: "2px solid #a8dcf5", borderRadius: 12, padding: "11px 14px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontFamily: JUA, fontSize: 16, color: "#0d6fa8" }}>{month + 1}월 {selDay}일</span>
                <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 16, color: "#2a5878" }}>{selEv ? `${selEv.icon} ${selEv.title}` : "🌤️ 등록된 일정 없음"}</span>
              </div>
              {memos[selDay] && (
                <div style={{ marginTop: 7, fontFamily: GAEGU, fontWeight: 700, fontSize: 16, color: "#1e7d6a", background: "#fff", borderRadius: 8, padding: "5px 10px" }}>✏️ {memos[selDay]}</div>
              )}
              <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                <input
                  value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveMemo(); }}
                  placeholder="이 날의 메모..."
                  style={{ flex: 1, height: 34, border: "2px solid #bfe4f7", borderRadius: 9, padding: "0 11px", fontFamily: BODY, fontSize: 13, color: "#1e4b6e", outline: "none", background: "#fff", minWidth: 0 }}
                />
                <button onClick={saveMemo} style={{ height: 34, padding: "0 14px", borderRadius: 9, background: "#1a9edb", color: "#fff", fontFamily: JUA, fontSize: 13, boxShadow: "0 3px 0 #0d6fa8", flex: "none" }}>저장</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}