// components/gm/users/ItemGrantPanel.tsx
//
// 유저 아이템 지급 패널.
//
// 방식:
//   · shop_items 카탈로그에서 지급할 아이템을 고르고 수량을 지정해 지급.
//   · 지급은 무상(재화 차감 없음)이며, 지급 1건당 item_grants 이력 자동 기록
//     → 사고 시 추적 가능성 확보.
//   · 지급 가능 타입(검증된 정본 경로만): 사인펜·스티커·사진기·이벤트(other)
//     + 슬롯 보상(인형·교환권·잡템).
//     배경지(wallpaper)·잉크 리필(refill_ink)은 지급 경로가 없어 목록에서 제외.
//
// 중복 보유 방어:
//   · 스티커·사진기는 1개 한정. 이미 보유 중이면 지급 버튼을 비활성한다(UI 차단).
//     서버(gm_grant_inventory_item)도 duplicate_* 로 이중 방어.
//   · 보유 여부 판단은 부모가 넘겨준 ownedKeys(=`${type}:${ref}`) 로 한다.
//
// 갱신:
//   · 지급 성공 시 onGranted 로 부모(UserDetail)에 알려 인벤토리 재조회.

"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import { grantGmInventoryItem } from "@/lib/gm-user-helpers";
import { listAllShopItems, type GmShopItem } from "@/lib/gm-shop-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** 슬롯 보상 종류 라벨 (metadata.slot_kind). */
const SLOT_KIND_LABEL: Record<string, string> = {
  doll:   "인형",
  coupon: "교환권",
  junk:   "잡템",
};

/** 인벤토리에 실제로 저장되는 타입별 라벨. */
const DEST_TYPE_LABEL: Record<string, string> = {
  marker:  "사인펜",
  sticker: "스티커",
  camera:  "사진기",
  other:   "이벤트",
  doll:    "인형",
  coupon:  "교환권",
  junk:    "잡템",
};

/** 1개 한정(중복 보유 불가) 타입. */
const SINGLETON_TYPES = ["sticker", "camera"] as const;

/** 지급 수량 상한 (서버와 동일). */
const QTY_MAX = 999;

type Props = {
  profileId: string;
  /** 대상 유저가 이미 보유한 아이템 키 집합 (`${item_type}:${item_ref}`). */
  ownedKeys: Set<string>;
  /** 지급 성공 시 부모 인벤토리 재조회용. */
  onGranted: () => void;
};

/** shop_items 한 행을 "지급 대상 타입/라벨" 로 해석. */
type GrantTarget = {
  item:      GmShopItem;
  destType:  string;   // 인벤토리에 저장될 타입
  kindLabel: string;   // 화면 표시용 종류 라벨
  supported: boolean;  // 지급 지원 여부
};

function resolveTarget(item: GmShopItem): GrantTarget {
  const meta = item.metadata ?? {};
  const isSlot = meta["slot_reward"] === true;
  const slotKind =
    typeof meta["slot_kind"] === "string" ? (meta["slot_kind"] as string) : "";

  if (isSlot) {
    const supported = slotKind === "doll" || slotKind === "coupon" || slotKind === "junk";
    return {
      item,
      destType:  slotKind,
      kindLabel: SLOT_KIND_LABEL[slotKind] ?? "슬롯 보상",
      supported,
    };
  }

  const t = item.itemType;
  const supported = t === "marker" || t === "sticker" || t === "camera" || t === "other";
  return {
    item,
    destType:  t,
    kindLabel: DEST_TYPE_LABEL[t] ?? t,
    supported,
  };
}

export default function ItemGrantPanel({ profileId, ownedKeys, onGranted }: Props) {
  const [items,    setItems]    = useState<GmShopItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<string>("");   // shop_item id
  const [qty,      setQty]      = useState("1");
  const [note,     setNote]     = useState("");
  const [pending,  setPending]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [okMsg,    setOkMsg]    = useState<string | null>(null);

  // 카탈로그 로드 (활성 아이템만, 지급 지원 타입만)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const all = await listAllShopItems();
      if (cancelled) return;
      const grantable = all.filter((it) => it.isActive && resolveTarget(it).supported);
      setItems(grantable);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const targets = useMemo(() => items.map(resolveTarget), [items]);

  const selectedTarget = useMemo(
    () => targets.find((t) => t.item.id === selected) ?? null,
    [targets, selected],
  );

  // 선택된 아이템이 1개 한정 타입이고 이미 보유 중인지
  const alreadyOwned = useMemo(() => {
    if (!selectedTarget) return false;
    const { destType, item } = selectedTarget;
    if (!(SINGLETON_TYPES as readonly string[]).includes(destType)) return false;
    return ownedKeys.has(`${destType}:${item.itemRef}`);
  }, [selectedTarget, ownedKeys]);

  const isSingleton =
    selectedTarget !== null &&
    (SINGLETON_TYPES as readonly string[]).includes(selectedTarget.destType);

  // 1개 한정 타입은 수량 고정 1
  useEffect(() => {
    if (isSingleton && qty !== "1") setQty("1");
  }, [isSingleton, qty]);

  const canSubmit =
    !pending &&
    !loading &&
    selectedTarget !== null &&
    !alreadyOwned &&
    (() => {
      const n = Number(qty);
      return Number.isInteger(n) && n >= 1 && n <= QTY_MAX;
    })();

  async function handleGrant() {
    if (!canSubmit || !selectedTarget) return;
    const n = Number(qty);
    setPending(true);
    setError(null);
    setOkMsg(null);

    const res = await grantGmInventoryItem(
      profileId,
      selectedTarget.item.id,
      isSingleton ? 1 : n,
      note,
    );

    if (res.ok) {
      setOkMsg(
        `${selectedTarget.item.name} ${isSingleton ? "" : `${n}개 `}지급 완료 (보유 ${res.data})`,
      );
      onGranted();
      // 사유 메모는 연속 지급 시 재사용 가능하므로 비우지 않음.
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  return (
    <div style={wrapStyle}>
      <div style={headerRowStyle}>
        <span style={sectionTitleStyle}>🎁 아이템 지급</span>
        <span style={hintStyle}>무상 지급 · 이력 기록됨</span>
      </div>

      {loading ? (
        <div style={loadingStyle}>카탈로그 불러오는 중...</div>
      ) : items.length === 0 ? (
        <div style={loadingStyle}>지급 가능한 아이템이 없습니다.</div>
      ) : (
        <>
          {/* 아이템 선택 */}
          <select
            value={selected}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setSelected(e.target.value);
              setError(null);
              setOkMsg(null);
            }}
            disabled={pending}
            style={selectStyle}
          >
            <option value="">— 지급할 아이템 선택 —</option>
            {targets.map((t) => (
              <option key={t.item.id} value={t.item.id}>
                [{t.kindLabel}] {t.item.name}
              </option>
            ))}
          </select>

          {/* 선택 아이템 요약 */}
          {selectedTarget ? (
            <div style={previewStyle}>
              <span style={previewChipStyle}>{selectedTarget.kindLabel}</span>
              <span style={previewNameStyle}>{selectedTarget.item.name}</span>
              {selectedTarget.item.code ? (
                <span style={previewCodeStyle}>{selectedTarget.item.code}</span>
              ) : null}
            </div>
          ) : null}

          {/* 이미 보유 경고 (1개 한정 타입) */}
          {alreadyOwned ? (
            <div style={warnStyle}>
              이미 보유 중입니다. {selectedTarget?.kindLabel}은(는) 1개만 보유할 수 있어 지급할 수 없습니다.
            </div>
          ) : null}

          {/* 수량 + 사유 */}
          <div style={rowStyle}>
            <input
              value={qty}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const v = e.target.value.replace(/[^\d]/g, "");
                setQty(v);
              }}
              disabled={pending || isSingleton}
              inputMode="numeric"
              placeholder="수량"
              style={{
                ...qtyInputStyle,
                background: isSingleton ? "#f2f4f6" : "#fff",
                color:      isSingleton ? "#9aa7b0" : "#2c4a60",
              }}
            />
            <input
              value={note}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
              placeholder="지급 사유 (선택)"
              maxLength={200}
              disabled={pending}
              style={noteInputStyle}
            />
          </div>

          {isSingleton ? (
            <div style={noteStyle}>
              {selectedTarget?.kindLabel}은(는) 1개 한정이라 수량은 1로 고정됩니다.
            </div>
          ) : null}

          {/* 지급 버튼 */}
          <button
            type="button"
            onClick={handleGrant}
            disabled={!canSubmit}
            style={{
              ...grantButtonStyle,
              opacity: canSubmit ? 1 : 0.4,
              cursor:  canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {pending ? "지급 중..." : "지급"}
          </button>

          {error ? <div style={errorStyle}>{error}</div> : null}
          {okMsg ? <div style={okStyle}>{okMsg}</div> : null}
        </>
      )}

      <div style={noteStyle}>
        모든 지급은 이력에 기록됩니다. 배경지·잉크 리필은 지급을 지원하지 않습니다.
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
  background:    "#f6fbf7",
  border:        "1.5px solid #cfe8d6",
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
  color:      "#2f7d4f",
};

const hintStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#6a9a7a",
};

const loadingStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#6a9a7a",
  padding:    "6px 0",
};

const selectStyle: CSSProperties = {
  height:       32,
  border:       "1.5px solid #c4e2cd",
  borderRadius: 8,
  padding:      "0 10px",
  fontFamily:   BODY,
  fontSize:     12.5,
  color:        "#2c4a60",
  background:   "#fff",
  outline:      "none",
};

const previewStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        6,
  flexWrap:   "wrap",
};

const previewChipStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     10.5,
  color:        "#2f7d4f",
  background:   "#e2f3e8",
  border:       "1px solid #c4e2cd",
  borderRadius: 999,
  padding:      "2px 8px",
};

const previewNameStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12.5,
  color:      "#2c4a60",
};

const previewCodeStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#9aa7b0",
};

const warnStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     11.5,
  color:        "#c2410c",
  background:   "#fdf1ea",
  border:       "1px solid #f3c9b4",
  borderRadius: 8,
  padding:      "6px 10px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap:     6,
};

const qtyInputStyle: CSSProperties = {
  width:        72,
  height:       30,
  border:       "1.5px solid #c4e2cd",
  borderRadius: 8,
  padding:      "0 10px",
  fontFamily:   BODY,
  fontSize:     12,
  outline:      "none",
  flexShrink:   0,
};

const noteInputStyle: CSSProperties = {
  flex:         1,
  minWidth:     0,
  height:       30,
  border:       "1.5px solid #c4e2cd",
  borderRadius: 8,
  padding:      "0 10px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#2c4a60",
  outline:      "none",
  background:   "#fff",
};

const grantButtonStyle: CSSProperties = {
  height:       34,
  border:       0,
  borderRadius: 8,
  background:   "#3a9c5f",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     13,
};

const errorStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#c2410c",
};

const okStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#2f7d4f",
};

const noteStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#7a9a86",
};
