// components/noticeboard/cover/SlotZone.tsx
// ═══════════════════════════════════════════════════════════════════
// board 커버 우측 하단 "슬롯 구역" — 마테(정적) + 슬롯머신(동적) 두뇌
// ═══════════════════════════════════════════════════════════════════
//
// 정적 : 마테 3겹(slot-mat-stack) + //G_G// 표정(스핀 시 랜덤 + 펄스)
// 동적 : 슬롯머신(SlotCabinetPop) 연동. 이 컴포넌트가 "두뇌".
//   · 모빌 : useCurrentUser 에서 읽고, 스핀 후 profile-changed 로 갱신 유도
//   · 비용/락 : slot_config(getSlotConfig) — spin_cost·lock_seconds (동적)
//   · 50초 락 : 클라 메모리. 첫 스핀 전(또는 만료 후) 확인 모달.
//               스핀할 때마다 리셋. 새로고침하면 리셋(=다시 모달).
//   · 서버 : spinSlot() RPC. 판정·차감·지급 전부 서버. 여기선 결과만.
//   · 보상 : 슬롯 왼쪽 빈 자리 "뿅"(REWARD_SHOW_MS 후 사라짐) + 획득 팝업.
//
// 제어 흐름 (핵심) :
//   SlotCabinetPop 이 클릭 시 onSpin() 을 await 한다.
//   - 락 아님 → 즉시 서버 스핀, 결과 반환 → 릴이 그 결과로 돎
//   - 락 임   → 확인 모달을 띄우고 Promise 를 "보류". 확인 시 서버 스핀 후
//               결과로 resolve → 릴이 그때 돎 / 취소 시 null resolve → 안 돎
//   이 방식이라 SlotCabinetPop 은 수정 없이 그대로, 확인 스핀도 릴이 정상 회전.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import { getSlotConfig, spinSlot, type SlotReward } from "@/lib/slot-helpers";
import SlotCabinetPop from "./SlotCabinetPop";

// ────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────
const FACES = ["//G_G//", "//^o^//", "//>_<//", "//˘v˘//", "//O_O//", "//^3^//"];
const REWARD_SHOW_MS = 3500;   
const REEL_STOP_MS = 2200;     

const KIND_LABEL: Record<SlotReward["kind"], string> = {
  doll: "인형",
  coupon: "쿠폰",
  junk: "잡템",
};

const KIND_EMOJI: Record<SlotReward["kind"], string> = {
  doll: "🧸",
  coupon: "🎟️",
  junk: "🌿",
};

type SpinOutcome = { jackpot: boolean } | null;

// ═══════════════════════════════════════════════════════════════════
// 본체
// ═══════════════════════════════════════════════════════════════════
export default function SlotZone() {
  const { user, mobil } = useCurrentUser();

  // 표정
  const [faceIdx, setFaceIdx] = useState(0);
  const shuffleFace = () => {
    setFaceIdx((prev) => {
      if (FACES.length <= 1) return prev;
      let next = prev;
      while (next === prev) next = Math.floor(Math.random() * FACES.length);
      return next;
    });
  };

  // 설정(비용·락)
  const [spinCost, setSpinCost] = useState(400);
  const [lockSeconds, setLockSeconds] = useState(50);

  // 락 : now < lockUntil 이면 모달 없이 바로 스핀
  const lockUntilRef = useRef(0);

  // 처리 중(재클릭 방어) · 모달 · 안내 · 보상
  const inFlightRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingResolveRef = useRef<((v: SpinOutcome) => void) | null>(null);
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [reward, setReward] = useState<{ jackpot: boolean; items: SlotReward[] } | null>(null);
  const [popupReward, setPopupReward] = useState<{ jackpot: boolean; items: SlotReward[] } | null>(null);
  const rewardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (rewardTimer.current) clearTimeout(rewardTimer.current);
    };
  }, []);

  // keyframes
  useEffect(() => {
    if (document.getElementById("slotzone-face-css")) return;
    const el = document.createElement("style");
    el.id = "slotzone-face-css";
    el.textContent = `@keyframes slotzone-face-pulse{
      0%,100%{ transform: rotate(-6.25deg) scale(1); }
      50%    { transform: rotate(-6.25deg) scale(1.12); }
    }
    @keyframes slotzone-pop{
      0%{ transform: scale(0); opacity: 0; }
      60%{ transform: scale(1.15); opacity: 1; }
      100%{ transform: scale(1); opacity: 1; }
    }
    @keyframes slotzone-backdrop-in{
      from{ opacity: 0; }
      to{ opacity: 1; }
    }
    @keyframes slotzone-card-in{
      0%{ transform: translateY(12px) scale(0.9); opacity: 0; }
      70%{ transform: translateY(0) scale(1.03); opacity: 1; }
      100%{ transform: translateY(0) scale(1); opacity: 1; }
    }`;
    document.head.appendChild(el);
  }, []);

  // 설정 로드
  useEffect(() => {
    let cancelled = false;
    getSlotConfig().then((cfg) => {
      if (cancelled || !alive.current) return;
      setSpinCost(cfg.spinCost);
      setLockSeconds(cfg.lockSeconds);
    });
    return () => { cancelled = true; };
  }, []);

  const notEnough = !!user && mobil < spinCost;

  // 보상 (자동 소멸) + 획득 팝업(수동 닫기)
  const showReward = useCallback((jackpot: boolean, items: SlotReward[]) => {
    setReward({ jackpot, items });
    setPopupReward({ jackpot, items });
    if (rewardTimer.current) clearTimeout(rewardTimer.current);
    rewardTimer.current = setTimeout(() => {
      if (alive.current) setReward(null);
    }, REWARD_SHOW_MS);
  }, []);

  // 실제 서버 스핀 (락 통과 후에만)
  const doSpin = useCallback(async (): Promise<SpinOutcome> => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    shuffleFace();
    setHint(undefined);

    try {
      const res = await spinSlot();

      if (!res.ok) {
        const msg =
          res.reason === "insufficient_mobil" ? "모빌이 부족합니다"
          : res.reason === "slot_pool_empty"  ? "지금은 뽑을 수 없습니다"
          : res.reason === "auth_required"    ? "로그인이 필요합니다"
          : "잠시 후 다시 시도해 주세요";
        if (alive.current) setHint(msg);
        return null;
      }

      // 성공 : 잔액 동기화 유도 + 락 창 리셋
      window.dispatchEvent(new CustomEvent("profile-changed"));
      lockUntilRef.current = Date.now() + lockSeconds * 1000;

      // 릴이 멈추는 시점에 맞춰 보상 등장
      setTimeout(() => {
        if (alive.current) showReward(res.jackpot, res.rewards);
      }, REEL_STOP_MS);

      return { jackpot: res.jackpot };
    } catch (e) {
      console.warn("[slot] doSpin failed:", e);
      if (alive.current) setHint("잠시 후 다시 시도해 주세요");
      return null;
    } finally {
      inFlightRef.current = false;
    }
  }, [lockSeconds, showReward]);

  const handleSpinRequest = useCallback(async (): Promise<SpinOutcome> => {
    if (!user) { setHint("로그인이 필요합니다"); return null; }
    if (notEnough) { setHint("모빌이 부족합니다"); return null; }
    if (inFlightRef.current || confirmOpen) return null;

    const unlocked = Date.now() < lockUntilRef.current;
    if (unlocked) {
      return doSpin();
    }

    // 락 
    return new Promise<SpinOutcome>((resolve) => {
      pendingResolveRef.current = resolve;
      setConfirmOpen(true);
    });
  }, [user, notEnough, confirmOpen, doSpin]);

  // 모달 확인 
  const handleConfirm = useCallback(async () => {
    setConfirmOpen(false);
    const resolve = pendingResolveRef.current;
    pendingResolveRef.current = null;
    const result = await doSpin();
    resolve?.(result);
  }, [doSpin]);

  const handleCancel = useCallback(() => {
    setConfirmOpen(false);
    const resolve = pendingResolveRef.current;
    pendingResolveRef.current = null;
    resolve?.(null);   
  }, []);

  return (
    <div style={zoneStyle}>
      {/* 맨 뒤: 3겹 마테 */}
      <img src="/svg/slot-mat-stack.svg" alt="" style={matStackStyle} />

      <div key={faceIdx} style={faceStyle}>{FACES[faceIdx]}</div>

      {/* 보유 모빌 */}
      {user ? (
        <div style={mobilBadgeStyle}>
          <span style={mobilLabelStyle}>보유</span>
          <span style={mobilValueStyle}>{mobil.toLocaleString()}</span>
        </div>
      ) : null}

      {/* 보상 (슬롯 왼쪽 빈 자리) */}
      {reward ? (
        <div style={rewardBurstStyle}>
          {reward.items.map((it, i) => (
            <div
              key={i}
              style={{
                ...rewardItemStyle,
                marginLeft: i === 0 ? 0 : -18,           
                transform: `rotate(${i % 2 === 0 ? -7 : 6}deg) translateY(${i % 2 === 0 ? 0 : 6}px)`,
                zIndex: reward.items.length - i,        
              }}
            >
              {it.kind === "doll" && it.imageUrl ? (
                <img src={it.imageUrl} alt={it.name} style={rewardImgStyle} />
              ) : (
                <div style={rewardEmojiStyle}>{KIND_EMOJI[it.kind]}</div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {/* 슬롯머신 (동적) */}
      <div style={slotWrapStyle}>
        <SlotCabinetPop
          onSpin={handleSpinRequest}
          spinCost={spinCost}
          disabled={notEnough}
          hint={hint}
        />
      </div>

      {/* 확인 모달 (Portal) */}
      {confirmOpen ? (
        <ConfirmModal
          cost={spinCost}
          lockSeconds={lockSeconds}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      ) : null}

      {/* 획득 팝업 (Portal) */}
      {popupReward ? (
        <RewardPopup
          jackpot={popupReward.jackpot}
          items={popupReward.items}
          onClose={() => setPopupReward(null)}
        />
      ) : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 확인 모달
// ════════════════════════════════════════════════════════
function ConfirmModal({
  cost,
  lockSeconds,
  onConfirm,
  onCancel,
}: {
  cost: number;
  lockSeconds: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onCancel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={backdropStyle} onClick={onCancel}>
      <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={modalTitleStyle}>슬롯 머신을 돌립니다</div>
        <div style={modalCostStyle}>-{cost.toLocaleString()} 모빌</div>
        <div style={modalNoteStyle}>
          확인 후 {lockSeconds}초 동안은 팝업 없이 버튼만 누르면 바로 돌아갑니다.
        </div>
        <div style={modalBtnRowStyle}>
          <button type="button" onClick={onCancel} style={modalCancelBtn}>취소</button>
          <button type="button" onClick={onConfirm} style={modalConfirmBtn}>확인</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ════════════════════════════════════════════════════════
// 획득 팝업
// ════════════════════════════════════════════════════════
function RewardPopup({
  jackpot,
  items,
  onClose,
}: {
  jackpot: boolean;
  items: SlotReward[];
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalTitleStyle, color: jackpot ? "#e8402c" : "#1a335e" }}>
          {jackpot ? "잭팟! 인형 획득!" : "획득!"}
        </div>
        <div style={rewardPopupRow}>
          {items.map((it, i) => (
            <div key={i} style={rewardItemStyle}>
              {it.kind === "doll" && it.imageUrl ? (
                <img src={it.imageUrl} alt={it.name} style={rewardImgLargeStyle} />
              ) : (
                <div style={rewardEmojiLargeStyle}>{KIND_EMOJI[it.kind]}</div>
              )}
              <div style={rewardNameStyle}>{it.name}</div>
            </div>
          ))}
        </div>
        <div style={modalBtnRowStyle}>
          <button type="button" onClick={onClose} style={modalConfirmBtn}>확인</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ────────────────────────────────────────────────────────────────────
// 스타일 — 구역/마테/표정 (기존 값 유지. 좌표는 눈으로 맞춘 것 그대로)
// ────────────────────────────────────────────────────────────────────
const zoneStyle: CSSProperties = {
  position: "absolute",
  top: 250,
  right: 20,
  width: 330,
  height: 300,
  overflow: "hidden",
};

const matStackStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 15,
  width: 250,
  height: 434,
  zIndex: 1,
  pointerEvents: "none",
};

const slotWrapStyle: CSSProperties = {
  position: "absolute",
  top: 110,
  right: 3,
  transform: "rotate(8deg) scale(0.34)",
  transformOrigin: "top right",
  zIndex: 4,
  pointerEvents: "auto",
};

const faceStyle: CSSProperties = {
  position: "absolute",
  top: 123,
  right: 130,
  fontFamily: "'LOTTERIA CHAB', sans-serif",
  fontSize: 24,
  lineHeight: "34px",
  color: "#1A335E",
  textTransform: "uppercase",
  WebkitTextStroke: "10px #FFFFFF",
  paintOrder: "stroke",
  textShadow: "0px 2px 4px rgba(0,0,0,0.1)",
  transform: "rotate(-6.25deg)",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  zIndex: 5,
  animation: "slotzone-face-pulse 1.1s ease-in-out infinite",
};

// ── 보상 (슬롯 왼쪽 빈 자리) ──
const rewardBurstStyle: CSSProperties = {
  position: "absolute",
  top: 190,
  left: 79,
  display: "flex",
  alignItems: "flex-end",
  gap: 0,
  zIndex: 6,
  pointerEvents: "none",
  transformOrigin: "center",
  animation: "slotzone-pop 0.4s cubic-bezier(.2,1.4,.4,1) both",
};


const mobilBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 275,
  left: 60,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.9)",
  border: "2px solid #3f88f9",
  zIndex: 7,
  pointerEvents: "none",
};
const mobilLabelStyle: CSSProperties = {
  fontFamily: "'Gowun Dodum', sans-serif",
  fontSize: 9,
  color: "#7fa8c9",
};
const mobilValueStyle: CSSProperties = {
  fontFamily: "'Jua', sans-serif",
  fontSize: 11,
  color: "#1a335e",
};

const rewardItemStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  width: 66,
};

const rewardImgStyle: CSSProperties = {
  width: 56,
  height: 56,
  objectFit: "contain",
  filter: "drop-shadow(0 3px 4px rgba(20,58,99,.25))",
};

const rewardImgLargeStyle: CSSProperties = {
  width: 96,
  height: 96,
  objectFit: "contain",
  filter: "drop-shadow(0 4px 6px rgba(20,58,99,.25))",
};


const rewardEmojiStyle: CSSProperties = {
  fontSize: 40,
  lineHeight: 1,
  WebkitTextStroke: "3px #fff",
  paintOrder: "stroke",
  filter:  
   "drop-shadow(6px 0 0 #fff) drop-shadow(-3px 0 0 #fff) drop-shadow(0 3px 0 #fff) drop-shadow(0 -3px 0 #fff) drop-shadow(2px 2px 0 #fff) drop-shadow(-2px 2px 0 #fff) drop-shadow(2px -2px 0 #fff) drop-shadow(-2px -2px 0 #fff) drop-shadow(0 3px 4px rgba(20,58,99,.3))",
};

// 획득 팝업
const rewardEmojiLargeStyle: CSSProperties = {
  fontSize: 72,
  lineHeight: 1,
};

const rewardNameStyle: CSSProperties = {
  fontFamily: "'Gowun Dodum', sans-serif",
  fontSize: 11,
  color: "#1a335e",
  textAlign: "center",
  lineHeight: 1.2,
  textShadow: "0 1px 2px #fff, 0 0 3px #fff",
  whiteSpace: "nowrap",
};

// ── 모달 공통  ──
const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8, 60, 105, 0.35)",
  backdropFilter: "blur(3px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  animation: "slotzone-backdrop-in 0.2s ease-out both",
};

const modalCardStyle: CSSProperties = {
  position: "relative",
  width: 360,
  maxWidth: "calc(100% - 40px)",
  background: "#fff",
  border: "2.5px solid #2563eb",
  borderRadius: 22,
  boxShadow: "0 22px 50px rgba(8, 60, 105, 0.4)",
  padding: "26px 28px",
  textAlign: "center",
  animation: "slotzone-card-in 0.32s cubic-bezier(.2,1.3,.4,1) both",
};

const modalTitleStyle: CSSProperties = {
  fontFamily: "'Jua', sans-serif",
  fontSize: 20,
  color: "#1a335e",
  marginBottom: 8,
};

const modalCostStyle: CSSProperties = {
  fontFamily: "'Gowun Dodum', sans-serif",
  fontSize: 15,
  color: "#3f88f9",
  marginBottom: 10,
};

const modalNoteStyle: CSSProperties = {
  fontFamily: "'Gowun Dodum', sans-serif",
  fontSize: 12,
  color: "#7fa8c9",
  lineHeight: 1.5,
  marginBottom: 18,
};

const modalBtnRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "center",
};

const modalConfirmBtn: CSSProperties = {
  minWidth: 96,
  padding: "9px 18px",
  borderRadius: 12,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontFamily: "'Jua', sans-serif",
  fontSize: 15,
  cursor: "pointer",
};

const modalCancelBtn: CSSProperties = {
  minWidth: 96,
  padding: "9px 18px",
  borderRadius: 12,
  border: "2px solid #bfd6f0",
  background: "#fff",
  color: "#5b7ea6",
  fontFamily: "'Jua', sans-serif",
  fontSize: 15,
  cursor: "pointer",
};

const rewardPopupRow: CSSProperties = {
  display: "flex",
  gap: 14,
  justifyContent: "center",
  margin: "8px 0 20px",
};