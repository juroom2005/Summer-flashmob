"use client";
// components/noticeboard/panels/MyPanel.tsx — 마이패널 서랍
//
// 로그인된 유저의 마이패널. 열릴 때마다 자체적으로 profile을 fetch.
// 부모(NoticeBoard)는 open/onClose만 관리하고 profile 로직에서 자유로움.
//
// UX:
//   - 우측 슬라이드 서랍
//   - 뒷화면 조작 가능 (딤 오버레이 없음, pointer-events 서랍 영역만)
//   - 닫기 = ✕ 버튼 or 헤더 닉네임 버튼 다시 클릭 (부모에서 토글)
//
// 학생증 커스터마이제이션:
//   - 배경 색상 (cardColor) + 글씨 색상 (textColor) 각각 지정 가능
//   - 서명: 팝업 큰 캔버스에서 편집, 저장 시 실제 그린 영역만 크롭
//
// 학생증 레이아웃:
//   - 두상(왼쪽, 세로로 김) + 정보 컬럼(오른쪽: 이름/학교/학년성별/서명)
//   - 하단: 스트라이프 · NO · 지갑 · 발급일
//
// 데이터 정책 (v5: 색/서명 DB 이관):
//   - 학생증(성명·학교·학년·성별·mobil)과 유리병 스탯은 열릴 때마다 fetch.
//   - cardColor, textColor, signatureData 도 이제 DB(profiles)에서 로드/저장.
//     · 색상: ColorPickerPopup 저장(onConfirm) 시 updateMyCardColors 로 DB UPDATE
//     · 서명: SignaturePopup 저장(onSave) 시 updateMySignature 로 DB UPDATE
//   - localStorage 는 더 이상 사용 안 함. 과거 값이 남아 있으면 로드 없이 "제거만".
//   - 인벤토리·공용 일정은 아직 DB 스키마 없음 → props 미지정 시 DEFAULT 더미.
//   - memos(개인 메모)는 아직 DB 스키마 없음 → 이번 세션 범위 밖. 임시로 컴포넌트
//     생명주기 동안만 유지(새로고침 시 초기화). §7-C 에서 DB 이관 예정.

import { useEffect, useMemo, useRef, useState } from "react";
import { Wheel, ShadeSlider, hexToHsva, hsvaToHex, type HsvaColor } from "@uiw/react-color";
import { JUA, GAEGU, BODY } from "../../auth/fonts";
import {
  getMyPanelProfile,
  updateMyCardColors,
  updateMySignature,
  type MyPanelProfileRow,
} from "@/lib/auth-helpers";
import AccountInfoCard from "./AccountInfoCard";
import InventorySection from "./InventorySection";
import styles from "./MyPanel.module.css";

/* ── 타입 ─────────────────────────────────────── */
type MyPanelDisplayProfile = {
  familyName:    string | null;
  givenName:     string | null;
  schoolName:    string | null;
  grade:         number | null;
  gender:        "male" | "female" | "other" | null;
  mobil:         number;
  avatarUrl?:    string;
  cardImageUrl?: string;
};
export type MyPanelStat = { label: string; value: number; color: string };
export type MyPanelEvent = { day: number; title: string; icon: string };

type Props = {
  open: boolean;
  onClose: () => void;
  events?: MyPanelEvent[];
};

type ColorTarget = "bg" | "text";

/* ── 상수 ─────────────────────────────────── */
const NAVY = "#14406f";
const DEFAULT_CARD_COLOR = "#a5dbf7";
const DEFAULT_TEXT_COLOR = NAVY;

const GENDER_LABEL: Record<"male" | "female" | "other", string> = { male: "남", female: "여", other: "기타" };
const HEX6 = /^#[0-9a-fA-F]{6}$/;

// TODO(공용 일정): community_events 테이블 + GM 관리 UI 붙이면 실데이터 교체
const DEFAULT_EVENTS: MyPanelEvent[] = [
  { day: 4, title: "파트 모집 시작", icon: "📣" },
  { day: 11, title: "안무 1차 합주", icon: "🕺" },
  { day: 15, title: "보컬 연습", icon: "🎤" },
  { day: 24, title: "중간 점검 촬영", icon: "📷" },
  { day: 28, title: "지원 폼 마감", icon: "⏰" },
];

/* ── 유틸: 한 색상에서 학생증 배경 그라디언트 자동 생성 ── */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0; let s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToHex(h: number, s: number, l: number): string {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function toGradient(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  const lighter = hslToHex(h, s, Math.min(l + 8, 100));
  const darker  = hslToHex(h, s, Math.max(l - 15, 0));
  return `linear-gradient(135deg, ${lighter}, ${darker})`;
}

/* ── 유틸: DB에서 온 색상 값 방어 (null·형식 위반 시 기본값) ── */
function normalizeColor(raw: string | null | undefined, fallback: string): string {
  return typeof raw === "string" && HEX6.test(raw) ? raw : fallback;
}

/* ── 유틸: 과거 localStorage 잔재 제거 (읽지 않고 삭제만) ── */
function purgeLegacyLocalStorage(profileId: string) {
  try {
    localStorage.removeItem(`mypanel:${profileId}:state`);
    localStorage.removeItem(`mypanel:${profileId}:sig`);
  } catch { /* ignore */ }
}

/* ═══════════════════════════════════════════════
 * MyPanel 본체
 * ═══════════════════════════════════════════════ */
export default function MyPanel({
  open, onClose,
  events = DEFAULT_EVENTS,
}: Props) {
  /* ── profile 로드 ────────────────────────────── */
  const [profileRow, setProfileRow] = useState<MyPanelProfileRow | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingProfile(true);
    setProfileRow(null);
    (async () => {
      const p = await getMyPanelProfile();
      if (cancelled) return;
      setProfileRow(p);
      setLoadingProfile(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

  /* ── 상태 ────────────────────────────────────── */
  const [cardColor, setCardColor] = useState(DEFAULT_CARD_COLOR);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [colorPopupTarget, setColorPopupTarget] = useState<ColorTarget | null>(null);
  const [showSignaturePopup, setShowSignaturePopup] = useState(false);
  // 저장 실패 시 사용자 안내용 (null이면 배너 없음)
  const [saveError, setSaveError] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const [selDay, setSelDay] = useState(today.getDate());
  // memos: 아직 DB 스키마 없음. 컴포넌트 생명주기 동안만 유지(§7-C 이관 예정).
  const [memos, setMemos] = useState<Record<number, string>>({});
  const [draft, setDraft] = useState("");

  /* ── DB값으로 색/서명 초기화 + 과거 localStorage 잔재 제거 ─── */
  // profileRow 가 바뀔 때(=열릴 때마다 재fetch) DB값을 state에 반영.
  // 로컬 저장은 더 이상 안 함. 과거 키가 남아 있으면 읽지 않고 삭제만.
  useEffect(() => {
    if (!profileRow) {
      setCardColor(DEFAULT_CARD_COLOR);
      setTextColor(DEFAULT_TEXT_COLOR);
      setSignatureDataUrl(null);
      return;
    }
    setCardColor(normalizeColor(profileRow.card_bg_color, DEFAULT_CARD_COLOR));
    setTextColor(normalizeColor(profileRow.card_text_color, DEFAULT_TEXT_COLOR));
    setSignatureDataUrl(profileRow.signature_data ?? null);
    purgeLegacyLocalStorage(profileRow.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileRow?.id, profileRow?.card_bg_color, profileRow?.card_text_color, profileRow?.signature_data]);

  /* ── 파생: 프로필 표시명·스탯 ─────────────────── */
  const displayProfile: MyPanelDisplayProfile = profileRow ? {
    familyName: profileRow.family_name,
    givenName:  profileRow.given_name,
    schoolName: profileRow.school_name,
    grade:      profileRow.grade,
    gender:     profileRow.gender,
    mobil:      profileRow.mobil,
  } : {
    familyName: null, givenName: null, schoolName: null, grade: null, gender: null, mobil: 0,
  };

  const characterName =
    [displayProfile.familyName, displayProfile.givenName].filter(Boolean).join(" ") || "이름 미등록";

  const stats: MyPanelStat[] = profileRow ? [
    { label: "리듬감", value: profileRow.rhythm_stat,     color: "#1a9edb" },
    { label: "체력",   value: profileRow.physical_stat,   color: "#e0a500" },
    { label: "표현력", value: profileRow.expression_stat, color: "#ef8f6a" },
  ] : [];

  /* ── 색상 저장 (팝업 저장 시 DB UPDATE) ──────────
   * 낙관적 반영: state는 이미 라이브 프리뷰로 바뀐 상태.
   * DB UPDATE 실패해도 화면은 유지하고 배너로만 알림(재시도 여지).
   * 성공 시 profileRow 캐시도 갱신해 다음 열람에서 일관성 유지.
   */
  const persistColors = async (nextBg: string, nextText: string) => {
    setSaveError(null);
    const res = await updateMyCardColors({ cardBgColor: nextBg, cardTextColor: nextText });
    if (!res.ok) {
      setSaveError("색상 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setProfileRow((prev) =>
      prev ? { ...prev, card_bg_color: nextBg, card_text_color: nextText } : prev
    );
  };

  /* ── 서명 저장 (팝업 저장 시 DB UPDATE) ────────── */
  const persistSignature = async (dataUrl: string | null) => {
    setSaveError(null);
    // 낙관적 UI 반영
    setSignatureDataUrl(dataUrl);
    const res = await updateMySignature(dataUrl);
    if (!res.ok) {
      setSaveError("서명 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setProfileRow((prev) => (prev ? { ...prev, signature_data: dataUrl } : prev));
  };

  /* ── 달력 파생값 ─────────────────────────────── */
  const year = today.getFullYear(); const month = today.getMonth();
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

  /* ── 인라인 스타일 프리셋 (chip은 흰 배경이라 색상 고정) ─── */
  const secTitle: React.CSSProperties = { fontFamily: JUA, fontSize: 19, color: "#0d6fa8" };
  const secHint: React.CSSProperties = { fontFamily: GAEGU, fontWeight: 700, fontSize: 15, color: "#2ea3dd" };
  const chip: React.CSSProperties = { fontFamily: JUA, fontSize: 11, background: "rgba(255,255,255,.85)", color: "#0d6fa8", borderRadius: 999, padding: "2px 9px" };
  // 그라디언트 배경 위 텍스트에 적용될 스타일 (사용자 지정 textColor 사용)
  const cardText: React.CSSProperties = { color: textColor };
  const gaeguVal: React.CSSProperties = { fontFamily: GAEGU, fontWeight: 700, fontSize: 16, color: textColor };

  const cardGradient = toGradient(cardColor);

  /* ═══ 서랍 래퍼 ═══════════════════════════════ */
  return (
    <div style={{
      position: "absolute", top: 0, bottom: 0, right: 0, width: 470, zIndex: 40,
      transform: open ? "translateX(0)" : "translateX(112%)",
      transition: "transform .55s cubic-bezier(.25,.9,.3,1)",
      pointerEvents: open ? "auto" : "none",
    }}>
      <div style={{
        position: "absolute", inset: 0, background: "#fffdf4", borderLeft: "2.5px solid #2ea3dd",
        borderRadius: "18px 0 0 18px", boxShadow: "-16px 0 40px rgba(20,58,99,.3)",
        backgroundImage: "repeating-linear-gradient(180deg,transparent,transparent 31px,rgba(46,163,221,.08) 31px,rgba(46,163,221,.08) 32px)",
      }} />
      <div style={{ position: "absolute", left: -13, top: 96, width: 26, height: 62, background: "repeating-linear-gradient(45deg,#cdeeff 0 8px,#e9f8ff 8px 16px)", opacity: .92, transform: "rotate(3deg)", borderRadius: 2, boxShadow: "0 2px 5px rgba(20,58,99,.15)", zIndex: 2 }} />
      <div style={{ position: "absolute", left: -13, top: 330, width: 26, height: 62, background: "repeating-linear-gradient(45deg,#fff3a6 0 8px,#fff9d6 8px 16px)", opacity: .92, transform: "rotate(-2deg)", borderRadius: 2, boxShadow: "0 2px 5px rgba(20,58,99,.15)", zIndex: 2 }} />
      <button onClick={onClose} style={{ position: "absolute", top: 16, right: 18, width: 34, height: 34, borderRadius: "50%", border: "2px solid #2ea3dd", background: "#fff", color: "#0d6fa8", fontFamily: JUA, fontSize: 16, zIndex: 6, cursor: "pointer" }}>✕</button>

      <div style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "20px 24px 28px", fontFamily: BODY }}>
        {loadingProfile && !profileRow ? (
          <div style={{ marginTop: 40, textAlign: "center", fontFamily: GAEGU, fontWeight: 700, fontSize: 18, color: "#0d6fa8" }}>
            불러오는 중...
          </div>
        ) : !profileRow ? (
          <div style={{ marginTop: 40, textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontFamily: JUA, fontSize: 20, color: "#0d6fa8" }}>로그인이 필요해요</div>
            <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 15, color: "#2a5878" }}>
              메인 페이지에서 로그인 후 다시 열어주세요
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: JUA, fontSize: 23, color: "#0d6fa8" }}>🎒 {characterName}의 마이 패널</div>
            <div style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 17, color: "#2ea3dd", marginTop: 2 }}>Summer-flashmob!</div>

            {/* 저장 실패 배너 */}
            {saveError && (
              <div style={{ marginTop: 10, background: "#ffe1e1", border: "2px solid #f2a8a8", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 14, color: "#b03a3a", flex: 1 }}>{saveError}</span>
                <button onClick={() => setSaveError(null)} style={{ border: 0, background: "transparent", color: "#b03a3a", fontFamily: JUA, fontSize: 14, cursor: "pointer" }}>✕</button>
              </div>
            )}

            {/* ── 학생증 ── */}
            <div style={{ position: "relative", maxHeight:230, marginTop: 14, borderRadius: 16, overflow: "hidden", border: `2.5px solid ${NAVY}`, boxShadow: "4px 5px 0 rgba(20,58,99,.22)" }}>
              {displayProfile.cardImageUrl && (
                <img src={displayProfile.cardImageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              )}
              <div style={{ position: "absolute", inset: 0, background: cardGradient, opacity: .85, pointerEvents: "none", transition: "background .3s" }} />
              <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle,rgba(255,255,255,.5) 1px,transparent 1.4px)", backgroundSize: "6px 6px", opacity: .3, pointerEvents: "none" }} />

              {/* 상단 흰 바 — 색 고정 (배경이 흰색이라 유지) */}
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(255,255,255,.8)", borderBottom: "1.5px dashed rgba(20,64,111,.3)" }}>
                <span style={{ fontFamily: JUA, fontSize: 15, color: NAVY }}>학생증</span>
                <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 13, color: "#2a5878", letterSpacing: 1 }}>STUDENT ID CARD</span>
                <span style={{ marginLeft: "auto", fontFamily: JUA, fontSize: 10.5, background: NAVY, color: "#fff", borderRadius: 999, padding: "2px 9px" }}>플래시몹 운영 위원회</span>
              </div>

              <div style={{ position: "absolute", top: 44, right: 12, width: 34, height: 34, borderRadius: "50%", background: "conic-gradient(from 0deg,#ffd1e8,#d1e6ff,#d6ffe3,#fff3c9,#ffd1e8)", opacity: .85, boxShadow: "0 0 8px rgba(255,255,255,.8)", pointerEvents: "none" }} />

              {/* 본문 — 두상(세로로 김) + 정보 컬럼(이름/학교/학년성별/서명) */}
              <div style={{ position: "relative", display: "flex", gap: 14, padding: "12px 14px 5px" }}>
                <div style={{
                  width: 112, height: 135,
                  background: "#fff", border: "3px solid #fff", borderRadius: 10,
                  boxShadow: "0 3px 8px rgba(20,58,99,.25)", overflow: "hidden", flex: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {displayProfile.avatarUrl
                    ? <img src={displayProfile.avatarUrl} alt="캐릭터 두상" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 7 }} />
                    : <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 13, color: "#a4b6cc", textAlign: "center" }}>캐릭터<br />두상</span>}
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  {/* 캐릭터 이름 — 사용자 지정 글씨 색 */}
                  <div style={{ fontFamily: JUA, fontSize: 24, lineHeight: 1.1, ...cardText }}>
                    {characterName}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={chip}>학교</span><span style={gaeguVal}>{displayProfile.schoolName ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={chip}>학년</span>
                    <span style={gaeguVal}>{displayProfile.grade != null ? `${displayProfile.grade}학년` : "—"}</span>
                    <span style={{ ...chip, marginLeft: 8 }}>성별</span>
                    <span style={gaeguVal}>{displayProfile.gender ? GENDER_LABEL[displayProfile.gender] : "—"}</span>
                  </div>

                  {/* 서명란 — 두상 옆, 정보 아래에 컴팩트 배치 */}
                  <div
                    className={styles.signatureSlot}
                    onClick={() => setShowSignaturePopup(true)}
                    title="서명 편집"
                    style={{ marginTop: "auto" }}
                  >
                    <span style={{ fontFamily: JUA, fontSize: 10, color: "#2a5878", flex: "none", lineHeight: 1.1 }}>서명<br />SIGN</span>
                    <div className={styles.signaturePreviewWrap}>
                      {signatureDataUrl
                        ? <img src={signatureDataUrl} alt="서명" className={styles.signaturePreview} />
                        : <span className={styles.signaturePlaceholder}>눌러서 서명</span>}
                    </div>
                    <span style={{ fontFamily: JUA, fontSize: 10, color: "#0d6fa8", flex: "none" }}>▸</span>
                  </div>
                </div>
              </div>

              {/* 스트라이프 · NO · 지갑 · 발급일 — 그라디언트 배경 위, 사용자 지정 글씨 색 */}
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 10px", borderTop: "1.5px dashed rgba(20,64,111,.2)" }}>
                <div style={{ width: 80, height: 20, background: `repeating-linear-gradient(90deg,${textColor} 0 2px,transparent 2px 5px,${textColor} 5px 6px,transparent 6px 9px)`, opacity: .85 }} />
                <span style={{ fontFamily: JUA, fontSize: 11, ...cardText }}>NO. 2026-0715</span>
                <span style={{ fontFamily: JUA, fontSize: 12, background: "#ffef3e", color: "#7a6a12", borderRadius: 999, padding: "2px 10px", border: "1.5px solid #e2d15a" }}>
                  🪙 {displayProfile.mobil}
                </span>
                <span style={{ marginLeft: "auto", fontFamily: GAEGU, fontWeight: 700, fontSize: 13, ...cardText }}>발급 2026.07.15</span>
              </div>
            </div>

            {/* 카드 배경·글씨 색상 트리거 (두 세트) */}
            <div className={styles.colorTrigger}>
              <div className={styles.colorTriggerItem}>
                <span className={styles.colorTriggerLabel}>배경</span>
                <div
                  className={styles.colorPreview}
                  style={{ background: cardGradient }}
                  onClick={() => setColorPopupTarget("bg")}
                  title="배경색 편집"
                />
                <button className={styles.colorEditButton} onClick={() => setColorPopupTarget("bg")}>편집</button>
              </div>
              <div className={styles.colorTriggerItem}>
                <span className={styles.colorTriggerLabel}>글씨</span>
                <div
                  className={styles.colorPreview}
                  style={{ background: textColor }}
                  onClick={() => setColorPopupTarget("text")}
                  title="글씨색 편집"
                />
                <button className={styles.colorEditButton} onClick={() => setColorPopupTarget("text")}>편집</button>
              </div>
            </div>

            {/* ── 스탯 : 유리병 파도 ── */}
            <div style={{ marginTop: 20, borderTop: "2.5px dashed #a8dcf5", paddingTop: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={secTitle}>🫧스탯</span>
                <span style={secHint}></span>
              </div>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", alignItems: "flex-end", marginTop: 12, background: "linear-gradient(180deg,#eaf6fe,#fff)", border: "2px solid #cdeeff", borderRadius: 14, padding: "16px 10px 12px" }}>
                {stats.map((s) => {
                  const isEmpty = s.value <= 0;
                  const isFull = s.value >= 100;
                  const bottleClass = [styles.bottle, isFull ? styles.fullBottle : ""].filter(Boolean).join(" ");
                  return (
                    <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 20, height: 12, background: "#d9a05b", borderRadius: "4px 4px 0 0", boxShadow: "inset 0 -2px 0 rgba(0,0,0,.15)" }} />
                      <div className={bottleClass} style={{ position: "relative", width: 54, height: 108, marginTop: -4, background: "rgba(255,255,255,.6)", border: "2px solid rgba(46,163,221,.5)", borderRadius: "11px 11px 16px 16px", overflow: "hidden" }}>
                        {!isEmpty && (
                          <div
                            className={isFull ? styles.rainbowFill : undefined}
                            style={{
                              position: "absolute", left: 0, right: 0, bottom: 0,
                              height: `${Math.min(s.value, 100)}%`,
                              backgroundColor: isFull ? undefined : s.color,
                              opacity: .78,
                            }}
                          >
                            <div style={{ position: "absolute", top: -1, left: 0, right: 0, height: 6, backgroundImage: "radial-gradient(circle at 5px 0px,rgba(255,255,255,.95) 4px,transparent 4.5px)", backgroundSize: "10px 6px" }} />
                            <div className={styles.bubbleBlink1} style={{ position: "absolute", left: 10, bottom: 12, width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,.8)" }} />
                            <div className={styles.bubbleBlink2} style={{ position: "absolute", right: 12, bottom: 28, width: 4, height: 4, borderRadius: "50%", background: "rgba(255,255,255,.7)" }} />
                          </div>
                        )}
                        <span style={{
                          position: "absolute", left: 0, right: 0, bottom: 7, textAlign: "center",
                          fontFamily: JUA, fontSize: 14,
                          color: isEmpty ? "#c8dae8" : "#fff",
                          textShadow: isEmpty ? "none" : "0 1px 2px rgba(8,50,90,.5)",
                        }}>{s.value}</span>
                      </div>
                      <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 15, color: "#2a5878" }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── 인벤토리 (별도 컴포넌트) ── */}
            <InventorySection />

            {/* ── 달력 ── */}
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
                  <button onClick={saveMemo} style={{ height: 34, padding: "0 14px", borderRadius: 9, background: "#1a9edb", color: "#fff", fontFamily: JUA, fontSize: 13, boxShadow: "0 3px 0 #0d6fa8", flex: "none", cursor: "pointer", border: 0 }}>저장</button>
                </div>
              </div>
            </div>

            {/* ── 계정 정보 (최하단) ── */}
            <AccountInfoCard />
          </>
        )}
      </div>

      {/* ── 팝업: 색상 픽커 (배경 or 글씨) ── */}
      {profileRow && colorPopupTarget !== null && (
        <ColorPickerPopup
          key={colorPopupTarget}
          title={colorPopupTarget === "bg" ? "학생증 배경색" : "학생증 글씨색"}
          initialColor={colorPopupTarget === "bg" ? cardColor : textColor}
          onLivePreview={(hex) => {
            if (colorPopupTarget === "bg") setCardColor(hex);
            else setTextColor(hex);
          }}
          onConfirm={() => {
            // 확정 시 현재 두 색을 함께 DB 저장.
            // 편집 중이던 쪽은 라이브 프리뷰로 이미 state 최신값이라 그대로 넘김.
            void persistColors(cardColor, textColor);
            setColorPopupTarget(null);
          }}
          onCancel={(origHex) => {
            if (colorPopupTarget === "bg") setCardColor(origHex);
            else setTextColor(origHex);
            setColorPopupTarget(null);
          }}
        />
      )}

      {/* ── 팝업: 서명 ── */}
      {profileRow && showSignaturePopup && (
        <SignaturePopup
          initialDataUrl={signatureDataUrl}
          onSave={(dataUrl) => {
            void persistSignature(dataUrl);
            setShowSignaturePopup(false);
          }}
          onCancel={() => setShowSignaturePopup(false)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
 * ColorPickerPopup — 원형 색상환 + 명도 + HEX 입력
 * 재사용: 배경색·글씨색 편집 둘 다 이 컴포넌트로 처리 (title/initialColor만 다르게)
 * ═══════════════════════════════════════════════ */
function ColorPickerPopup({
  title,
  initialColor,
  onLivePreview,
  onConfirm,
  onCancel,
}: {
  title: string;
  initialColor: string;
  onLivePreview: (hex: string) => void;
  onConfirm: () => void;
  onCancel: (origHex: string) => void;
}) {
  const origColorRef = useRef(initialColor);
  const [hsva, setHsva] = useState<HsvaColor>(hexToHsva(initialColor));
  const [hexInput, setHexInput] = useState(initialColor.toUpperCase());

  const applyHsva = (next: HsvaColor) => {
    setHsva(next);
    const hex = hsvaToHex(next);
    setHexInput(hex.toUpperCase());
    onLivePreview(hex);
  };

  const applyHexInput = (raw: string) => {
    setHexInput(raw.toUpperCase());
    const trimmed = raw.trim();
    const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
      setHsva(hexToHsva(withHash));
      onLivePreview(withHash);
    }
  };

  return (
    <div className={styles.popupDim} onClick={() => onCancel(origColorRef.current)}>
      <div className={styles.popupBox} onClick={(e) => e.stopPropagation()} style={{ width: 300 }}>
        <div className={styles.popupTitle}>{title}</div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <Wheel color={hsva} onChange={(c) => applyHsva(c.hsva)} width={180} height={180} />
        </div>

        <ShadeSlider
          hsva={hsva}
          onChange={(newShade) => applyHsva({ ...hsva, ...newShade })}
          style={{ marginTop: 2 }}
        />

        <div className={styles.hexInputRow}>
          <span className={styles.hexLabel}>HEX</span>
          <input
            className={styles.hexInput}
            value={hexInput}
            onChange={(e) => applyHexInput(e.target.value)}
            maxLength={7}
            placeholder="#A5DBF7"
          />
        </div>

        <div className={styles.popupActions}>
          <button className={styles.popupCancelButton} onClick={() => onCancel(origColorRef.current)}>취소</button>
          <button className={styles.popupButton} onClick={onConfirm}>저장</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
 * SignaturePopup — 큰 캔버스에서 서명 편집
 * 저장 시: 실제 그린 영역(bbox)만 크롭해서 dataURL 생성 → 서명란에 딱 맞게 표시.
 * ═══════════════════════════════════════════════ */
function SignaturePopup({
  initialDataUrl,
  onSave,
  onCancel,
}: {
  initialDataUrl: string | null;
  onSave: (dataUrl: string | null) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  /* 팝업 열 때 기존 서명을 캔버스 중앙에 그리기 */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !initialDataUrl) return;
    const img = new Image();
    img.onload = () => {
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const cW = el.width, cH = el.height;
      const iW = img.width, iH = img.height;
      const scale = Math.min(cW / iW, cH / iH);
      const dW = iW * scale, dH = iH * scale;
      const dx = (cW - dW) / 2, dy = (cH - dH) / 2;
      ctx.drawImage(img, dx, dy, dW, dH);
    };
    img.src = initialDataUrl;
  }, [initialDataUrl]);

  const ctx = () => {
    const el = canvasRef.current;
    if (!el) return null;
    const c = el.getContext("2d")!;
    c.lineWidth = 2.4; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#14406f";
    return c;
  };
  const pos = (e: React.PointerEvent) => {
    const el = canvasRef.current!;
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) * el.width / r.width, y: (e.clientY - r.top) * el.height / r.height };
  };
  const down = (e: React.PointerEvent) => {
    const c = ctx(); if (!c) return;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = pos(e);
    drawing.current = true;
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 0.01, p.y + 0.01); c.stroke();
    setDirty(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = ctx(); if (!c) return;
    const p = pos(e); c.lineTo(p.x, p.y); c.stroke();
  };
  const up = () => { drawing.current = false; };
  const clear = () => {
    const el = canvasRef.current;
    if (!el) return;
    el.getContext("2d")!.clearRect(0, 0, el.width, el.height);
    setDirty(true);
  };

  const save = () => {
    const el = canvasRef.current;
    if (!el) { onSave(null); return; }
    const cropped = cropToBounds(el, 8);
    onSave(cropped);
  };

  return (
    <div className={styles.popupDim} onClick={onCancel}>
      <div className={styles.popupBox} onClick={(e) => e.stopPropagation()} style={{ width: 360 }}>
        <div className={styles.popupTitle}>서명</div>

        <div style={{
          background: "#fff", border: "1.5px dashed rgba(20,64,111,.35)", borderRadius: 10,
          padding: 6, display: "flex", justifyContent: "center",
        }}>
          <canvas
            ref={canvasRef}
            width={320}
            height={140}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
            style={{ width: 320, height: 140, touchAction: "none", cursor: "crosshair" }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className={styles.popupGhostButton} onClick={clear}>지움</button>
          <span style={{ fontFamily: GAEGU, fontWeight: 700, fontSize: 13, color: "#7fb3d4", marginLeft: 4 }}>
            {dirty ? "변경사항 있음" : "서명하기"}
          </span>
        </div>

        <div className={styles.popupActions}>
          <button className={styles.popupCancelButton} onClick={onCancel}>취소</button>
          <button className={styles.popupButton} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
 * 유틸: 캔버스에서 실제 그려진 영역만 크롭
 * ═══════════════════════════════════════════════ */
function cropToBounds(source: HTMLCanvasElement, padding: number): string | null {
  const ctx = source.getContext("2d");
  if (!ctx) return null;
  const { data, width, height } = ctx.getImageData(0, 0, source.width, source.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const outW = bw + padding * 2;
  const outH = bh + padding * 2;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  outCtx.drawImage(source, minX, minY, bw, bh, padding, padding, bw, bh);
  return out.toDataURL("image/png");
}