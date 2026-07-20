// components/gm/users/UserEditForm.tsx
//
// 유저 기본 정보 6종 수정 폼.
//   family_name / given_name / age / gender / school_name / grade
//
// 수정 대상 밖 (의도적 제외):
//   · is_gm            — protect_is_gm_column 트리거가 DB 레벨에서 차단
//   · mobil            — MobilGrantPanel 사용 (이력 기록 필요)
//   · 스탯 3종         — StatAdjustPanel 사용 (증감 방식)
//   · 학생증 커스텀     — 본인 소관 (card_bg_color / signature_data 등)
//
// 동작:
//   · 마운트 시 현재 값으로 폼 초기화
//   · 변경된 필드만 patch 로 전송 (RPC가 COALESCE로 부분 수정 처리)
//   · 저장 성공 시 부모에 갱신 통지
//   · 변경 사항 없으면 저장 버튼 비활성
//
// shell profile(미가입) 주의:
//   profiles_registered_required CHECK 는 user_id IS NULL 이면 통과하므로
//   shell 상태에서는 일부 필드가 비어 있을 수 있음. 폼은 그대로 허용.

"use client";

import { useEffect, useState, type CSSProperties, type ChangeEvent } from "react";
import {
  updateGmUserProfile,
  type GmProfilePatch,
  type GmUserRow,
} from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

const GENDER_OPTIONS: { value: "male" | "female" | "other"; label: string }[] = [
  { value: "male",   label: "남" },
  { value: "female", label: "여" },
  { value: "other",  label: "기타" },
];

type Props = {
  user:      GmUserRow;
  /** 저장 성공 시 부모 목록 갱신용. */
  onSaved:   (patch: GmProfilePatch) => void;
};

/** 숫자 입력값을 안전하게 파싱. 빈 문자열이면 null. */
function parseNum(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

export default function UserEditForm({ user, onSaved }: Props) {
  const [familyName, setFamilyName] = useState(user.family_name ?? "");
  const [givenName,  setGivenName]  = useState(user.given_name  ?? "");
  const [age,        setAge]        = useState(user.age   !== null ? String(user.age)   : "");
  const [gender,     setGender]     = useState<string>(user.gender ?? "");
  const [schoolName, setSchoolName] = useState(user.school_name ?? "");
  const [grade,      setGrade]      = useState(user.grade !== null ? String(user.grade) : "");

  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [saved,   setSaved]   = useState(false);

  // 대상 유저가 바뀌면 폼 재초기화
  useEffect(() => {
    setFamilyName(user.family_name ?? "");
    setGivenName(user.given_name ?? "");
    setAge(user.age !== null ? String(user.age) : "");
    setGender(user.gender ?? "");
    setSchoolName(user.school_name ?? "");
    setGrade(user.grade !== null ? String(user.grade) : "");
    setError(null);
    setSaved(false);
  }, [user.id, user.family_name, user.given_name, user.age, user.gender, user.school_name, user.grade]);

  /** 현재 폼과 원본을 비교해 변경된 필드만 추린다. */
  function buildPatch(): GmProfilePatch | null {
    const patch: GmProfilePatch = {};

    const fn = familyName.trim();
    const gn = givenName.trim();
    const sn = schoolName.trim();
    const ageNum   = parseNum(age);
    const gradeNum = parseNum(grade);

    if (fn !== (user.family_name ?? "")) patch.family_name = fn;
    if (gn !== (user.given_name  ?? "")) patch.given_name  = gn;
    if (sn !== (user.school_name ?? "")) patch.school_name = sn;
    if (ageNum   !== user.age)   { if (ageNum   !== null) patch.age   = ageNum; }
    if (gradeNum !== user.grade) { if (gradeNum !== null) patch.grade = gradeNum; }
    if (gender !== (user.gender ?? "") && gender !== "") {
      patch.gender = gender as "male" | "female" | "other";
    }

    return Object.keys(patch).length > 0 ? patch : null;
  }

  const patch = buildPatch();
  const hasChanges = patch !== null;

  async function handleSave() {
    if (pending || !patch) return;

    setPending(true);
    setError(null);
    setSaved(false);

    const res = await updateGmUserProfile(user.id, patch);

    if (res.ok) {
      onSaved(patch);
      setSaved(true);
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  function handleReset() {
    setFamilyName(user.family_name ?? "");
    setGivenName(user.given_name ?? "");
    setAge(user.age !== null ? String(user.age) : "");
    setGender(user.gender ?? "");
    setSchoolName(user.school_name ?? "");
    setGrade(user.grade !== null ? String(user.grade) : "");
    setError(null);
    setSaved(false);
  }

  return (
    <div style={wrapStyle}>
      <div style={sectionTitleStyle}>📝 기본 정보</div>

      <div style={gridStyle}>
        <Field label="성">
          <input
            value={familyName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFamilyName(e.target.value)}
            maxLength={20}
            disabled={pending}
            style={inputStyle}
          />
        </Field>

        <Field label="이름">
          <input
            value={givenName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setGivenName(e.target.value)}
            maxLength={20}
            disabled={pending}
            style={inputStyle}
          />
        </Field>

        <Field label="나이">
          <input
            value={age}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setAge(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="1-150"
            maxLength={3}
            disabled={pending}
            style={inputStyle}
          />
        </Field>

        <Field label="성별">
          <select
            value={gender}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setGender(e.target.value)}
            disabled={pending}
            style={inputStyle}
          >
            <option value="">미설정</option>
            {GENDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="학교">
          <input
            value={schoolName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSchoolName(e.target.value)}
            maxLength={50}
            disabled={pending}
            style={inputStyle}
          />
        </Field>

        <Field label="학년">
          <select
            value={grade}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setGrade(e.target.value)}
            disabled={pending}
            style={inputStyle}
          >
            <option value="">미설정</option>
            <option value="1">1학년</option>
            <option value="2">2학년</option>
            <option value="3">3학년</option>
          </select>
        </Field>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}
      {saved && !hasChanges ? (
        <div style={savedStyle}>저장되었습니다.</div>
      ) : null}

      <div style={buttonRowStyle}>
        <button
          type="button"
          onClick={handleReset}
          disabled={pending || !hasChanges}
          style={{
            ...resetButtonStyle,
            opacity: pending || !hasChanges ? 0.4 : 1,
            cursor:  pending || !hasChanges ? "not-allowed" : "pointer",
          }}
        >
          되돌리기
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !hasChanges}
          style={{
            ...saveButtonStyle,
            opacity: pending || !hasChanges ? 0.4 : 1,
            cursor:  pending || !hasChanges ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "저장 중" : "저장"}
        </button>
      </div>
    </div>
  );
}

/* ── 내부 소형 컴포넌트 ── */

function Field({
  label,
  children,
}: {
  label:    string;
  children: React.ReactNode;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  padding:       12,
  background:    "#fafcfe",
  border:        "1.5px solid #dde8f0",
  borderRadius:  10,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#0d6fa8",
};

const gridStyle: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap:                 8,
};

const fieldStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           3,
};

const fieldLabelStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#5a7488",
};

const inputStyle: CSSProperties = {
  height:       30,
  border:       "1.5px solid #cfe4f2",
  borderRadius: 8,
  padding:      "0 10px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#2c4a60",
  outline:      "none",
  background:   "#fff",
  width:        "100%",
  boxSizing:    "border-box",
};

const buttonRowStyle: CSSProperties = {
  display:        "flex",
  gap:            6,
  justifyContent: "flex-end",
};

const resetButtonStyle: CSSProperties = {
  height:       28,
  padding:      "0 14px",
  border:       "1.5px solid #cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     11.5,
};

const saveButtonStyle: CSSProperties = {
  height:       28,
  padding:      "0 18px",
  border:       0,
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     11.5,
};

const errorStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#c2410c",
};

const savedStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#2a8a6a",
};