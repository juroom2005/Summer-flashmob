// components/gm/shop/ShopItemCreatePanel.tsx
//
// 신규 아이템 등록 폼 (우측 pane 의 "추가 모드").
//
// 지원 타입 : marker · sticker · other (세션 I 결정).
//   · marker  : 사인펜. item_ref = 색상 코드. metadata.emoji · initial_durability 지원
//   · sticker : 스티커. item_ref = 이모지 자체
//   · other   : 이벤트성. item_ref = 임의 식별자. 구매 시 quantity 누적
//
// 미지원 타입 (wallpaper · refill_ink) 은 UI 에 표시조차 되지 않는다.
//
// UX 방침:
//   · 타입 전환 시 감춰진 필드의 데이터는 유지 (실수 방지).
//   · dirty 상태에서 취소 · 다른 아이템 선택 시 상위에서 확인 팝업 처리.
//   · 등록 성공 시 상위 (GmShopTab) 가 방금 만든 아이템으로 편집 모드 전환.

"use client";

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import {
  createShopItem,
  MARKER_DURABILITY_DEFAULT,
  MARKER_DURABILITY_MAX,
  MARKER_DURABILITY_MIN,
  SLOT_KINDS,
  SLOT_KIND_LABEL,
  SLOT_WEIGHT_DEFAULT,
  SLOT_WEIGHT_MAX,
  SLOT_WEIGHT_MIN,
  type SlotKind,
  SHOP_CODE_MAX_LEN,
  SHOP_CODE_MIN_LEN,
  SHOP_CODE_REGEX,
  SHOP_CREATABLE_TYPES,
  SHOP_DESC_MAX_LEN,
  SHOP_IMAGE_URL_MAX,
  SHOP_ITEM_REF_MAX_LEN,
  SHOP_ITEM_TYPE_LABEL,
  SHOP_NAME_MAX_LEN,
  SHOP_PRICE_MAX,
  SHOP_PRICE_MIN,
  type GmShopItem,
  type ShopCreatableType,
} from "@/lib/gm-shop-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

type Props = {
  /** 등록 성공 시 상위 호출. 방금 만든 아이템 반환. */
  onCreated: (item: GmShopItem) => void;
  /** 취소 (편집 모드로 복귀 또는 empty 상태로). */
  onCancel: () => void;
  /** 부모가 dirty 상태를 이용할 수 있도록. 현재는 미사용. */
  onDirtyChange?: (dirty: boolean) => void;
};

type FormState = {
  itemType:         ShopCreatableType;
  code:             string;
  name:             string;
  description:      string;
  itemRef:          string;
  imageUrl:         string;
  priceText:        string;
  isActive:         boolean;
  // marker 전용
  markerEmoji:      string;
  markerDurability: string;
  // slot 보상 전용 (other 타입에서만)
  slotReward:       boolean;
  slotKind:         SlotKind;
  slotWeight:       string;
  slotEmoji:        string;
};

const INITIAL_FORM: FormState = {
  itemType:         "marker",
  code:             "",
  name:             "",
  description:      "",
  itemRef:          "",
  imageUrl:         "",
  priceText:        "",
  isActive:         true,
  markerEmoji:      "",
  markerDurability: "",
  slotReward:       false,
  slotKind:         "junk",
  slotWeight:       "",
  slotEmoji:        "",
};

/** 타입 세그먼트 순서 */
const TYPE_SEGMENTS: ShopCreatableType[] = ["marker", "sticker", "camera", "other"];

/** item_ref 라벨 · 힌트 (타입별) */
const ITEM_REF_META: Record<ShopCreatableType, { label: string; hint: string; placeholder: string }> = {
  marker: {
    label:       "색상 코드",
    hint:        "영문 소문자 위주로 입력 (예: black, red, purple). 인벤토리 렌더에 사용됩니다.",
    placeholder: "예: purple",
  },
  sticker: {
    label:       "이모지",
    hint:        "이모지 자체를 입력합니다. 스티커 화면에 그대로 표시됩니다.",
    placeholder: "예: ⭐",
  },
  camera: {
    label:       "식별자",
    hint:        "사진기 종류 식별자. 영문 소문자·숫자·언더스코어 권장 (예: camera_basic). 보유 시 연습일지 폴라로이드가 열립니다.",
    placeholder: "예: camera_basic",
  },
  other: {
    label:       "이벤트 식별자",
    hint:        "인벤토리 누적 판정에 사용됩니다. 영문 소문자 · 숫자 · 언더스코어 권장.",
    placeholder: "예: soda_ice_cream",
  },
};

export default function ShopItemCreatePanel({ onCreated, onCancel }: Props) {
  const [form,     setForm]     = useState<FormState>(INITIAL_FORM);
  const [saving,   setSaving]   = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  /* ── 파생 상태 ── */

  const priceNum   = Number(form.priceText);
  const priceValid =
    form.priceText.trim() !== "" &&
    Number.isInteger(priceNum) &&
    priceNum >= SHOP_PRICE_MIN &&
    priceNum <= SHOP_PRICE_MAX;

  const codeTrimmed = form.code.trim();
  const codeValid =
    codeTrimmed.length >= SHOP_CODE_MIN_LEN &&
    codeTrimmed.length <= SHOP_CODE_MAX_LEN &&
    SHOP_CODE_REGEX.test(codeTrimmed);

  const nameValid = form.name.trim().length >= 1 && form.name.length <= SHOP_NAME_MAX_LEN;
  const descValid = form.description.length <= SHOP_DESC_MAX_LEN;
  const urlValid  = form.imageUrl.length <= SHOP_IMAGE_URL_MAX;

  const itemRefTrimmed = form.itemRef.trim();
  const itemRefValid = itemRefTrimmed.length >= 1 && itemRefTrimmed.length <= SHOP_ITEM_REF_MAX_LEN;

  // marker 전용 검증
  const durabilityValid = useMemo(() => {
    if (form.itemType !== "marker") return true;
    const raw = form.markerDurability.trim();
    if (raw === "") return true; // 비워두면 기본값 100
    const n = Number(raw);
    return Number.isInteger(n) && n >= MARKER_DURABILITY_MIN && n <= MARKER_DURABILITY_MAX;
  }, [form.itemType, form.markerDurability]);

  // slot 보상 검증 (other + slotReward 체크 시에만 활성)
  const slotActive = form.itemType === "other" && form.slotReward;

  const slotWeightValid = useMemo(() => {
    if (!slotActive) return true;
    const raw = form.slotWeight.trim();
    if (raw === "") return true; // 비워두면 기본값
    const n = Number(raw);
    return Number.isInteger(n) && n >= SLOT_WEIGHT_MIN && n <= SLOT_WEIGHT_MAX;
  }, [slotActive, form.slotWeight]);

  // 인형은 이미지 필수
  const slotImageValid = !slotActive || form.slotKind !== "doll" || form.imageUrl.trim() !== "";

  const allValid =
    codeValid && nameValid && descValid && urlValid &&
    itemRefValid && priceValid && durabilityValid &&
    slotWeightValid && slotImageValid;

  const dirty =
    form.code !== "" || form.name !== "" || form.description !== "" ||
    form.itemRef !== "" || form.imageUrl !== "" || form.priceText !== "" ||
    form.markerEmoji !== "" || form.markerDurability !== "" ||
    form.slotReward !== INITIAL_FORM.slotReward || form.slotWeight !== "" ||
    form.slotEmoji !== "" ||
    form.isActive !== INITIAL_FORM.isActive;

  const itemRefMeta = ITEM_REF_META[form.itemType];

  /* ── 취소 ── */

  const handleCancel = useCallback(() => {
    if (dirty) {
      if (!window.confirm("작성 중인 내용이 사라집니다. 취소하시겠습니까?")) return;
    }
    onCancel();
  }, [dirty, onCancel]);

  /* ── 등록 ── */

  const handleSubmit = useCallback(async () => {
    if (!allValid || saving) return;

    setSaving(true);
    setErrorMsg(null);
    setCodeError(null);

    // metadata 조립 (타입별)
    const metadata: Record<string, unknown> = {};

    if (form.itemType === "marker") {
      if (form.markerEmoji.trim() !== "") {
        metadata.emoji = form.markerEmoji.trim();
      }
      const raw = form.markerDurability.trim();
      if (raw !== "") {
        metadata.initial_durability = Number(raw);
      } else {
        metadata.initial_durability = MARKER_DURABILITY_DEFAULT;
      }
    }
    // sticker · camera · other 는 빈 metadata (필요 시 나중에 확장)
    // camera : 보유 여부만으로 폴라로이드 게이팅. 별도 metadata 불필요.

    // 슬롯 보상 태깅 (other + 체크 시에만)
    if (form.itemType === "other" && form.slotReward) {
      metadata.slot_reward = true;
      metadata.slot_kind   = form.slotKind;
      const raw = form.slotWeight.trim();
      metadata.weight = raw === "" ? SLOT_WEIGHT_DEFAULT : Number(raw);
      // 이모지는 선택 — 값이 있을 때만 저장. 표시 우선순위는 이미지 > 이모지 > 종류 기본.
      const emoji = form.slotEmoji.trim();
      if (emoji !== "") metadata.emoji = emoji;
    }

    const result = await createShopItem({
      code:        form.code.trim(),
      name:        form.name.trim(),
      description: form.description.trim() === "" ? null : form.description.trim(),
      itemType:    form.itemType,
      itemRef:     form.itemRef.trim(),
      imageUrl:    form.imageUrl.trim() === "" ? null : form.imageUrl.trim(),
      price:       priceNum,
      isActive:    form.isActive,
      metadata,
    });

    setSaving(false);

    if (!result.ok) {
      if (result.reason === "duplicate_code") {
        setCodeError(result.message);
      } else {
        setErrorMsg(result.message);
      }
      return;
    }

    onCreated(result.item);
  }, [allValid, saving, form, priceNum, onCreated]);

  /* ── 렌더 ── */

  const isDisabled = saving;

  return (
    <div style={wrapStyle}>
      {/* 헤더 */}
      <div style={headerStyle}>
        <div style={headerTitleStyle}>새 아이템 등록</div>
        <div style={headerDescStyle}>
          매점에 판매할 아이템을 등록합니다. 등록 후에는 이름 · 가격 · 설명 · 이미지만 수정할 수 있으므로 타입 · 코드 · 참조 값을 신중히 지정해 주십시오.
        </div>
      </div>

      {/* 타입 세그먼트 */}
      <div style={segmentBarStyle}>
        {TYPE_SEGMENTS.map((t) => {
          const active = form.itemType === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setForm((f) => ({ ...f, itemType: t }))}
              disabled={isDisabled}
              style={{
                ...segmentButtonStyle,
                background:  active ? "#1a9edb" : "#fff",
                color:       active ? "#fff"    : "#0d6fa8",
                borderColor: active ? "#0d6fa8" : "#bfe4f7",
                boxShadow:   active ? "0 3px 0 #0d6fa8" : "none",
              }}
            >
              {SHOP_ITEM_TYPE_LABEL[t]}
            </button>
          );
        })}
      </div>

      {/* 전체 에러 배너 */}
      {errorMsg ? <div style={errorBarStyle}>{errorMsg}</div> : null}

      {/* 폼 그리드 */}
      <div style={formStyle}>
        {/* 코드 */}
        <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <label style={labelStyle}>
            코드 <span style={requiredStyle}>*</span>
          </label>
          <input
            type="text"
            value={form.code}
            maxLength={SHOP_CODE_MAX_LEN}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setForm((f) => ({ ...f, code: e.target.value }));
              if (codeError) setCodeError(null);
            }}
            disabled={isDisabled}
            placeholder={
              form.itemType === "marker"  ? "예: marker_purple" :
              form.itemType === "sticker" ? "예: sticker_star"  :
                                            "예: event_soda_ice"
            }
            style={{
              ...inputStyle,
              borderColor: codeError ? "#e2695f" : (codeValid || form.code === "") ? "#cfe4f2" : "#e0b850",
            }}
          />
          <div style={fieldMetaStyle}>
            {codeError ? (
              <span style={metaBadStyle}>{codeError}</span>
            ) : form.code === "" ? (
              <span style={metaOkStyle}>영문 소문자 · 숫자 · 언더스코어. {SHOP_CODE_MIN_LEN}~{SHOP_CODE_MAX_LEN}자.</span>
            ) : codeValid ? (
              <span style={metaOkStyle}>사용 가능</span>
            ) : (
              <span style={metaBadStyle}>영문 소문자 · 숫자 · 언더스코어만 사용 가능합니다.</span>
            )}
          </div>
        </div>

        {/* 이름 */}
        <div style={fieldStyle}>
          <label style={labelStyle}>
            이름 <span style={requiredStyle}>*</span>
          </label>
          <input
            type="text"
            value={form.name}
            maxLength={SHOP_NAME_MAX_LEN}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, name: e.target.value }))
            }
            disabled={isDisabled}
            placeholder="예: 보라 사인펜"
            style={inputStyle}
          />
          <div style={fieldMetaStyle}>
            <span style={nameValid || form.name === "" ? metaOkStyle : metaBadStyle}>
              {form.name === "" ? "필수 항목" : `${form.name.length} / ${SHOP_NAME_MAX_LEN}`}
            </span>
          </div>
        </div>

        {/* 가격 */}
        <div style={fieldStyle}>
          <label style={labelStyle}>
            가격 (mobil) <span style={requiredStyle}>*</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={form.priceText}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const v = e.target.value.replace(/[^\d]/g, "");
              setForm((f) => ({ ...f, priceText: v }));
            }}
            disabled={isDisabled}
            placeholder="예: 500"
            style={inputStyle}
          />
          <div style={fieldMetaStyle}>
            {form.priceText === "" ? (
              <span style={metaOkStyle}>0 ~ {SHOP_PRICE_MAX.toLocaleString()}</span>
            ) : priceValid ? (
              <span style={metaOkStyle}>{priceNum.toLocaleString()} mobil</span>
            ) : (
              <span style={metaBadStyle}>0 이상 {SHOP_PRICE_MAX.toLocaleString()} 이하의 정수를 입력해 주십시오.</span>
            )}
          </div>
        </div>

        {/* 참조 값 (타입별 라벨) */}
        <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <label style={labelStyle}>
            {itemRefMeta.label} <span style={requiredStyle}>*</span>
          </label>
          <input
            type="text"
            value={form.itemRef}
            maxLength={SHOP_ITEM_REF_MAX_LEN}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setForm((f) => ({ ...f, itemRef: e.target.value }))
            }
            disabled={isDisabled}
            placeholder={itemRefMeta.placeholder}
            style={inputStyle}
          />
          <div style={fieldMetaStyle}>
            <span style={itemRefValid || form.itemRef === "" ? metaOkStyle : metaBadStyle}>
              {form.itemRef === "" ? itemRefMeta.hint : itemRefMeta.hint}
            </span>
          </div>
        </div>

        {/* 설명 */}
        <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <label style={labelStyle}>설명</label>
          <textarea
            value={form.description}
            maxLength={SHOP_DESC_MAX_LEN}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            disabled={isDisabled}
            rows={2}
            placeholder="아이템 소개 (선택 사항)"
            style={textareaStyle}
          />
          <div style={fieldMetaStyle}>
            <span style={descValid ? metaOkStyle : metaBadStyle}>
              {form.description.length} / {SHOP_DESC_MAX_LEN}
            </span>
          </div>
        </div>

        {/* 이미지 URL */}
        <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <label style={labelStyle}>이미지 URL</label>
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
          </div>
        </div>

        {/* ── marker 전용 필드 ── */}
        {form.itemType === "marker" ? (
          <>
            <div style={fieldStyle}>
              <label style={labelStyle}>이모지</label>
              <input
                type="text"
                value={form.markerEmoji}
                maxLength={10}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, markerEmoji: e.target.value }))
                }
                disabled={isDisabled}
                placeholder="예: 🖍️"
                style={inputStyle}
              />
              <div style={fieldMetaStyle}>
                <span style={metaOkStyle}>인벤토리 · 매점 카드에 표시되는 이모지 (선택)</span>
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>초기 내구도</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.markerDurability}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  setForm((f) => ({ ...f, markerDurability: v }));
                }}
                disabled={isDisabled}
                placeholder={`기본 ${MARKER_DURABILITY_DEFAULT}`}
                style={inputStyle}
              />
              <div style={fieldMetaStyle}>
                <span style={durabilityValid ? metaOkStyle : metaBadStyle}>
                  {form.markerDurability === ""
                    ? `비워두면 기본 ${MARKER_DURABILITY_DEFAULT}`
                    : durabilityValid
                    ? "적용됩니다."
                    : `${MARKER_DURABILITY_MIN} ~ ${MARKER_DURABILITY_MAX.toLocaleString()} 정수`}
                </span>
              </div>
            </div>
          </>
        ) : null}

        {/* ── slot 보상 전용 (other 타입에서만) ── */}
        {form.itemType === "other" ? (
          <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
            <label style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={form.slotReward}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, slotReward: e.target.checked }))
                }
                disabled={isDisabled}
                style={{ margin: 0 }}
              />
              <span style={checkboxLabelStyle}>슬롯 전용 보상</span>
              <span style={checkboxHintStyle}>
                체크하면 매점에 노출되지 않고, 슬롯머신 보상 풀에만 들어갑니다.
              </span>
            </label>
          </div>
        ) : null}

        {form.itemType === "other" && form.slotReward ? (
          <>
            <div style={fieldStyle}>
              <label style={labelStyle}>
                보상 종류 <span style={requiredStyle}>*</span>
              </label>
              <div style={slotKindRowStyle}>
                {SLOT_KINDS.map((k) => {
                  const active = form.slotKind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, slotKind: k }))}
                      disabled={isDisabled}
                      style={{
                        ...slotKindButtonStyle,
                        background:  active ? "#1a9edb" : "#fff",
                        color:       active ? "#fff"    : "#0d6fa8",
                        borderColor: active ? "#0d6fa8" : "#bfe4f7",
                      }}
                    >
                      {SLOT_KIND_LABEL[k]}
                    </button>
                  );
                })}
              </div>
              <div style={fieldMetaStyle}>
                <span style={slotImageValid ? metaOkStyle : metaBadStyle}>
                  {form.slotKind === "doll"
                    ? "인형은 잭팟 한정 · 이미지 URL 필수"
                    : "쿠폰 · 잡템은 이미지 없어도 됩니다"}
                </span>
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>가중치</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.slotWeight}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  setForm((f) => ({ ...f, slotWeight: v }));
                }}
                disabled={isDisabled}
                placeholder={`기본 ${SLOT_WEIGHT_DEFAULT}`}
                style={inputStyle}
              />
              <div style={fieldMetaStyle}>
                <span style={slotWeightValid ? metaOkStyle : metaBadStyle}>
                  {form.slotWeight === ""
                    ? `비워두면 기본 ${SLOT_WEIGHT_DEFAULT} · 클수록 자주 나옴`
                    : slotWeightValid
                    ? "적용됩니다."
                    : `${SLOT_WEIGHT_MIN} ~ ${SLOT_WEIGHT_MAX.toLocaleString()} 정수`}
                </span>
              </div>
            </div>

            <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
              <label style={labelStyle}>이모지</label>
              <input
                type="text"
                value={form.slotEmoji}
                maxLength={10}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setForm((f) => ({ ...f, slotEmoji: e.target.value }))
                }
                disabled={isDisabled}
                placeholder="예: 🧸 (이미지가 없을 때 표시)"
                style={inputStyle}
              />
              <div style={fieldMetaStyle}>
                <span style={metaOkStyle}>
                  {form.imageUrl.trim() !== ""
                    ? "이미지가 있어 이모지 대신 이미지가 표시됩니다."
                    : form.slotEmoji.trim() !== ""
                    ? "이미지가 없으므로 이 이모지가 표시됩니다."
                    : "이미지 · 이모지 모두 없으면 종류 기본 이모지가 표시됩니다."}
                </span>
              </div>
            </div>
          </>
        ) : null}

        {/* 판매 시작 여부 */}
        <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, isActive: e.target.checked }))
              }
              disabled={isDisabled}
              style={{ margin: 0 }}
            />
            <span style={checkboxLabelStyle}>
              등록 즉시 판매 시작
            </span>
            <span style={checkboxHintStyle}>
              해제하면 "내림" 상태로 등록되며 언제든 다시 판매할 수 있습니다.
            </span>
          </label>
        </div>
      </div>

      {/* 액션 버튼 */}
      <div style={actionRowStyle}>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!allValid || isDisabled}
          style={{
            ...submitButtonStyle,
            opacity: (!allValid || isDisabled) ? 0.4 : 1,
            cursor:  (!allValid || isDisabled) ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "등록 중…" : "등록"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isDisabled}
          style={cancelButtonStyle}
        >
          취소
        </button>
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

const headerStyle: CSSProperties = {
  background:   "#fff",
  border:       "1.5px solid #dce8f0",
  borderRadius: 12,
  padding:      "12px 16px",
  display:      "flex",
  flexDirection: "column",
  gap:          6,
};

const headerTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   18,
  color:      "#0d6fa8",
};

const headerDescStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#5a7488",
  lineHeight: 1.6,
};

const segmentBarStyle: CSSProperties = {
  display:              "grid",
  gridTemplateColumns:  "repeat(3, 1fr)",
  gap:                  6,
};

const segmentButtonStyle: CSSProperties = {
  height:       40,
  padding:      "0 16px",
  border:       "2px solid",
  borderRadius: 12,
  fontFamily:   JUA,
  fontSize:     14,
  cursor:       "pointer",
  transition:   "background .12s, color .12s, box-shadow .12s",
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

const requiredStyle: CSSProperties = {
  color: "#c25a4d",
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

const fieldMetaStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  fontFamily: BODY,
  fontSize:   10.5,
  minHeight:  14,
};

const metaOkStyle: CSSProperties = {
  color:     "#5a7488",
  textAlign: "right",
  maxWidth:  "100%",
};

const metaBadStyle: CSSProperties = {
  color:     "#c25a4d",
  textAlign: "right",
  maxWidth:  "100%",
};

const checkboxRowStyle: CSSProperties = {
  display:     "flex",
  alignItems:  "center",
  gap:         8,
  cursor:      "pointer",
  flexWrap:    "wrap",
};

const checkboxLabelStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#0d6fa8",
};

const checkboxHintStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#7a94a8",
};

const slotKindRowStyle: CSSProperties = {
  display: "flex",
  gap:     6,
};

const slotKindButtonStyle: CSSProperties = {
  flex:         1,
  height:       34,
  border:       "2px solid",
  borderRadius: 10,
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
  transition:   "background .12s, color .12s",
};

const actionRowStyle: CSSProperties = {
  display:    "flex",
  gap:        8,
  alignItems: "center",
  flexShrink: 0,
};

const submitButtonStyle: CSSProperties = {
  height:       38,
  padding:      "0 26px",
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
  padding:      "0 20px",
  border:       "1.5px solid #cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     13,
  cursor:       "pointer",
};