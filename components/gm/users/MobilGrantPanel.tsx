// components/gm/users/MobilGrantPanel.tsx
//
// 유저 재화(mobil) 지급·차감 패널.
//
// 방식:
//   · 절대값 덮어쓰기 없음. 반드시 증감(delta) + mobil_grants 이력 자동 기록
//     → 사고 시 추적 가능성 확보
//   · 빠른 버튼: -1000 -500 -100 -10 -1 │ +1 +10 +100 +500 +1000 +5000 +10000
//   · 직접 입력: -100000 ~ +100000 (세부 조정용)
//   · 사유 메모(선택) → mobil_grants.note 로 저장
//
// 서버 처리:
//   · FOR UPDATE 행 잠금 → 동시 지급 경합 차단
//   · 차감 결과가 음수면 거부 (insufficient_mobil)
//   · grant_type='gm_grant', granted_by=auth.uid() 자동 기록
//
// 낙관적 UI 미사용:
//   차감 거부·경합 가능성이 있어 서버 반환 잔액을 그대로 반영.

"use client";

import { useState, type CSSProperties, type ChangeEvent } from "react";
import { grantGmMobil } from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** 빠른 지급 버튼 단위. */
const MINUS_STEPS = [-1000, -500, -100, -10, -1] as const;
const PLUS_STEPS  = [1, 10, 100, 500, 1000, 5000, 10000] as const;

/** 직접 입력 허용 범위. */
const MANUAL_MIN = -100000;
const MANUAL_MAX =  100000;

type Props = {
  profileId: string;
  mobil:     number;
  /** 지급 성공 시 부모 목록 상태 갱신용. 인자는 조정 후 최종 잔액. */
  onGranted: (nextMobil: number) => void;
};

export default function MobilGrantPanel({
  profileId,
  mobil,
  onGranted,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [note,    setNote]    = useState("");
  const [manual,  setManual]  = useState("");

  async function grant(amount: number) {
    if (pending || amount === 0) return;
    setPending(true);
    setError(null);

    const res = await grantGmMobil(profileId, amount, note);

    if (res.ok) {
      onGranted(res.data);
      setManual("");
      // 사유 메모는 연속 지급 시 재사용할 수 있으므로 비우지 않음
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  function handleManualSubmit() {
    const n = Number(manual);
    if (!Number.isInteger(n) || n === 0) {
      setError("0이 아닌 정수를 입력해주십시오.");
      return;
    }
    if (n < MANUAL_MIN || n > MANUAL_MAX) {
      setError(
        `직접 입력은 ${MANUAL_MIN.toLocaleString()}에서 ${MANUAL_MAX.toLocaleString()} 사이만 가능합니다.`
      );
      return;
    }
    void grant(n);
  }

  return (
    <div style={wrapStyle}>
      <div style={headerRowStyle}>
        <span style={sectionTitleStyle}>💰 재화 지급</span>
        <span style={balanceStyle}>
          현재 잔액 <strong style={balanceNumStyle}>{mobil.toLocaleString()}</strong>
        </span>
      </div>

      {/* 사유 메모 */}
      <input
        value={note}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
        placeholder="지급 사유 (선택)"
        maxLength={200}
        disabled={pending}
        style={noteInputStyle}
      />

      {/* 차감 버튼 */}
      <div style={buttonRowStyle}>
        {MINUS_STEPS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => grant(v)}
            disabled={pending}
            style={{
              ...stepButtonStyle,
              color:       "#c2410c",
              borderColor: "#f3c9b4",
              opacity:     pending ? 0.4 : 1,
              cursor:      pending ? "not-allowed" : "pointer",
            }}
          >
            {v.toLocaleString()}
          </button>
        ))}
      </div>

      {/* 지급 버튼 */}
      <div style={buttonRowStyle}>
        {PLUS_STEPS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => grant(v)}
            disabled={pending}
            style={{
              ...stepButtonStyle,
              color:       "#0d6fa8",
              borderColor: "#bfe4f7",
              opacity:     pending ? 0.4 : 1,
              cursor:      pending ? "not-allowed" : "pointer",
            }}
          >
            +{v.toLocaleString()}
          </button>
        ))}
      </div>

      {/* 직접 입력 */}
      <div style={manualRowStyle}>
        <input
          value={manual}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            // 부호와 숫자만 허용
            const v = e.target.value.replace(/[^\d-]/g, "");
            setManual(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleManualSubmit();
          }}
          placeholder="직접 입력 (음수는 차감)"
          disabled={pending}
          style={manualInputStyle}
        />
        <button
          type="button"
          onClick={handleManualSubmit}
          disabled={pending || manual.trim().length === 0}
          style={{
            ...manualButtonStyle,
            opacity: pending || manual.trim().length === 0 ? 0.4 : 1,
            cursor:  pending || manual.trim().length === 0 ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "처리 중" : "적용"}
        </button>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={noteStyle}>
        모든 지급·차감은 이력에 기록됩니다. 잔액이 음수가 되는 차감은 거부됩니다.
      </div>
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  padding:       12,
  background:    "#fffdf5",
  border:        "1.5px solid #f0e4c0",
  borderRadius:  10,
};

const headerRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            8,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#9a6b00",
};

const balanceStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#7a6a3a",
};

const balanceNumStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   14,
  color:      "#9a6b00",
};

const noteInputStyle: CSSProperties = {
  height:       30,
  border:       "1.5px solid #ecdcb0",
  borderRadius: 8,
  padding:      "0 10px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#4a4030",
  outline:      "none",
  background:   "#fff",
};

const buttonRowStyle: CSSProperties = {
  display:  "flex",
  flexWrap: "wrap",
  gap:      4,
};

const stepButtonStyle: CSSProperties = {
  minWidth:     46,
  height:       26,
  padding:      "0 8px",
  border:       "1.5px solid #bfe4f7",
  borderRadius: 999,
  background:   "#fff",
  fontFamily:   JUA,
  fontSize:     11,
};

const manualRowStyle: CSSProperties = {
  display: "flex",
  gap:     6,
};

const manualInputStyle: CSSProperties = {
  flex:         1,
  minWidth:     0,
  height:       30,
  border:       "1.5px solid #ecdcb0",
  borderRadius: 8,
  padding:      "0 10px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#4a4030",
  outline:      "none",
  background:   "#fff",
};

const manualButtonStyle: CSSProperties = {
  height:       30,
  padding:      "0 14px",
  border:       0,
  borderRadius: 8,
  background:   "#e0a500",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     12,
  flexShrink:   0,
};

const errorStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#c2410c",
};

const noteStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#9a8c6a",
};