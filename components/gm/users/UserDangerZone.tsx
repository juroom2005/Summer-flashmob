// components/gm/users/UserDangerZone.tsx
//
// 유저 비활성화 / 완전 삭제 패널.
//
// 두 가지 삭제 방식:
//   1) 비활성화 (보수적)  — 데이터 전부 보존, 노출에서만 제외. 되돌리기 가능
//   2) 완전 삭제 (파괴적) — auth 계정 + profiles + CASCADE 연쇄. 되돌릴 수 없음
//
// 완전 삭제 3단계 안전장치:
//   Step 1: "완전 삭제" 버튼 클릭 → dry_run 호출, 영향 범위 집계
//   Step 2: 사라질 데이터 목록을 화면에 표시
//   Step 3: 유저 이름을 정확히 타이핑해야 최종 버튼 활성화
//
// 이름 타이핑 확인을 넣은 이유:
//   window.confirm 만으로는 습관적 클릭을 막지 못함. 채팅 완료 처리와 달리
//   이쪽은 복구 수단이 아예 없으므로 마찰을 의도적으로 높임.

"use client";

import { useState, type CSSProperties, type ChangeEvent } from "react";
import {
  deactivateGmUser,
  deleteGmUserPermanently,
  previewGmUserDeletion,
  reactivateGmUser,
  type DeletePreview,
} from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** 영향 범위 표시용 한국어 라벨. */
const DELETE_LABELS: Record<string, string> = {
  invite_codes:     "초대코드",
  inventory_items:  "인벤토리",
  badge_awards:     "뱃지",
  minigame_plays:   "미니게임 기록",
  user_stickers:    "스티커",
  shop_purchases:   "상점 구매 이력",
  mobil_grants:     "재화 지급 이력",
  gm_conversations: "GM 채팅방(메시지 포함)",
};

const ANONYMIZE_LABELS: Record<string, string> = {
  diary_texts:            "다이어리 텍스트",
  diary_strokes:          "다이어리 그림",
  diary_stickers:         "다이어리 스티커",
  invite_codes_issued_by: "이 유저가 발급한 초대코드",
  reports_resolved_by:    "이 유저가 처리한 문의",
  gm_messages_sent:       "GM 채팅에서 보낸 메시지",
};

type Props = {
  profileId:      string;
  displayName:    string;
  isGm:           boolean;
  deactivatedAt:  string | null;
  /** 비활성화·복구·삭제 후 부모 목록 재조회 트리거. */
  onChanged:      () => void;
};

export default function UserDangerZone({
  profileId,
  displayName,
  isGm,
  deactivatedAt,
  onChanged,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // 완전 삭제 흐름
  const [preview,     setPreview]     = useState<DeletePreview | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const isDeactivated = deactivatedAt !== null;

  /* ── 비활성화 / 복구 ── */

  async function handleDeactivate() {
    if (pending) return;
    const ok = window.confirm(
      `${displayName} 님을 비활성화하시겠습니까?\n\n` +
      "데이터는 전부 보존되며 명단 노출에서만 제외됩니다. 언제든 복구하실 수 있습니다."
    );
    if (!ok) return;

    setPending(true);
    setError(null);
    const res = await deactivateGmUser(profileId);
    if (res.ok) {
      onChanged();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function handleReactivate() {
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await reactivateGmUser(profileId);
    if (res.ok) {
      onChanged();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  /* ── 완전 삭제 ── */

  async function handlePreviewDelete() {
    if (pending) return;
    setPending(true);
    setError(null);
    setConfirmText("");

    const res = await previewGmUserDeletion(profileId);
    if (res.ok) {
      setPreview(res.data);
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function handleConfirmDelete() {
    if (pending || confirmText.trim() !== displayName) return;

    setPending(true);
    setError(null);
    const res = await deleteGmUserPermanently(profileId);
    if (res.ok) {
      setPreview(null);
      setConfirmText("");
      onChanged();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  function cancelDelete() {
    setPreview(null);
    setConfirmText("");
    setError(null);
  }

  /* ── GM 계정은 두 기능 모두 차단 ── */
  if (isGm) {
    return (
      <div style={wrapStyle}>
        <div style={sectionTitleStyle}>⚠️ 계정 관리</div>
        <div style={gmNoticeStyle}>
          GM 계정은 비활성화 및 삭제 대상이 아닙니다.
        </div>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={sectionTitleStyle}>⚠️ 계정 관리</div>

      {/* 1) 비활성화 / 복구 */}
      <div style={blockStyle}>
        <div style={blockTitleStyle}>
          {isDeactivated ? "비활성 상태" : "비활성화 (권장)"}
        </div>
        <div style={blockDescStyle}>
          {isDeactivated
            ? "현재 명단 노출에서 제외되어 있습니다. 데이터는 보존되어 있습니다."
            : "데이터를 보존한 채 명단 노출에서만 제외합니다. 언제든 복구하실 수 있습니다."}
        </div>
        <button
          type="button"
          onClick={isDeactivated ? handleReactivate : handleDeactivate}
          disabled={pending}
          style={{
            ...softButtonStyle,
            opacity: pending ? 0.4 : 1,
            cursor:  pending ? "not-allowed" : "pointer",
          }}
        >
          {isDeactivated ? "복구하기" : "비활성화"}
        </button>
      </div>

      {/* 2) 완전 삭제 */}
      <div style={dangerBlockStyle}>
        <div style={dangerTitleStyle}>완전 삭제</div>
        <div style={blockDescStyle}>
          계정과 관련 데이터를 영구히 제거합니다. 되돌릴 수 없습니다.
        </div>

        {!preview ? (
          <button
            type="button"
            onClick={handlePreviewDelete}
            disabled={pending}
            style={{
              ...dangerButtonStyle,
              opacity: pending ? 0.4 : 1,
              cursor:  pending ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "확인 중" : "완전 삭제"}
          </button>
        ) : (
          <div style={previewWrapStyle}>
            <div style={previewTitleStyle}>다음 데이터가 삭제됩니다</div>
            <ul style={previewListStyle}>
              {Object.entries(preview.will_delete)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <li key={k} style={previewItemStyle}>
                    {DELETE_LABELS[k] ?? k} · {n}건
                  </li>
                ))}
              {Object.values(preview.will_delete).every((n) => n === 0) ? (
                <li style={previewItemStyle}>삭제될 부가 데이터가 없습니다.</li>
              ) : null}
            </ul>

            {Object.values(preview.will_anonymize).some((n) => n > 0) ? (
              <>
                <div style={previewTitleStyle}>
                  다음 데이터는 보존되며 작성자 정보만 제거됩니다
                </div>
                <ul style={previewListStyle}>
                  {Object.entries(preview.will_anonymize)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => (
                      <li key={k} style={previewItemStyle}>
                        {ANONYMIZE_LABELS[k] ?? k} · {n}건
                      </li>
                    ))}
                </ul>
              </>
            ) : null}

            <div style={confirmLabelStyle}>
              계속하시려면 <strong style={confirmNameStyle}>{displayName}</strong> 을(를)
              정확히 입력해주십시오.
            </div>
            <input
              value={confirmText}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setConfirmText(e.target.value)
              }
              placeholder={displayName}
              disabled={pending}
              style={confirmInputStyle}
            />

            <div style={confirmButtonRowStyle}>
              <button
                type="button"
                onClick={cancelDelete}
                disabled={pending}
                style={{
                  ...softButtonStyle,
                  opacity: pending ? 0.4 : 1,
                  cursor:  pending ? "not-allowed" : "pointer",
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={pending || confirmText.trim() !== displayName}
                style={{
                  ...dangerButtonStyle,
                  opacity:
                    pending || confirmText.trim() !== displayName ? 0.4 : 1,
                  cursor:
                    pending || confirmText.trim() !== displayName
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {pending ? "삭제 중" : "영구 삭제"}
              </button>
            </div>
          </div>
        )}
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  padding:       12,
  background:    "#fdf7f7",
  border:        "1.5px solid #f0d5d5",
  borderRadius:  10,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#a33b3b",
};

const blockStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           5,
  padding:       10,
  background:    "#fff",
  border:        "1px solid #eadada",
  borderRadius:  8,
};

const dangerBlockStyle: CSSProperties = {
  ...blockStyle,
  border:     "1px solid #e5a0a0",
  background: "#fffafa",
};

const blockTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   12,
  color:      "#5a4a4a",
};

const dangerTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   12,
  color:      "#c23b3b",
};

const blockDescStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#7a6a6a",
  lineHeight: 1.5,
};

const softButtonStyle: CSSProperties = {
  alignSelf:    "flex-start",
  height:       28,
  padding:      "0 14px",
  border:       "1.5px solid #cfd8de",
  borderRadius: 999,
  background:   "#fff",
  color:        "#48606f",
  fontFamily:   JUA,
  fontSize:     11.5,
};

const dangerButtonStyle: CSSProperties = {
  alignSelf:    "flex-start",
  height:       28,
  padding:      "0 14px",
  border:       0,
  borderRadius: 999,
  background:   "#c23b3b",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     11.5,
};

const previewWrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           6,
  marginTop:     4,
};

const previewTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   11.5,
  color:      "#a33b3b",
  marginTop:  2,
};

const previewListStyle: CSSProperties = {
  margin:     0,
  paddingLeft: 16,
  display:     "flex",
  flexDirection: "column",
  gap:         2,
};

const previewItemStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#6a5a5a",
};

const confirmLabelStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#7a6a6a",
  marginTop:  4,
  lineHeight: 1.5,
};

const confirmNameStyle: CSSProperties = {
  fontFamily: JUA,
  color:      "#c23b3b",
};

const confirmInputStyle: CSSProperties = {
  height:       30,
  border:       "1.5px solid #e5c0c0",
  borderRadius: 8,
  padding:      "0 10px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#4a3a3a",
  outline:      "none",
  background:   "#fff",
};

const confirmButtonRowStyle: CSSProperties = {
  display: "flex",
  gap:     6,
  marginTop: 2,
};

const errorStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#c2410c",
};

const gmNoticeStyle: CSSProperties = {
  fontFamily:   BODY,
  fontSize:     11.5,
  color:        "#7a6a6a",
  lineHeight:   1.5,
  padding:      10,
  background:   "#fff",
  border:       "1px solid #eadada",
  borderRadius: 8,
};