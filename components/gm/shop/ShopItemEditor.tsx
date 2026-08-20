// components/gm/shop/ShopItemEditor.tsx
//
// 우측 편집 pane. 선택된 아이템의 편집 · 활성 토글 · 삭제 UI.
//
// 편집 대상 (세션 I ③ 결정):
//   · name         (1 ~ 100 자)
//   · description  (0 ~ 500 자)
//   · price        (0 ~ 10,000,000)
//   · image_url    (0 ~ 500 자, 빈 문자열은 null 로 저장)
//
// 편집 잠금 (표시만):
//   · code · item_type · item_ref · metadata
//
// UX:
//   · 폼 최상단: 아이템명 + 타입 배지 + 활성 상태 배지
//   · 편집 필드: name · description · price · image_url
//   · 저장 버튼은 dirty 상태에서만 활성화
//   · 저장 성공 시 상단 안내 문구 (자동 소거)
//   · 하단 Danger Zone: 활성 토글 · 삭제 (모두 window.confirm 필수)

"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import {
  deleteShopItem,
  setShopItemActive,
  updateShopItem,
  SHOP_DESC_MAX_LEN,
  SHOP_IMAGE_URL_MAX,
  SHOP_ITEM_TYPE_LABEL,
  SLOT_KIND_LABEL,
  type SlotKind,
  SLOT_WEIGHT_MIN,
  SLOT_WEIGHT_MAX,
  SHOP_NAME_MAX_LEN,
  SHOP_PRICE_MAX,
  SHOP_PRICE_MIN,
  type GmShopItem,
} from "@/lib/gm-shop-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

type Props = {
  item:      GmShopItem;
  /** 편집·활성 토글 성공 시 상위에 갱신 반영. */
  onPatch:   (next: GmShopItem) => void;
  /** 삭제 성공 시 상위에 알림 (선택 해제 + 목록 재조회). */
  onDeleted: () => void;
};

/** 편집 폼의 로컬 스냅샷 (문자열 상태로 통일해서 관리) */
type FormState = {
  name:        string;
  description: string;
  priceText:   string;
  imageUrl:    string;
  slotWeightText: string;
};

function itemToForm(it: GmShopItem): FormState {
  const w =
    it.metadata && typeof it.metadata === "object" && "weight" in it.metadata
      ? (it.metadata as { weight?: unknown }).weight
      : undefined;
  return {
    name:        it.name,
    description: it.description ?? "",
    priceText:   String(it.price),
    imageUrl:    it.imageUrl ?? "",
    slotWeightText: w !== undefined && w !== null ? String(w) : "",
  };
}

export default function ShopItemEditor({ item, onPatch, onDeleted }: Props) {
  const [form,     setForm]     = useState<FormState>(() => itemToForm(item));
  const [saving,   setSaving]   = useState(false);
  const [busy,     setBusy]     = useState(false); // 토글·삭제 진행 중
  const [notice,   setNotice]   = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 선택된 아이템이 바뀌면 폼 재초기화
  useEffect(() => {
    setForm(itemToForm(item));
    setNotice(null);
    setErrorMsg(null);
  }, [item.id, item.updatedAt]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 3000);
  }, []);

  /* ── 파생 상태 ── */

  const priceNum   = Number(form.priceText);
  const priceValid =
    form.priceText.trim() !== "" &&
    Number.isInteger(priceNum) &&
    priceNum >= SHOP_PRICE_MIN &&
    priceNum <= SHOP_PRICE_MAX;

  const nameValid = form.name.trim().length >= 1 && form.name.length <= SHOP_NAME_MAX_LEN;
  const descValid = form.description.length <= SHOP_DESC_MAX_LEN;
  const urlValid  = form.imageUrl.length <= SHOP_IMAGE_URL_MAX;

  // 슬롯 보상 아이템만 weight 편집 대상. 정수 & 범위 검사.
  const isSlotReward = item.metadata?.slot_reward === true;
  const slotWeightNum = Number(form.slotWeightText);
  const slotWeightValid =
    !isSlotReward ||
    (form.slotWeightText.trim() !== "" &&
      Number.isInteger(slotWeightNum) &&
      slotWeightNum >= SLOT_WEIGHT_MIN &&
      slotWeightNum <= SLOT_WEIGHT_MAX);

  const allValid = nameValid && descValid && urlValid && priceValid && slotWeightValid;

  // dirty 검사 (스냅샷과 비교)
  const original = itemToForm(item);
  const dirty =
    form.name        !== original.name ||
    form.description !== original.description ||
    form.priceText   !== original.priceText ||
    form.imageUrl    !== original.imageUrl ||
    form.slotWeightText !== original.slotWeightText;

  /* ── 저장 ── */

  const handleSave = useCallback(async () => {
    if (!dirty || !allValid || saving || busy) return;
    setSaving(true);
    setErrorMsg(null);

    const result = await updateShopItem(item.id, {
      name:        form.name.trim(),
      description: form.description.trim() === "" ? null : form.description.trim(),
      price:       priceNum,
      imageUrl:    form.imageUrl.trim() === "" ? null : form.imageUrl.trim(),
      // 슬롯 보상 아이템이면 기존 metadata 를 유지한 채 weight 만 갱신.
      ...(isSlotReward
        ? { metadata: { ...item.metadata, weight: slotWeightNum } }
        : {}),
    });

    setSaving(false);

    if (!result.ok) {
      setErrorMsg(result.message);
      return;
    }

    onPatch(result.item);
    showNotice("저장되었습니다.");
  }, [dirty, allValid, saving, busy, item.id, item.metadata, isSlotReward, slotWeightNum, form, priceNum, onPatch, showNotice]);

  /* ── 활성 토글 ── */

  const handleToggleActive = useCallback(async () => {
    if (busy || saving) return;

    const nextActive = !item.isActive;
    const confirmMsg = nextActive
      ? `"${item.name}" 을(를) 다시 판매하시겠습니까?`
      : `"${item.name}" 을(를) 매점에서 내리시겠습니까?\n\n이미 소지한 유저의 인벤토리는 유지됩니다.`;

    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setErrorMsg(null);

    const result = await setShopItemActive(item.id, nextActive);

    setBusy(false);

    if (!result.ok) {
      setErrorMsg(result.message);
      return;
    }

    onPatch(result.item);
    showNotice(nextActive ? "다시 판매 상태로 전환되었습니다." : "매점에서 내렸습니다.");
  }, [busy, saving, item.id, item.isActive, item.name, onPatch, showNotice]);

  /* ── 삭제 (2 단계 confirm) ── */

  const handleDelete = useCallback(async () => {
    if (busy || saving) return;

    const first = window.confirm(
      `"${item.name}" 을(를) 완전히 삭제하시겠습니까?\n\n` +
      `이 작업은 되돌릴 수 없습니다.\n` +
      `구매 이력은 유지되나 아이템 참조가 끊깁니다.\n\n` +
      `단순히 판매를 중단하려면 [삭제] 대신 [매점에서 내리기] 를 사용해 주십시오.`,
    );
    if (!first) return;

    const confirmText = item.code;
    const typed = window.prompt(
      `삭제를 확정하려면 아이템 코드를 정확히 입력해 주십시오.\n\n코드: ${confirmText}`,
    );
    if (typed !== confirmText) {
      if (typed !== null) {
        window.alert("코드가 일치하지 않아 삭제를 취소합니다.");
      }
      return;
    }

    setBusy(true);
    setErrorMsg(null);

    const result = await deleteShopItem(item.id);

    setBusy(false);

    if (!result.ok) {
      setErrorMsg(result.message);
      return;
    }

    onDeleted();
  }, [busy, saving, item.id, item.name, item.code, onDeleted]);

  /* ── 렌더 ── */

  const isDisabled = saving || busy;

  // 이 아이템에 설정된 커스텀 이모지 (metadata.emoji). 미리보기·안내용.
  const editorEmoji =
    item.metadata && typeof item.metadata === "object" && "emoji" in item.metadata &&
    typeof (item.metadata as { emoji?: unknown }).emoji === "string"
      ? ((item.metadata as { emoji?: string }).emoji ?? "").trim() || null
      : null;

  return (
    <div style={wrapStyle}>
      {/* 헤더 : 이름 · 타입 · 활성 상태 */}
      <div style={headerStyle}>
        <div style={headerTopStyle}>
          <h2 style={headerNameStyle}>{item.name || "(이름 없음)"}</h2>
          <div style={headerBadgeRowStyle}>
            <span style={typeBadgeStyle}>
              {SHOP_ITEM_TYPE_LABEL[item.itemType]}
            </span>
            {item.isActive ? (
              <span style={activeBadgeStyle}>판매중</span>
            ) : (
              <span style={inactiveBadgeStyle}>내림</span>
            )}
          </div>
        </div>
        <div style={headerCodeStyle}>
          코드: <span style={codeMonoStyle}>{item.code}</span>
        </div>
      </div>

      {/* 안내 / 에러 */}
      {notice ? <div style={noticeBarStyle}>{notice}</div> : null}
      {errorMsg ? <div style={errorBarStyle}>{errorMsg}</div> : null}

      {/* 편집 필드 그리드 */}
      <div style={formStyle}>
        {/* 이름 */}
        <div style={fieldStyle}>
          <label style={labelStyle}>이름</label>
          <input
            type="text"
            value={form.name}
            maxLength={SHOP_NAME_MAX_LEN}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, name: e.target.value }))
            }
            disabled={isDisabled}
            style={inputStyle}
          />
          <div style={fieldMetaStyle}>
            <span style={nameValid ? metaOkStyle : metaBadStyle}>
              {form.name.trim().length < 1 ? "필수 항목" : `${form.name.length} / ${SHOP_NAME_MAX_LEN}`}
            </span>
          </div>
        </div>

        {/* 가격 */}
        <div style={fieldStyle}>
          <label style={labelStyle}>가격 (mobil)</label>
          <input
            type="text"
            inputMode="numeric"
            value={form.priceText}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              // 숫자만 허용 (선행 공백 제거)
              const v = e.target.value.replace(/[^\d]/g, "");
              setForm((f) => ({ ...f, priceText: v }));
            }}
            disabled={isDisabled}
            style={inputStyle}
          />
          <div style={fieldMetaStyle}>
            {priceValid ? (
              <span style={metaOkStyle}>
                {priceNum.toLocaleString()} mobil
              </span>
            ) : (
              <span style={metaBadStyle}>
                0 이상 {SHOP_PRICE_MAX.toLocaleString()} 이하의 정수를 입력해 주십시오.
              </span>
            )}
          </div>
        </div>

        {/* 설명 (2컬럼 폭 사용) */}
        <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <label style={labelStyle}>설명</label>
          <textarea
            value={form.description}
            maxLength={SHOP_DESC_MAX_LEN}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            disabled={isDisabled}
            rows={3}
            style={textareaStyle}
          />
          <div style={fieldMetaStyle}>
            <span style={descValid ? metaOkStyle : metaBadStyle}>
              {form.description.length} / {SHOP_DESC_MAX_LEN}
            </span>
          </div>
        </div>

        {/* 이미지 URL (2컬럼 폭 사용) */}
        <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <label style={labelStyle}>이미지 URL</label>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            {/* 미리보기: 이미지 우선 → 이모지 → 없음 */}
            <div style={previewBoxStyle} aria-hidden>
              {form.imageUrl.trim() !== "" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl.trim()} alt="" style={previewImgStyle} />
              ) : editorEmoji ? (
                <span style={previewEmojiStyle}>{editorEmoji}</span>
              ) : (
                <span style={previewEmptyStyle}>—</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                type="text"
                value={form.imageUrl}
                maxLength={SHOP_IMAGE_URL_MAX}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, imageUrl: e.target.value }))
                }
                disabled={isDisabled}
                placeholder="비워두면 이미지 없음"
                style={inputStyle}
              />
              <div style={fieldMetaStyle}>
                <span style={urlValid ? metaOkStyle : metaBadStyle}>
                  {form.imageUrl.length} / {SHOP_IMAGE_URL_MAX}
                </span>
                {editorEmoji ? (
                  <span style={{ ...metaOkStyle, marginLeft: 8 }}>
                    이모지 설정됨: {editorEmoji} (이미지 없을 때 표시)
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 잠금 필드 (표시만) */}
      <div style={lockedBoxStyle}>
        <div style={lockedTitleStyle}>편집 잠금 필드</div>
        <div style={lockedRowStyle}>
          <span style={lockedKeyStyle}>타입</span>
          <span style={lockedValStyle}>
            {SHOP_ITEM_TYPE_LABEL[item.itemType]} · <code style={codeMonoInlineStyle}>{item.itemType}</code>
          </span>
        </div>
        <div style={lockedRowStyle}>
          <span style={lockedKeyStyle}>참조 (item_ref)</span>
          <span style={lockedValStyle}>
            <code style={codeMonoInlineStyle}>{item.itemRef}</code>
          </span>
        </div>
        {item.metadata?.slot_reward === true ? (
          <div style={lockedRowStyle}>
            <span style={lockedKeyStyle}>슬롯 보상</span>
            <span style={lockedValStyle}>
              {SLOT_KIND_LABEL[item.metadata.slot_kind as SlotKind] ?? "?"}
              {" · 종류는 고정"}
            </span>
          </div>
        ) : null}
        <div style={lockedNoteStyle}>
          타입 · 참조 · 종류(슬롯 kind) 변경은 아이템 추가 UI 개발 시 함께 다룹니다.
        </div>
      </div>

      {/* 슬롯 가중치 편집 (슬롯 보상 아이템만) */}
      {isSlotReward ? (
        <div style={fieldStyle}>
          <label style={labelStyle}>슬롯 가중치 (클수록 자주 나옴)</label>
          <input
            type="text"
            inputMode="numeric"
            value={form.slotWeightText}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, slotWeightText: e.target.value.replace(/[^\d]/g, "") }))
            }
            disabled={isDisabled}
            placeholder={`${SLOT_WEIGHT_MIN} ~ ${SLOT_WEIGHT_MAX.toLocaleString()}`}
            style={inputStyle}
          />
          <div style={fieldMetaStyle}>
            <span style={slotWeightValid ? metaOkStyle : metaBadStyle}>
              {slotWeightValid
                ? `가중치 ${slotWeightNum} · 같은 종류 안에서의 상대 비율`
                : `${SLOT_WEIGHT_MIN} ~ ${SLOT_WEIGHT_MAX.toLocaleString()} 정수`}
            </span>
          </div>
        </div>
      ) : null}

      {/* 저장 버튼 (dirty + valid 일 때만 활성화) */}
      <div style={saveRowStyle}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || !allValid || isDisabled}
          style={{
            ...saveButtonStyle,
            opacity: (!dirty || !allValid || isDisabled) ? 0.4 : 1,
            cursor:  (!dirty || !allValid || isDisabled) ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "저장 중…" : "변경 사항 저장"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => setForm(itemToForm(item))}
            disabled={isDisabled}
            style={cancelButtonStyle}
          >
            되돌리기
          </button>
        ) : null}
      </div>

      {/* Danger Zone */}
      <div style={dangerZoneStyle}>
        <div style={dangerTitleStyle}>운영 조작</div>

        <div style={dangerRowStyle}>
          <div>
            <div style={dangerLabelStyle}>
              {item.isActive ? "매점에서 내리기" : "다시 판매"}
            </div>
            <div style={dangerHintStyle}>
              {item.isActive
                ? "유저의 인벤토리는 유지됩니다. 언제든 다시 판매할 수 있습니다."
                : "다시 매점 목록에 노출됩니다."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleToggleActive()}
            disabled={isDisabled}
            style={{
              ...toggleButtonStyle,
              background:  item.isActive ? "#fff" : "#4db6a0",
              color:       item.isActive ? "#8a6410" : "#fff",
              borderColor: item.isActive ? "#e0b850" : "#2e7d6b",
            }}
          >
            {busy ? "…" : (item.isActive ? "내리기" : "다시 판매")}
          </button>
        </div>

        <div style={dangerRowStyle}>
          <div>
            <div style={dangerLabelStyle}>완전 삭제</div>
            <div style={dangerHintStyle}>
              되돌릴 수 없습니다. 단순 중단은 [내리기] 를 사용해 주십시오.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={isDisabled}
            style={deleteButtonStyle}
          >
            {busy ? "…" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════ 스타일 ═════════════════════════ */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           14,
  padding:       "4px 4px 20px",
};

/* ── 헤더 ── */

const headerStyle: CSSProperties = {
  background:   "#fff",
  border:       "1.5px solid #dce8f0",
  borderRadius: 12,
  padding:      "12px 16px",
  display:      "flex",
  flexDirection: "column",
  gap:          6,
};

const headerTopStyle: CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        10,
  minWidth:   0,
};

const headerNameStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   18,
  color:      "#0d6fa8",
  margin:     0,
  overflow:     "hidden",
  textOverflow: "ellipsis",
  whiteSpace:   "nowrap",
  minWidth:     0,
  flex:         1,
};

const headerBadgeRowStyle: CSSProperties = {
  display: "flex",
  gap:     4,
  flexShrink: 0,
};

const typeBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     11,
  padding:      "2px 10px",
  borderRadius: 999,
  background:   "#f0f6fa",
  color:        "#4a6d84",
};

const activeBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     11,
  padding:      "2px 10px",
  borderRadius: 999,
  background:   "#e8f5ee",
  color:        "#2e7d6b",
};

const inactiveBadgeStyle: CSSProperties = {
  fontFamily:   JUA,
  fontSize:     11,
  padding:      "2px 10px",
  borderRadius: 999,
  background:   "#eceff1",
  color:        "#68757e",
};

const headerCodeStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#7a94a8",
};

const codeMonoStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Menlo', monospace",
  fontSize:   11,
  color:      "#4a6d84",
  padding:    "1px 6px",
  background: "#f0f6fa",
  borderRadius: 4,
};

const codeMonoInlineStyle: CSSProperties = {
  ...codeMonoStyle,
  fontSize: 10.5,
};

/* ── 안내 / 에러 배너 ── */

const noticeBarStyle: CSSProperties = {
  background:   "#e8f5ee",
  border:       "1.5px solid #b8e0c6",
  borderRadius: 10,
  padding:      "8px 14px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#2e7d6b",
};

const errorBarStyle: CSSProperties = {
  background:   "#fdecea",
  border:       "1.5px solid #f2b8b0",
  borderRadius: 10,
  padding:      "8px 14px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#a3413a",
};

/* ── 폼 ── */

const formStyle: CSSProperties = {
  display:              "grid",
  gridTemplateColumns:  "1fr 1fr",
  gap:                  12,
  background:           "#fff",
  border:               "1.5px solid #dce8f0",
  borderRadius:         12,
  padding:              "14px 16px",
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

const textareaStyle: CSSProperties = {
  border:       "1.5px solid #cfe4f2",
  borderRadius: 8,
  padding:      "8px 12px",
  fontFamily:   BODY,
  fontSize:     13,
  color:        "#2c4a60",
  outline:      "none",
  background:   "#fff",
  resize:       "vertical",
  minWidth:     0,
};

const previewBoxStyle: CSSProperties = {
  width:          46,
  height:         46,
  flexShrink:     0,
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  borderRadius:   8,
  background:     "#f0f6fa",
  border:         "1.5px solid #cfe4f2",
  overflow:       "hidden",
};
const previewImgStyle: CSSProperties = {
  width:     "100%",
  height:    "100%",
  objectFit: "contain",
};
const previewEmojiStyle: CSSProperties = {
  fontSize:   26,
  lineHeight: 1,
};
const previewEmptyStyle: CSSProperties = {
  fontSize: 16,
  color:    "#b3c4d0",
};

const fieldMetaStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
  fontFamily: BODY,
  fontSize:   10.5,
  minHeight:  14,
};

const metaOkStyle: CSSProperties = {
  color: "#5a7488",
};

const metaBadStyle: CSSProperties = {
  color: "#c25a4d",
};

/* ── 잠금 필드 박스 ── */

const lockedBoxStyle: CSSProperties = {
  background:   "#f6f9fc",
  border:       "1.5px dashed #cfd8e0",
  borderRadius: 10,
  padding:      "10px 14px",
  display:      "flex",
  flexDirection: "column",
  gap:          4,
};

const lockedTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   11,
  color:      "#7a94a8",
  marginBottom: 2,
};

const lockedRowStyle: CSSProperties = {
  display:    "flex",
  gap:        8,
  alignItems: "center",
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#5a7488",
};

const lockedKeyStyle: CSSProperties = {
  minWidth: 100,
  color:    "#7a94a8",
};

const lockedValStyle: CSSProperties = {
  flex:     1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const lockedNoteStyle: CSSProperties = {
  marginTop:  4,
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#8ca5b8",
  fontStyle:  "italic",
};

/* ── 저장 버튼 ── */

const saveRowStyle: CSSProperties = {
  display:    "flex",
  gap:        8,
  alignItems: "center",
  flexShrink: 0,
};

const saveButtonStyle: CSSProperties = {
  height:       38,
  padding:      "0 22px",
  border:       "2px solid #0d6fa8",
  borderRadius: 999,
  background:   "#1a9edb",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     14,
  boxShadow:    "0 3px 0 #0d6fa8",
};

const cancelButtonStyle: CSSProperties = {
  height:       38,
  padding:      "0 18px",
  border:       "1.5px solid #cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
};

/* ── Danger Zone ── */

const dangerZoneStyle: CSSProperties = {
  background:   "#fff",
  border:       "1.5px solid #f2b8b0",
  borderRadius: 12,
  padding:      "12px 16px",
  display:      "flex",
  flexDirection: "column",
  gap:          10,
};

const dangerTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   12,
  color:      "#a3413a",
};

const dangerRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            12,
};

const dangerLabelStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#2c4a60",
  marginBottom: 2,
};

const dangerHintStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#7a94a8",
  maxWidth:   420,
};

const toggleButtonStyle: CSSProperties = {
  height:       32,
  padding:      "0 16px",
  border:       "1.5px solid",
  borderRadius: 999,
  fontFamily:   JUA,
  fontSize:     12,
  cursor:       "pointer",
  flexShrink:   0,
};

const deleteButtonStyle: CSSProperties = {
  height:       32,
  padding:      "0 16px",
  border:       "1.5px solid #a3413a",
  borderRadius: 999,
  background:   "#e2695f",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     12,
  cursor:       "pointer",
  boxShadow:    "0 2px 0 #a3413a",
  flexShrink:   0,
};