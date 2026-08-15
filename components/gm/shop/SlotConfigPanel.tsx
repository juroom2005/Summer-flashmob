// components/gm/shop/SlotConfigPanel.tsx
//
// GM 슬롯머신 설정 패널 (매점 관리 탭 상단, 접이식).
//
// 조정 항목:
//   · spin_cost    : 1회 스핀 비용 (모빌)
//   · jackpot_rate : 잭팟(인형) 확률. UI 는 % 로 입력받아 0~1 로 저장.
//   · lock_seconds : 슬롯 진입 후 첫 스핀 오클릭 방지 대기 초 (클라 UX 값)
//   · is_locked    : 슬롯 잠금 on/off (서버 강제 — 켜면 spin_slot 이 거부)
//   · lock_message : 잠금 시 유저에게 보여줄 안내문 (선택)
//
// 저장은 updateSlotConfig (slot_config UPDATE, RLS 로 GM 만 허용).
// 값 범위는 헬퍼가 선검증하고 서버 CHECK 가 최종 방어한다.

"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import {
  getSlotConfig,
  updateSlotConfig,
  SLOT_COST_MAX,
  SLOT_LOCK_SEC_MAX,
  type SlotConfig,
} from "@/lib/slot-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** 확률(0~1) → 표시용 % 문자열. 소수 셋째 자리까지. */
function rateToPercentText(rate: number): string {
  const pct = rate * 100;
  // 불필요한 0 제거 (2.000 → 2, 2.500 → 2.5)
  return String(Number(pct.toFixed(3)));
}

export default function SlotConfigPanel() {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 폼 상태 (문자열 입력)
  const [costText, setCostText]       = useState("");
  const [rateText, setRateText]       = useState(""); // % 단위
  const [lockSecText, setLockSecText] = useState("");
  const [isLocked, setIsLocked]       = useState(false);
  const [lockMessage, setLockMessage] = useState("");

  const applyConfig = useCallback((c: SlotConfig) => {
    setCostText(String(c.spinCost));
    setRateText(rateToPercentText(c.jackpotRate));
    setLockSecText(String(c.lockSeconds));
    setIsLocked(c.isLocked);
    setLockMessage(c.lockMessage);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const c = await getSlotConfig();
    applyConfig(c);
    setLoading(false);
  }, [applyConfig]);

  useEffect(() => { void load(); }, [load]);

  /* ── 파생 검증 ── */
  const cost = Number(costText);
  const costValid =
    costText.trim() !== "" && Number.isInteger(cost) && cost >= 0 && cost <= SLOT_COST_MAX;

  const ratePct = Number(rateText);
  const rateValid =
    rateText.trim() !== "" && Number.isFinite(ratePct) && ratePct >= 0 && ratePct <= 100;

  const lockSec = Number(lockSecText);
  const lockSecValid =
    lockSecText.trim() !== "" && Number.isInteger(lockSec) && lockSec >= 0 && lockSec <= SLOT_LOCK_SEC_MAX;

  const allValid = costValid && rateValid && lockSecValid;

  const handleSave = useCallback(async () => {
    if (!allValid || saving) return;
    setSaving(true);
    setMsg(null);

    const res = await updateSlotConfig({
      spinCost:    cost,
      jackpotRate: ratePct / 100,   // % → 0~1
      lockSeconds: lockSec,
      isLocked,
      lockMessage: lockMessage.trim(),
    });

    setSaving(false);

    if (!res.ok) {
      const text =
        res.reason === "permission_denied" ? "권한이 없습니다. GM 계정으로 로그인했는지 확인해 주십시오." :
        res.reason === "invalid_value"     ? "입력값이 허용 범위를 벗어났습니다." :
                                             "저장에 실패했습니다. 잠시 후 다시 시도해 주십시오.";
      setMsg({ kind: "err", text });
      return;
    }

    applyConfig(res.config);
    setMsg({ kind: "ok", text: "저장되었습니다." });
  }, [allValid, saving, cost, ratePct, lockSec, isLocked, lockMessage, applyConfig]);

  return (
    <div style={wrapStyle}>
      {/* 헤더 (토글) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={headerStyle}
      >
        <span style={headerTitleStyle}>
          슬롯머신 설정
          {isLocked ? <span style={lockedTagStyle}>잠김</span> : null}
        </span>
        <span style={chevronStyle}>{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div style={bodyStyle}>
          {loading ? (
            <div style={noticeStyle}>불러오는 중입니다…</div>
          ) : (
            <>
              <div style={gridStyle}>
                {/* 비용 */}
                <div style={fieldStyle}>
                  <label style={labelStyle}>1회 비용 (모빌)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={costText}
                    onChange={(e) => { setCostText(e.target.value.replace(/[^\d]/g, "")); setMsg(null); }}
                    disabled={saving}
                    style={inputStyle}
                  />
                  <div style={metaStyle}>
                    <span style={costValid ? okStyle : badStyle}>
                      {costValid ? `${cost.toLocaleString()} 모빌` : `0 ~ ${SLOT_COST_MAX.toLocaleString()} 정수`}
                    </span>
                  </div>
                </div>

                {/* 잭팟 확률 */}
                <div style={fieldStyle}>
                  <label style={labelStyle}>잭팟(인형) 확률 (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rateText}
                    onChange={(e) => { setRateText(e.target.value.replace(/[^\d.]/g, "")); setMsg(null); }}
                    disabled={saving}
                    style={inputStyle}
                  />
                  <div style={metaStyle}>
                    <span style={rateValid ? okStyle : badStyle}>
                      {rateValid ? `${ratePct}% 확률로 인형 당첨` : "0 ~ 100 사이"}
                    </span>
                  </div>
                </div>

                {/* 진입 대기 초 */}
                <div style={fieldStyle}>
                  <label style={labelStyle}>진입 대기 (초)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={lockSecText}
                    onChange={(e) => { setLockSecText(e.target.value.replace(/[^\d]/g, "")); setMsg(null); }}
                    disabled={saving}
                    style={inputStyle}
                  />
                  <div style={metaStyle}>
                    <span style={lockSecValid ? okStyle : badStyle}>
                      {lockSecValid
                        ? "슬롯 진입 후 첫 스핀까지 오클릭 방지 대기"
                        : `0 ~ ${SLOT_LOCK_SEC_MAX.toLocaleString()} 정수`}
                    </span>
                  </div>
                </div>
              </div>

              {/* 잠금 토글 + 안내문구 */}
              <div style={lockRowStyle}>
                <label style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={isLocked}
                    onChange={(e) => { setIsLocked(e.target.checked); setMsg(null); }}
                    disabled={saving}
                    style={{ margin: 0 }}
                  />
                  <span style={checkboxLabelStyle}>슬롯 잠금 (점검·패치 중 스핀 차단)</span>
                </label>
                <input
                  type="text"
                  value={lockMessage}
                  maxLength={120}
                  onChange={(e) => { setLockMessage(e.target.value); setMsg(null); }}
                  disabled={saving || !isLocked}
                  placeholder="잠금 중 안내 문구 (선택)"
                  style={{ ...inputStyle, opacity: isLocked ? 1 : 0.5 }}
                />
              </div>

              {msg ? (
                <div style={msg.kind === "ok" ? okBarStyle : errBarStyle}>{msg.text}</div>
              ) : null}

              <div style={actionRowStyle}>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!allValid || saving}
                  style={{
                    ...saveBtnStyle,
                    opacity: (!allValid || saving) ? 0.4 : 1,
                    cursor:  (!allValid || saving) ? "not-allowed" : "pointer",
                  }}
                >
                  {saving ? "저장 중…" : "저장"}
                </button>
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={saving}
                  style={resetBtnStyle}
                >
                  되돌리기
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  background:   "#fff",
  border:       "1.5px solid #dce8f0",
  borderRadius: 12,
  marginBottom: 12,
  overflow:     "hidden",
};

const headerStyle: CSSProperties = {
  width:          "100%",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  padding:        "12px 16px",
  background:     "#f4fafd",
  border:         "none",
  cursor:         "pointer",
};

const headerTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   15,
  color:      "#0d6fa8",
  display:    "flex",
  alignItems: "center",
  gap:        8,
};

const lockedTagStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     11,
  color:        "#fff",
  background:   "#e05543",
  borderRadius: 999,
  padding:      "1px 8px",
};

const chevronStyle: CSSProperties = {
  fontSize: 11,
  color:    "#7a94a8",
};

const bodyStyle: CSSProperties = {
  padding:    "14px 16px 16px",
  borderTop:  "1.5px solid #eaf2f7",
};

const noticeStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12.5,
  color:      "#8a7050",
  padding:    "12px 0",
  textAlign:  "center",
};

const gridStyle: CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap:                 12,
};

const fieldStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           4,
  minWidth:      0,
};

const labelStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   12,
  color:      "#0d6fa8",
};

const inputStyle: CSSProperties = {
  height:       34,
  border:       "1.5px solid #cfe4f2",
  borderRadius: 8,
  padding:      "0 12px",
  fontFamily:   BODY,
  fontSize:     13,
  color:        "#2c4a60",
  outline:      "none",
  background:   "#fff",
  minWidth:     0,
};

const metaStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  minHeight:  14,
};

const okStyle:  CSSProperties = { color: "#5a7488" };
const badStyle: CSSProperties = { color: "#c25a4d" };

const lockRowStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  marginTop:     14,
  paddingTop:    14,
  borderTop:     "1px dashed #e0ebf2",
};

const checkboxRowStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
  cursor:     "pointer",
};

const checkboxLabelStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#0d6fa8",
};

const okBarStyle: CSSProperties = {
  marginTop:    12,
  background:   "#eafaf1",
  border:       "1.5px solid #b8e6cd",
  borderRadius: 8,
  padding:      "7px 12px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#2e7d52",
};

const errBarStyle: CSSProperties = {
  marginTop:    12,
  background:   "#fdecea",
  border:       "1.5px solid #f2b8b0",
  borderRadius: 8,
  padding:      "7px 12px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#a3413a",
};

const actionRowStyle: CSSProperties = {
  display:    "flex",
  gap:        8,
  marginTop:  14,
};

const saveBtnStyle: CSSProperties = {
  height:       36,
  padding:      "0 24px",
  border:       "2px solid #0d6fa8",
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     13,
  boxShadow:    "0 3px 0 #0d6fa8",
};

const resetBtnStyle: CSSProperties = {
  height:       36,
  padding:      "0 18px",
  border:       "1.5px solid #cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     12,
  cursor:       "pointer",
};
