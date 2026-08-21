// components/noticeboard/panels/gift/GiftModal.tsx
//
// 선물(양도) 모달. 매점(ShopPanel)에서 "선물하기" 버튼으로 연다.
//
// 동작:
//   1) 수신자 : 전체 유저 목록을 미리 불러와 스크롤로 찾아 선택(드롭다운 아님).
//   2) 종류   : 모빌 / 아이템 토글.
//      · 모빌  : 개수 입력. 내 잔액(myMobil) 초과 불가(클라 1차 검증).
//      · 아이템: 내 인벤토리에서 (type,ref)별 합산 목록. marker/sticker 제외.
//                item_ref 없는 행 제외(transfer_item 이 ref 필요).
//   3) 확인   : giftMobil / giftItem 호출. 성공 시 onDone 으로 상위에 알림.
//
// 안전:
//   · 서버 코어가 최종 검증(잔액·보유·자기이체·수신자상태·양도가능). 클라 검증은 UX 용.
//   · ModalPortal 필수: MEMBER 패널 transform:scale 안에서 fixed 가 갇히는 문제 회피.
//   · 전송 중 중복 클릭 차단(submitting).
//
// 디자인: 매점 v4 토큰(C 팔레트·폰트) 재사용해 톤 일치.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import ModalPortal from "../ModalPortal";
import {
  listGiftRecipients,
  giftMobil,
  giftItem,
  isGiftable,
  type GiftRecipient,
} from "@/lib/gift-helpers";
import {
  listMyInventoryItems,
  type InventoryItemRow,
  type InventoryItemType,
} from "@/lib/inventory-helpers";

/* 매점과 동일 폰트/토큰 */
const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";
const C = {
  primary:      "#3f88f9",
  textStrong:   "#1a335e",
  textMid:      "#14406f",
  textDim:      "#7fb3d4",
  bgCard:       "#ffffff",
  border:       "#cfe2fb",
  warning:      "#facc15",
  warningTint:  "#fef08a",
  warningText:  "#8a7410",
  success:      "#c9f2e6",
  successText:  "#1e7d6a",
  danger:       "#ff6f7f",
  disabledBg:   "#d3dde8",
  disabledText: "#7d8ba0",
};

/** metadata 안전 문자열 추출(InventorySection 과 동일 규칙). */
function readStr(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!metadata) return null;
  const v = metadata[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** 종류별 기본 라벨/이모지(이름·이미지 없을 때 폴백). */
const TYPE_LABEL: Record<string, string> = {
  wallpaper: "배경지",
  other:     "아이템",
  doll:      "인형",
  coupon:    "쿠폰",
  junk:      "잡동사니",
  camera:    "사진기",
};
const TYPE_EMOJI: Record<string, string> = {
  wallpaper: "🖼️",
  other:     "🎁",
  doll:      "🧸",
  coupon:    "🎟️",
  junk:      "🌿",
  camera:    "📷",
};

/** 선물 목록에 표시할, (type,ref) 로 합산된 아이템 1종. */
type GiftableItem = {
  key:      string;            // `${type}:${ref}`
  itemType: InventoryItemType;
  itemRef:  string;
  label:    string;
  emoji:    string;
  imageUrl: string | null;
  total:    number;            // 합산 보유 개수
};

/** 인벤토리 행 목록 → 선물 가능한 (type,ref) 합산 목록. */
function buildGiftableList(rows: InventoryItemRow[]): GiftableItem[] {
  const map = new Map<string, GiftableItem>();
  for (const row of rows) {
    // 양도 불가 타입 제외(marker/sticker). ref 없는 행 제외.
    if (!isGiftable(row.item_type)) continue;
    if (!row.item_ref) continue;
    if (row.quantity <= 0) continue;

    const key = `${row.item_type}:${row.item_ref}`;
    const existing = map.get(key);
    if (existing) {
      existing.total += row.quantity;
      // 라벨/이미지가 아직 폴백이면 이 행에서 보강
      if (!existing.imageUrl) {
        existing.imageUrl = readStr(row.metadata, "image_url");
      }
      continue;
    }
    const label =
      readStr(row.metadata, "name") ?? TYPE_LABEL[row.item_type] ?? "아이템";
    const emoji =
      readStr(row.metadata, "emoji") ?? TYPE_EMOJI[row.item_type] ?? "🎁";
    map.set(key, {
      key,
      itemType: row.item_type,
      itemRef:  row.item_ref,
      label,
      emoji,
      imageUrl: readStr(row.metadata, "image_url"),
      total:    row.quantity,
    });
  }
  return Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label, "ko")
  );
}

type Mode = "mobil" | "item";

export type GiftModalProps = {
  /** 현재 내 모빌 잔액(클라 1차 검증용). */
  myMobil: number;
  /** 닫기. */
  onClose: () => void;
  /** 선물 성공 후(상위에서 토스트·잔액갱신 등). message 는 안내문. */
  onDone: (message: string) => void;
};

export default function GiftModal({ myMobil, onClose, onDone }: GiftModalProps) {
  const [recipients, setRecipients] = useState<GiftRecipient[]>([]);
  const [items,      setItems]      = useState<GiftableItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState<string | null>(null);

  const [mode,     setMode]     = useState<Mode>("mobil");
  const [toId,     setToId]     = useState<string | null>(null);
  const [search,   setSearch]   = useState("");
  const [amount,   setAmount]   = useState<string>("");     // 모빌 입력(문자)
  const [itemKey,  setItemKey]  = useState<string | null>(null);
  const [itemQty,  setItemQty]  = useState<string>("1");

  const [submitting, setSubmitting] = useState(false);
  const [errMsg,     setErrMsg]     = useState<string | null>(null);

  /* 초기 로드: 수신자 + 내 인벤토리 병렬 */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [recs, inv] = await Promise.all([
          listGiftRecipients(),
          listMyInventoryItems(),
        ]);
        if (!alive) return;
        setRecipients(recs);
        setItems(buildGiftableList(inv));
      } catch (e) {
        if (!alive) return;
        console.error("[GiftModal] load failed:", e);
        setLoadError("목록을 불러오지 못했습니다. 잠시 후 다시 시도해주십시오.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filteredRecipients = useMemo(() => {
    const q = search.trim();
    if (!q) return recipients;
    return recipients.filter((r) => r.name.includes(q));
  }, [recipients, search]);

  const selectedItem = useMemo(
    () => items.find((it) => it.key === itemKey) ?? null,
    [items, itemKey]
  );

  const toName = useMemo(
    () => recipients.find((r) => r.id === toId)?.name ?? null,
    [recipients, toId]
  );

  /* 확인 버튼 활성 조건(클라 1차) */
  const canSubmit = useMemo(() => {
    if (submitting || loading) return false;
    if (!toId) return false;
    if (mode === "mobil") {
      const n = Number(amount);
      return Number.isInteger(n) && n >= 1 && n <= myMobil;
    }
    // item
    if (!selectedItem) return false;
    const q = Number(itemQty);
    return Number.isInteger(q) && q >= 1 && q <= selectedItem.total;
  }, [submitting, loading, toId, mode, amount, myMobil, selectedItem, itemQty]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !toId) return;
    setSubmitting(true);
    setErrMsg(null);

    let result;
    if (mode === "mobil") {
      result = await giftMobil(toId, Number(amount));
    } else {
      if (!selectedItem) {
        setSubmitting(false);
        return;
      }
      result = await giftItem(
        toId,
        selectedItem.itemType,
        selectedItem.itemRef,
        Number(itemQty)
      );
    }

    setSubmitting(false);

    if (!result.ok) {
      setErrMsg(result.message);
      return;
    }

    const who = toName ?? "상대";
    const what =
      mode === "mobil"
        ? `${Number(amount)} 🪙`
        : `${selectedItem!.label} ${Number(itemQty)}개`;
    onDone(`${who}에게 ${what}을(를) 선물했습니다.`);
  }, [
    canSubmit, toId, mode, amount, itemQty, selectedItem, toName, onDone,
  ]);

  /* ── 스타일 조각 ── */
  const overlay: CSSProperties = {
    position: "fixed", inset: 0, zIndex: 9999,
    background: "rgba(20,40,80,0.42)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 16, fontFamily: BODY,
  };
  const card: CSSProperties = {
    width: "min(560px, 94vw)", maxHeight: "92vh",
    background: C.bgCard, borderRadius: 18,
    border: `1px solid ${C.border}`,
    boxShadow: "0 12px 40px rgba(20,40,80,0.28)",
    display: "flex", flexDirection: "column", overflow: "hidden",
  };
  const header: CSSProperties = {
    padding: "16px 20px", borderBottom: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  };
  const titleStyle: CSSProperties = {
    fontFamily: JUA, fontSize: 20, color: C.textStrong, margin: 0,
  };
  const body: CSSProperties = { padding: 20, overflowY: "auto", flex: 1 };
  const sectionLabel: CSSProperties = {
    fontFamily: JUA, fontSize: 14, color: C.textMid,
    margin: "0 0 8px", display: "block",
  };

  const closeBtn: CSSProperties = {
    border: "none", background: "transparent", cursor: "pointer",
    fontSize: 22, color: C.textDim, lineHeight: 1, padding: 4,
  };

  return (
    <ModalPortal>
      <div style={overlay} onClick={onClose} role="presentation">
        <div
          style={card}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="선물하기"
        >
          <div style={header}>
            <h2 style={titleStyle}>선물하기 🎁</h2>
            <button style={closeBtn} onClick={onClose} aria-label="닫기">
              ✕
            </button>
          </div>

          <div style={body}>
            {loading ? (
              <p style={{ color: C.textDim, textAlign: "center", padding: "32px 0" }}>
                불러오는 중…
              </p>
            ) : loadError ? (
              <p style={{ color: C.danger, textAlign: "center", padding: "32px 0" }}>
                {loadError}
              </p>
            ) : (
              <>
                {/* ── 종류 토글 ── */}
                <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                  {(["mobil", "item"] as Mode[]).map((m) => {
                    const active = mode === m;
                    return (
                      <button
                        key={m}
                        onClick={() => {
                          setMode(m);
                          setErrMsg(null);
                        }}
                        style={{
                          flex: 1, padding: "10px 0", borderRadius: 12,
                          border: `1px solid ${active ? C.primary : C.border}`,
                          background: active ? C.primary : C.bgCard,
                          color: active ? "#fff" : C.textMid,
                          fontFamily: JUA, fontSize: 15, cursor: "pointer",
                        }}
                      >
                        {m === "mobil" ? "모빌 🪙" : "아이템 📦"}
                      </button>
                    );
                  })}
                </div>

                {/* ── 수신자 검색 + 스크롤 목록 ── */}
                <label style={sectionLabel}>받는 사람</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="이름으로 찾기"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "9px 12px", marginBottom: 8,
                    border: `1px solid ${C.border}`, borderRadius: 10,
                    fontFamily: BODY, fontSize: 14, color: C.textStrong,
                  }}
                />
                <div
                  style={{
                    border: `1px solid ${C.border}`, borderRadius: 12,
                    maxHeight: 168, overflowY: "auto", marginBottom: 18,
                  }}
                >
                  {filteredRecipients.length === 0 ? (
                    <p style={{ color: C.textDim, textAlign: "center", padding: "20px 0", margin: 0 }}>
                      대상이 없습니다.
                    </p>
                  ) : (
                    filteredRecipients.map((r) => {
                      const active = r.id === toId;
                      return (
                        <button
                          key={r.id}
                          onClick={() => {
                            setToId(r.id);
                            setErrMsg(null);
                          }}
                          style={{
                            width: "100%", textAlign: "left",
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "9px 12px", border: "none",
                            borderBottom: `1px solid ${C.border}`,
                            background: active ? "#eaf2ff" : "transparent",
                            cursor: "pointer", fontFamily: BODY,
                          }}
                        >
                          <span
                            style={{
                              width: 30, height: 30, borderRadius: "50%",
                              flexShrink: 0, overflow: "hidden",
                              background: "#eef4fc",
                              display: "flex", alignItems: "center",
                              justifyContent: "center", fontSize: 15,
                            }}
                          >
                            {r.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={r.avatarUrl}
                                alt=""
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              "🙂"
                            )}
                          </span>
                          <span style={{ fontSize: 14, color: C.textStrong }}>
                            {r.name}
                          </span>
                          {r.isGm && (
                            <span
                              style={{
                                marginLeft: "auto", fontSize: 11,
                                color: C.warningText, background: C.warningTint,
                                borderRadius: 8, padding: "2px 7px", fontFamily: JUA,
                              }}
                            >
                              운영진
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* ── 모빌 입력 ── */}
                {mode === "mobil" ? (
                  <>
                    <label style={sectionLabel}>
                      보낼 모빌 (내 잔액 {myMobil} 🪙)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={myMobil}
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setErrMsg(null);
                      }}
                      placeholder="0"
                      style={{
                        width: "100%", boxSizing: "border-box",
                        padding: "10px 12px",
                        border: `1px solid ${C.border}`, borderRadius: 10,
                        fontFamily: BODY, fontSize: 16, color: C.textStrong,
                      }}
                    />
                  </>
                ) : (
                  /* ── 아이템 선택 + 개수 ── */
                  <>
                    <label style={sectionLabel}>보낼 아이템</label>
                    {items.length === 0 ? (
                      <p style={{ color: C.textDim, padding: "8px 0", margin: 0 }}>
                        선물할 수 있는 아이템이 없습니다.
                        <br />
                        <span style={{ fontSize: 12 }}>
                          (사인펜·스티커는 선물할 수 없습니다.)
                        </span>
                      </p>
                    ) : (
                      <>
                        <div
                          style={{
                            border: `1px solid ${C.border}`, borderRadius: 12,
                            maxHeight: 160, overflowY: "auto", marginBottom: 12,
                          }}
                        >
                          {items.map((it) => {
                            const active = it.key === itemKey;
                            return (
                              <button
                                key={it.key}
                                onClick={() => {
                                  setItemKey(it.key);
                                  setItemQty("1");
                                  setErrMsg(null);
                                }}
                                style={{
                                  width: "100%", textAlign: "left",
                                  display: "flex", alignItems: "center", gap: 10,
                                  padding: "9px 12px", border: "none",
                                  borderBottom: `1px solid ${C.border}`,
                                  background: active ? "#eaf2ff" : "transparent",
                                  cursor: "pointer", fontFamily: BODY,
                                }}
                              >
                                <span
                                  style={{
                                    width: 28, height: 28, flexShrink: 0,
                                    display: "flex", alignItems: "center",
                                    justifyContent: "center", fontSize: 18,
                                  }}
                                >
                                  {it.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={it.imageUrl}
                                      alt=""
                                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                                    />
                                  ) : (
                                    it.emoji
                                  )}
                                </span>
                                <span style={{ fontSize: 14, color: C.textStrong }}>
                                  {it.label}
                                </span>
                                <span
                                  style={{
                                    marginLeft: "auto", fontSize: 13, color: C.textDim,
                                  }}
                                >
                                  ×{it.total}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {selectedItem && (
                          <>
                            <label style={sectionLabel}>
                              개수 (보유 {selectedItem.total}개)
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={selectedItem.total}
                              value={itemQty}
                              onChange={(e) => {
                                setItemQty(e.target.value);
                                setErrMsg(null);
                              }}
                              style={{
                                width: "100%", boxSizing: "border-box",
                                padding: "10px 12px",
                                border: `1px solid ${C.border}`, borderRadius: 10,
                                fontFamily: BODY, fontSize: 16, color: C.textStrong,
                              }}
                            />
                          </>
                        )}
                      </>
                    )}
                  </>
                )}

                {errMsg && (
                  <p
                    style={{
                      color: C.danger, fontSize: 13, margin: "14px 0 0",
                      fontFamily: BODY,
                    }}
                  >
                    {errMsg}
                  </p>
                )}
              </>
            )}
          </div>

          {/* ── 하단 확인 ── */}
          {!loading && !loadError && (
            <div
              style={{
                padding: "14px 20px", borderTop: `1px solid ${C.border}`,
                display: "flex", gap: 10,
              }}
            >
              <button
                onClick={onClose}
                disabled={submitting}
                style={{
                  flex: 1, padding: "11px 0", borderRadius: 12,
                  border: `1px solid ${C.border}`, background: C.bgCard,
                  color: C.textMid, fontFamily: JUA, fontSize: 15,
                  cursor: submitting ? "default" : "pointer",
                }}
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{
                  flex: 2, padding: "11px 0", borderRadius: 12, border: "none",
                  background: canSubmit ? C.primary : C.disabledBg,
                  color: canSubmit ? "#fff" : C.disabledText,
                  fontFamily: JUA, fontSize: 15,
                  cursor: canSubmit ? "pointer" : "default",
                }}
              >
                {submitting ? "보내는 중…" : "선물 보내기"}
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
