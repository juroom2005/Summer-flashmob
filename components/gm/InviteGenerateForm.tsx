// components/gm/InviteGenerateForm.tsx
//
// 초대코드 발급 폼 (v4 — 초기 스탯 입력 추가).
//
// 변경점 (v3 → v4):
//   - 초기 스탯 3칸 추가: 리듬감 / 체력 / 표현력 (선택 입력, 비우면 0)
//   - 각 스탯 0~100 정수 검증 (빈칸은 통과 → 0으로 발급)
//   - EF 요청 body에 rhythm_stat / physical_stat / expression_stat 추가
//   - 발급 완료 배너에 스탯 요약(리 00 · 체 00 · 표 00) 표시
//   - (v3까지) 이름 스키마 분리(성/이름)는 그대로 유지
//
// 폼 배치 (2열 grid):
//   1행: 성 * | 이름 *
//   2행: 나이 * | 성별 *
//   3행: 학교명 * (span 2)
//   4행: 학년 * | 유효기간
//   5행: [스탯] 리듬감 | 체력
//   6행: [스탯] 표현력 | (빈칸)
//   7행: 메모 (span 2)
//
// 스탯 정책:
//   - 시스템상 유저가 자기 초기 스탯을 아는 상태. GM이 발급 시 값 입력.
//   - 비우면 0으로 발급. 나중에 GM이 stat 편집 UI로 조정(별도 세션).

"use client";

import { useState, type CSSProperties } from "react";
import { callEdgeFunction } from "@/lib/ef-client";

const JUA   = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY  = "'Gowun Dodum', sans-serif";

type Gender = "male" | "female" | "other";

type GenerateInviteResponse = {
  code:        string;
  expires_at:  string;
  profile_id:  string;
};

type Props = {
  onGenerated?: (code: string) => void;
};

type LastIssued = GenerateInviteResponse & {
  family_name:     string;
  given_name:      string;
  rhythm_stat:     number;
  physical_stat:   number;
  expression_stat: number;
};

export default function InviteGenerateForm({ onGenerated }: Props) {
  // ── 폼 상태 ──
  const [familyName,     setFamilyName]     = useState("");
  const [givenName,      setGivenName]      = useState("");
  const [age,            setAge]            = useState<string>("");
  const [gender,         setGender]         = useState<Gender | "">("");
  const [schoolName,     setSchoolName]     = useState("");
  const [grade,          setGrade]          = useState<string>("");
  const [expiresInDays,  setExpiresInDays]  = useState<string>("7");
  const [inviteeNote,    setInviteeNote]    = useState("");

  // ── 초기 스탯 상태 (선택 입력, 빈칸 = 0) ──
  const [rhythmStat,     setRhythmStat]     = useState<string>("");
  const [physicalStat,   setPhysicalStat]   = useState<string>("");
  const [expressionStat, setExpressionStat] = useState<string>("");

  // ── 실행 상태 ──
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── 최근 발급 배너 상태 ──
  const [lastIssued, setLastIssued] = useState<LastIssued | null>(null);
  const [copied,     setCopied]     = useState(false);

  function resetFormFields() {
    setFamilyName("");
    setGivenName("");
    setAge("");
    setGender("");
    setSchoolName("");
    setGrade("");
    // expiresInDays는 유지 (대부분 같은 값으로 연속 발급)
    setInviteeNote("");
    // 스탯도 리셋 (사람마다 다르므로)
    setRhythmStat("");
    setPhysicalStat("");
    setExpressionStat("");
    setError(null);
  }

  // 빈칸이면 0, 값이 있으면 0~100 정수인지 확인.
  // 반환: { value } (검증 통과) | { err } (검증 실패)
  function parseStat(raw: string, label: string): { value: number } | { err: string } {
    const t = raw.trim();
    if (t === "") return { value: 0 };
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return { err: `${label}은(는) 0~100 사이의 정수여야 합니다.` };
    }
    return { value: n };
  }

  function validate(): string | null {
    if (!familyName.trim()) return "성을 입력하세요.";
    if (!givenName.trim())  return "이름을 입력하세요.";

    const ageNum = parseInt(age, 10);
    if (!Number.isInteger(ageNum) || ageNum < 1 || ageNum > 150) {
      return "나이는 1~150 사이의 정수여야 합니다.";
    }

    if (gender !== "male" && gender !== "female" && gender !== "other") {
      return "성별을 선택하세요.";
    }

    if (!schoolName.trim()) return "학교명을 입력하세요.";

    const gradeNum = parseInt(grade, 10);
    if (!Number.isInteger(gradeNum) || gradeNum < 1 || gradeNum > 3) {
      return "학년은 1~3 사이의 정수여야 합니다.";
    }

    const expNum = parseInt(expiresInDays, 10);
    if (!Number.isInteger(expNum) || expNum < 7 || expNum > 30) {
      return "유효기간은 7~30일 사이여야 합니다.";
    }

    // 스탯 검증 (빈칸 허용)
    const r = parseStat(rhythmStat, "리듬감");
    if ("err" in r) return r.err;
    const p = parseStat(physicalStat, "체력");
    if ("err" in p) return p.err;
    const e = parseStat(expressionStat, "표현력");
    if ("err" in e) return e.err;

    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationErr = validate();
    if (validationErr) {
      setError(validationErr);
      return;
    }

    // 스탯 값 확정 (validate 통과했으므로 안전)
    const rhythmVal     = (parseStat(rhythmStat, "리듬감") as { value: number }).value;
    const physicalVal   = (parseStat(physicalStat, "체력") as { value: number }).value;
    const expressionVal = (parseStat(expressionStat, "표현력") as { value: number }).value;

    // 리셋 전 스냅샷 확보 (배너 표시용)
    const familySnap = familyName.trim();
    const givenSnap  = givenName.trim();

    setLoading(true);
    try {
      const result = await callEdgeFunction<GenerateInviteResponse>(
        "generate-invite",
        {
          family_name:      familySnap,
          given_name:       givenSnap,
          age:              parseInt(age, 10),
          gender,
          school_name:      schoolName.trim(),
          grade:            parseInt(grade, 10),
          expires_in_days:  parseInt(expiresInDays, 10),
          invitee_note:     inviteeNote.trim() || null,
          rhythm_stat:      rhythmVal,
          physical_stat:    physicalVal,
          expression_stat:  expressionVal,
        }
      );

      if (!result.ok) {
        setError(
          `발급 실패: ${result.error}${result.detail ? ` (${result.detail})` : ""}`
        );
        setLoading(false);
        return;
      }

      setLastIssued({
        ...result.data,
        family_name:     familySnap,
        given_name:      givenSnap,
        rhythm_stat:     rhythmVal,
        physical_stat:   physicalVal,
        expression_stat: expressionVal,
      });
      setCopied(false);
      resetFormFields();
      onGenerated?.(result.data.code);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!lastIssued) return;
    try {
      await navigator.clipboard.writeText(lastIssued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("[InviteGenerateForm] clipboard write failed:", e);
      window.prompt("코드를 복사하세요:", lastIssued.code);
    }
  }

  return (
    <div style={containerStyle}>
      {/* ── 최근 발급 배너 ── */}
      {lastIssued ? (
        <div style={bannerStyle}>
          <div style={bannerLeftStyle}>
            <span style={bannerBadgeStyle}>✓ 발급 완료</span>
            <span style={bannerTargetStyle}>
              {lastIssued.family_name} {lastIssued.given_name}
            </span>
            <span style={bannerStatStyle}>
              리 {lastIssued.rhythm_stat} · 체 {lastIssued.physical_stat} · 표 {lastIssued.expression_stat}
            </span>
          </div>
          <div style={bannerCodeStyle}>{lastIssued.code}</div>
          <div style={bannerRightStyle}>
            <span style={bannerMetaStyle}>
              만료 {formatShortDate(lastIssued.expires_at)}
            </span>
            <button onClick={handleCopy} style={bannerCopyStyle}>
              {copied ? "✓" : "📋"} {copied ? "복사됨" : "복사"}
            </button>
            <button
              onClick={() => setLastIssued(null)}
              style={bannerCloseStyle}
              aria-label="닫기"
              title="닫기"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {/* ── 폼 카드 ── */}
      <form onSubmit={handleSubmit} style={formCardStyle}>
        <div style={formTitleStyle}>📮 초대코드 발급</div>
        <div style={formSubtitleStyle}>초대할 캐릭터 정보를 입력하세요.</div>

        <div style={fieldGridStyle}>
          <Field label="성 *">
            <input
              type="text"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              disabled={loading}
              placeholder="예: 야마다"
              style={inputStyle}
            />
          </Field>

          <Field label="이름 *">
            <input
              type="text"
              value={givenName}
              onChange={(e) => setGivenName(e.target.value)}
              disabled={loading}
              placeholder="예: 하나코"
              style={inputStyle}
            />
          </Field>

          <Field label="나이 *">
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              disabled={loading}
              min={1}
              max={150}
              placeholder="17"
              style={inputStyle}
            />
          </Field>

          <Field label="성별 *">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender | "")}
              disabled={loading}
              style={inputStyle}
            >
              <option value="">선택하세요</option>
              <option value="male">남</option>
              <option value="female">여</option>
              <option value="other">기타</option>
            </select>
          </Field>

          <Field label="학교명 *" span={2}>
            <input
              type="text"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              disabled={loading}
              placeholder="예: 여름고등학교"
              style={inputStyle}
            />
          </Field>

          <Field label="학년 *">
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              disabled={loading}
              style={inputStyle}
            >
              <option value="">선택</option>
              <option value="1">1학년</option>
              <option value="2">2학년</option>
              <option value="3">3학년</option>
            </select>
          </Field>

          <Field label="유효기간(일)">
            <input
              type="number"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              disabled={loading}
              min={7}
              max={30}
              style={inputStyle}
            />
          </Field>

          {/* ── 초기 스탯 구분선 ── */}
          <div style={statDividerStyle}>
            <span style={statDividerLabelStyle}>🫧 초기 스탯 (비우면 0)</span>
          </div>

          <Field label="리듬감 (0~100)">
            <input
              type="number"
              value={rhythmStat}
              onChange={(e) => setRhythmStat(e.target.value)}
              disabled={loading}
              min={0}
              max={100}
              placeholder="0"
              style={inputStyle}
            />
          </Field>

          <Field label="체력 (0~100)">
            <input
              type="number"
              value={physicalStat}
              onChange={(e) => setPhysicalStat(e.target.value)}
              disabled={loading}
              min={0}
              max={100}
              placeholder="0"
              style={inputStyle}
            />
          </Field>

          <Field label="표현력 (0~100)">
            <input
              type="number"
              value={expressionStat}
              onChange={(e) => setExpressionStat(e.target.value)}
              disabled={loading}
              min={0}
              max={100}
              placeholder="0"
              style={inputStyle}
            />
          </Field>

          <Field label="메모 (선택)" span={2}>
            <textarea
              value={inviteeNote}
              onChange={(e) => setInviteeNote(e.target.value)}
              disabled={loading}
              rows={2}
              placeholder="예: 6월 오디션 통과, DM으로 코드 전달"
              style={{ ...inputStyle, height: "auto", padding: "10px 14px", resize: "vertical" }}
            />
          </Field>
        </div>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <button type="submit" disabled={loading} style={submitButtonStyle}>
          {loading ? "발급 중..." : "발급하기"}
        </button>
      </form>
    </div>
  );
}

/* ── Field 헬퍼 ── */

function Field({
  label,
  children,
  span = 1,
}: {
  label:    string;
  children: React.ReactNode;
  span?:    1 | 2;
}) {
  return (
    <div style={{ gridColumn: `span ${span}`, display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={fieldLabelStyle}>{label}</label>
      {children}
    </div>
  );
}

/* ── 유틸 ── */

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${m}/${day} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

/* ── 스타일 ── */

const containerStyle: CSSProperties = {
  display:        "flex",
  flexDirection:  "column",
  gap:            12,
};

const formCardStyle: CSSProperties = {
  padding:      "24px 28px",
  background:   "#fff",
  border:       "2px solid #bfe4f7",
  borderRadius: 18,
  boxShadow:    "0 4px 0 rgba(46,163,221,.15)",
};

const formTitleStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     22,
  color:        "#0d6fa8",
  marginBottom: 4,
};

const formSubtitleStyle: CSSProperties = {
  fontFamily:   GAEGU,
  fontWeight:   700,
  fontSize:     14,
  color:        "#2ea3dd",
  marginBottom: 20,
};

const fieldGridStyle: CSSProperties = {
  display:              "grid",
  gridTemplateColumns:  "1fr 1fr",
  gap:                  "14px 16px",
  marginBottom:         16,
};

const fieldLabelStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   13,
  color:      "#14406f",
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  height:       40,
  border:       "2px solid #bfe4f7",
  borderRadius: 10,
  padding:      "0 12px",
  fontFamily:   BODY,
  fontSize:     14,
  color:        "#1e4b6e",
  outline:      "none",
  background:   "#f4fbff",
  width:        "100%",
};

// 스탯 구분선 (grid 2열 전체 차지)
const statDividerStyle: CSSProperties = {
  gridColumn:    "span 2",
  display:       "flex",
  alignItems:    "center",
  gap:           10,
  marginTop:     4,
  paddingTop:    12,
  borderTop:     "2px dashed #cdeeff",
};

const statDividerLabelStyle: CSSProperties = {
  fontFamily: GAEGU,
  fontWeight: 700,
  fontSize:   14,
  color:      "#2ea3dd",
};

const errorStyle: CSSProperties = {
  padding:      "10px 14px",
  fontFamily:   BODY,
  fontSize:     13,
  color:        "#c0392b",
  background:   "rgba(192, 57, 43, 0.08)",
  border:       "1.5px solid rgba(192, 57, 43, 0.25)",
  borderRadius: 8,
  marginBottom: 12,
};

const submitButtonStyle: CSSProperties = {
  width:        "100%",
  height:       46,
  border:       0,
  borderRadius: 12,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     17,
  cursor:       "pointer",
  boxShadow:    "0 4px 0 #0d6fa8",
};

/* ── 배너 스타일 ── */

const bannerStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  gap:            14,
  padding:        "12px 16px",
  background:     "#c9f2e6",
  border:         "2px solid #4db6a0",
  borderRadius:   14,
  boxShadow:      "0 3px 0 rgba(77,182,160,.3)",
  flexWrap:       "wrap",
};

const bannerLeftStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
  minWidth:   0,
};

const bannerBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     13,
  color:        "#fff",
  background:   "#4db6a0",
  padding:      "3px 10px",
  borderRadius: 999,
  whiteSpace:   "nowrap",
};

const bannerTargetStyle: CSSProperties = {
  fontFamily:    BODY,
  fontSize:      14,
  fontWeight:    700,
  color:         "#1e7d6a",
  overflow:      "hidden",
  textOverflow:  "ellipsis",
  whiteSpace:    "nowrap",
  maxWidth:      180,
};

const bannerStatStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#2f8a75",
  background:   "rgba(255,255,255,.6)",
  border:       "1.5px solid rgba(77,182,160,.4)",
  borderRadius: 999,
  padding:      "2px 10px",
  whiteSpace:   "nowrap",
};

const bannerCodeStyle: CSSProperties = {
  fontFamily:    "monospace",
  fontSize:      18,
  fontWeight:    700,
  color:         "#1e7d6a",
  letterSpacing: "0.12em",
  padding:       "6px 12px",
  background:    "#fff",
  border:        "1.5px solid rgba(77,182,160,.5)",
  borderRadius:  8,
  flex:          1,
  textAlign:     "center",
  minWidth:      160,
};

const bannerRightStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
  marginLeft: "auto",
};

const bannerMetaStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#2f8a75",
  whiteSpace: "nowrap",
};

const bannerCopyStyle: CSSProperties = {
  height:       32,
  padding:      "0 12px",
  border:       "2px solid #4db6a0",
  borderRadius: 8,
  background:   "#fff",
  color:        "#1e7d6a",
  fontFamily:   JUA,
  fontSize:     12,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const bannerCloseStyle: CSSProperties = {
  width:          28,
  height:         28,
  border:         "1.5px solid rgba(77,182,160,.4)",
  borderRadius:   8,
  background:     "rgba(255,255,255,.6)",
  color:          "#2f8a75",
  fontSize:       14,
  cursor:         "pointer",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
};