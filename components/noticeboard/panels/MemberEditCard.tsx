"use client";

// components/noticeboard/panels/MemberEditCard.tsx
// ═══════════════════════════════════════════════════════════════════
// MEMBER 프로필 편집 카드 (작성/수정 공용)
// ═══════════════════════════════════════════════════════════════════
//
// 디자인: 읽기 전용 상세 카드(MemberPanel 내 MemberDetail)와 동일한 학생증
//   레이아웃(styles.detailCard/fields/fieldRow/field/photoWrap)을 재사용하고,
//   값 표시(span.fieldValue) 자리에 입력(input/textarea)을 얹는다.
//   → 기존 상세 화면 CSS 는 건드리지 않고, 편집 전용 클래스만 추가로 사용.
//
// 사진: ImageCropField(줌+드래그 크롭) → dataURL.
//
// 저장 경로는 이 컴포넌트가 정하지 않는다. onSave(input) 콜백으로 편집값만
//   넘기고, 실제 GM RPC / 본인 UPDATE 선택은 부모(MemberPanel)가 한다.

import { useState, useCallback } from "react";
import styles from "./MemberPanel.module.css";
import ImageCropField from "./ImageCropField";
import NameTag from "../member/NameTag";
import ModalPortal from "./ModalPortal";
import type { MemberProfile } from "./MemberPanel";
import type { MemberProfileInput } from "@/lib/member-helpers";

/* 편집 대상 텍스트 필드 정의. 읽기 카드의 FIELD_ROWS 와 라벨·배치 동일.
 * multiline: personality/etc 는 여러 줄. */
/** 텍스트 입력으로 다루는 필드만(photoUrl·themeColor 제외). */
type TextFieldKey =
  | "name"
  | "dateOfBirth"
  | "age"
  | "grade"
  | "height"
  | "rhythm"
  | "stamina"
  | "performance"
  | "personality"
  | "etc";

const EDIT_ROWS: {
  label: string;
  key: TextFieldKey;
  wide?: boolean;
  multiline?: boolean;
}[][] = [
  [
    { label: "NAME", key: "name", wide: true },
    { label: "DATE OF BIRTH", key: "dateOfBirth", wide: true },
  ],
  [
    { label: "AGE", key: "age" },
    { label: "GRADE", key: "grade" },
    { label: "HEIGHT", key: "height", wide: true },
  ],
  [
    { label: "RHYTHM", key: "rhythm" },
    { label: "STAMINA", key: "stamina" },
    { label: "PERFORMANCE", key: "performance", wide: true },
  ],
  [
    { label: "PERSONALITY", key: "personality", wide: true, multiline: true },
    { label: "ETC", key: "etc", wide: true, multiline: true },
  ],
];

type FormState = {
  name: string;
  dateOfBirth: string;
  age: string;
  grade: string;
  height: string;
  rhythm: string;
  stamina: string;
  performance: string;
  personality: string;
  etc: string;
  photoUrl: string | null; // null = 없음/삭제
  themeColor: string | null; // null = 기본색, hex = 지정
  tagLast: string;
  tagFirst: string;
};

function initialForm(profile: MemberProfile | null): FormState {
  return {
    name: profile?.name ?? "",
    dateOfBirth: profile?.dateOfBirth ?? "",
    age: profile?.age ?? "",
    grade: profile?.grade ?? "",
    height: profile?.height ?? "",
    rhythm: profile?.rhythm ?? "",
    stamina: profile?.stamina ?? "",
    performance: profile?.performance ?? "",
    personality: profile?.personality ?? "",
    etc: profile?.etc ?? "",
    photoUrl: profile?.photoUrl ?? null,
    themeColor: profile?.themeColor ?? null,
    tagLast: profile?.tagLast ?? "",
    tagFirst: profile?.tagFirst ?? "",
  };
}

/* FormState → helper 로 넘길 input.
 * photoUrl 은 그대로(문자열/null) 전달 → helper 가 3-상태 처리. */
function formToInput(f: FormState): MemberProfileInput {
  return {
    name: f.name,
    dateOfBirth: f.dateOfBirth,
    age: f.age,
    grade: f.grade,
    height: f.height,
    rhythm: f.rhythm,
    stamina: f.stamina,
    performance: f.performance,
    personality: f.personality,
    etc: f.etc,
    photoUrl: f.photoUrl,
    themeColor: f.themeColor,
    tagLast: f.tagLast,
    tagFirst: f.tagFirst,
  };
}

type Props = {
  /** 수정 대상. null 이면 신규 작성. */
  profile: MemberProfile | null;
  /** 신규 작성 시 대상 유저 표시명(헤딩 보조). */
  ownerLabel?: string;
  /** 저장 진행 중. */
  saving?: boolean;
  /** 저장 클릭. 편집값(input)을 넘긴다. */
  onSave: (input: MemberProfileInput) => void;
  /** 닫기/취소. */
  onCancel: () => void;
  /** 삭제(수정 모드 + GM 만 노출). 없으면 버튼 숨김. */
  onDelete?: () => void;
  /** 하단 안내/에러 메시지. */
  message?: string | null;
};

export default function MemberEditCard({
  profile,
  ownerLabel,
  saving = false,
  onSave,
  onCancel,
  onDelete,
  message,
}: Props) {
  const [form, setForm] = useState<FormState>(() => initialForm(profile));
  const [cropError, setCropError] = useState<string | null>(null);

  const setField = useCallback((key: keyof FormState, value: string | null) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    onSave(formToInput(form));
  }, [form, onSave]);

  const isNew = profile === null;

  return (
    <ModalPortal>
      <div className={styles.detailBackdrop} onClick={onCancel}>
        <div className={styles.detailCard} onClick={(e) => e.stopPropagation()}>
          <div className={styles.detailHead}>
            <h2 className={styles.detailTitle}>
              <span className={styles.titleSm}>MOB-FLASHMOB</span>
              <span className={styles.titleLg}>
                {isNew ? "NEW MEMBER" : "EDIT MEMBER"}
              </span>
            </h2>
            <button
              type="button"
              className={styles.detailClose}
              onClick={onCancel}
              aria-label="닫기"
            >
              {"\u2715"}
            </button>
          </div>

          {ownerLabel ? (
            <p className={styles.editOwnerLabel}>대상: {ownerLabel}</p>
          ) : null}

          {/* 사진 크롭 (읽기 카드의 우상단 폴라로이드 대신, 편집 영역 상단) */}
          <div className={styles.editPhotoBlock}>
            <ImageCropField
              value={form.photoUrl}
              onChange={(url) => setField("photoUrl", url)}
              onError={(m) => setCropError(m)}
            />
            {cropError ? <p className={styles.editError}>{cropError}</p> : null}
          </div>

          {/* 네임태그 입력 + 실시간 미리보기 */}
          <div className={styles.editThemeBlock}>
            <span className={styles.fieldLabel}>네임태그</span>
            <div className={styles.tagInputRow}>
              <input
                type="text"
                className={styles.editInput}
                value={form.tagLast}
                placeholder="상단 성 (영문, 예: CHISE)"
                onChange={(e) => setField("tagLast", e.target.value)}
              />
              <input
                type="text"
                className={styles.editInput}
                value={form.tagFirst}
                placeholder="가운데 이름 (영문, 예: Haruyuki)"
                onChange={(e) => setField("tagFirst", e.target.value)}
              />
            </div>
            <div className={styles.themeRow}>
              <input
                type="color"
                className={styles.themeColorPicker}
                value={form.themeColor ?? "#3f88f9"}
                onChange={(e) => setField("themeColor", e.target.value)}
                aria-label="네임태그 테마색 선택"
              />
              <input
                type="text"
                className={styles.editInput}
                value={form.themeColor ?? ""}
                placeholder="#3f88f9"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setField("themeColor", v === "" ? null : v);
                }}
              />
              <button
                type="button"
                className={styles.themeResetBtn}
                onClick={() => setField("themeColor", null)}
              >
                기본색
              </button>
            </div>
            <div className={styles.themePreview}>
              <NameTag
                lastName={form.tagLast}
                firstName={form.tagFirst}
                color={form.themeColor ?? undefined}
                width={137}
              />
            </div>
          </div>

          {/* 필드 표 (읽기 카드와 동일 구조, 값 자리에 입력) */}
          <div className={styles.fields}>
            {EDIT_ROWS.map((row, ri) => (
              <div key={ri} className={styles.fieldRow}>
                {row.map((f) => (
                  <div
                    key={f.key}
                    className={`${styles.field} ${f.wide ? styles.fieldWide : ""}`}
                  >
                    <span className={styles.fieldLabel}>{f.label}</span>
                    {f.multiline ? (
                      <textarea
                        className={styles.editTextarea}
                        value={form[f.key] as string}
                        onChange={(e) => setField(f.key, e.target.value)}
                        rows={3}
                      />
                    ) : (
                      <input
                        className={styles.editInput}
                        value={form[f.key] as string}
                        onChange={(e) => setField(f.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {message ? <p className={styles.editError}>{message}</p> : null}

          {/* 액션 */}
          <div className={styles.editActions}>
            {onDelete ? (
              <button
                type="button"
                className={styles.editDeleteBtn}
                onClick={onDelete}
                disabled={saving}
              >
                삭제
              </button>
            ) : (
              <span />
            )}
            <div className={styles.editActionsRight}>
              <button
                type="button"
                className={styles.editCancelBtn}
                onClick={onCancel}
                disabled={saving}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.editSaveBtn}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "저장 중" : isNew ? "작성" : "저장"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}