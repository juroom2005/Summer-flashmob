"use client";

// components/noticeboard/panels/MemberPanel.tsx
// ═══════════════════════════════════════════════════════════════════
// MEMBER 게시판
// ═══════════════════════════════════════════════════════════════════
//
// 데이터: lib/member-helpers.ts (member_profiles 테이블 + GM RPC)
// 권한(서버 RLS 가 최종 방어, 아래는 UX 게이팅):
//   · 누구나  : 카드 격자 열람 + 상세(읽기)
//   · GM      : "+ 프로필 작성"(유저 선택 후 생성) / 아무 프로필 편집·삭제
//   · 본인    : 자기 owner 프로필 편집(“GM 이 올린 걸 본인이 수정”)
//
// 상태 흐름:
//   list(격자) → 카드 클릭 → detail(읽기)
//   detail 에서 편집권한(GM or 본인) 있으면 "편집" → edit(폼)
//   GM "+ 작성" → pickOwner(유저선택) → edit(신규)
//
// 디자인: 읽기 상세(MemberDetail)는 기존 학생증 카드 그대로.
//   편집은 MemberEditCard 가 같은 레이아웃 재사용.

import { useState, useCallback, useEffect } from "react";
import styles from "./MemberPanel.module.css";
import MemberEditCard from "./MemberEditCard";
import NameTag from "../member/NameTag";
import ModalPortal from "./ModalPortal";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import { listGmUsers, type GmUserRow } from "@/lib/gm-user-helpers";
import BadgeRow from "@/components/shared/BadgeRow";
import {
  listMemberProfiles,
  getMyMemberProfile,
  gmCreateMemberProfile,
  gmUpdateMemberProfile,
  gmDeleteMemberProfile,
  updateMyMemberProfile,
  getMemberStatLevels,
  type MemberStatLevels,
  type MemberProfileInput,
} from "@/lib/member-helpers";

export type MemberProfile = {
  id: string;
  ownerId: string;
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
  photoUrl?: string;
  themeColor?: string;
  tagLast: string;
  tagFirst: string;
  quote: string;
};

const FIELD_ROWS: {
  label: string;
  key: keyof MemberProfile;
  wide?: boolean;
  full?: boolean;
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
    { label: "PERSONALITY", key: "personality", full: true },
  ],
  [
    { label: "ETC", key: "etc", full: true },
  ],
];

/* ── 읽기 전용 상세 (기존 디자인 유지) ── */
function MemberDetail({
  profile,
  canEdit,
  onEdit,
  onClose,
}: {
  profile: MemberProfile | null;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  // 실제 스탯 레벨(exp 파생, 0~5) — owner 의 profiles 에서 조회.
  // 실패/미조회 시 null → 기존 텍스트 값으로 폴백.
  const [levels, setLevels] = useState<MemberStatLevels | null>(null);

  useEffect(() => {
    let alive = true;
    setLevels(null);
    if (profile?.ownerId) {
      getMemberStatLevels(profile.ownerId).then((lv) => {
        if (alive) setLevels(lv);
      });
    }
    return () => {
      alive = false;
    };
  }, [profile?.ownerId]);

  // 스탯 3칸(rhythm/stamina/performance)과 회원정보 3칸(name/age/grade)은
  // 실제 profiles 값(levels)을 표시하고, 나머지 칸은 기존 텍스트 값을 그대로 표시.
  const val = (key: keyof MemberProfile) => {
    if (levels) {
      if (key === "rhythm") return String(levels.rhythm);
      if (key === "stamina") return String(levels.physical);
      if (key === "performance") return String(levels.expression);
      if (key === "name") return levels.name;
      if (key === "age") return levels.age;
      if (key === "grade") return levels.grade;
    }
    return profile ? String(profile[key] ?? "") : "";
  };

  return (
    <ModalPortal>
      <div className={styles.detailBackdrop} onClick={onClose}>
        <div className={styles.detailCard} onClick={(e) => e.stopPropagation()}>
          <div className={styles.detailHead}>
            <h2 className={styles.detailTitle}>
              <span className={styles.titleSm}>MOB-FLASHMOB</span>
              <span className={styles.titleLg}>MEMBER</span>
            </h2>
            <button
              type="button"
              className={styles.detailClose}
              onClick={onClose}
              aria-label="닫기"
            >
              {"\u2715"}
            </button>
          </div>

          <div className={styles.photoWrap}>
            <div className={styles.clip} aria-hidden />
            <div className={styles.photo} style={{ position: "relative" }}>
              {profile?.photoUrl ? (
                <img
                  src={profile.photoUrl}
                  alt=""
                  className={styles.photoImg}
                />
              ) : null}
              {/* 획득 뱃지 — 두상 사진 하단 좌측 */}
              {profile?.ownerId ? (
                <BadgeRow
                  profileId={profile.ownerId}
                  size={20}
                  gap={2}
                  style={{
                    position: "absolute",
                    left: 6,
                    bottom: 6,
                    padding: "2px 4px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.72)",
                  }}
                />
                            ) : null}
            </div>
          </div>
          {profile?.quote ? (
            <div className={styles.quoteBlock}>
              <span
                className={styles.quoteMark}
                style={{ color: profile.themeColor ?? "#3f88f9" }}
                aria-hidden
              >
                {"\u201C"}
              </span>
              <p className={styles.quoteText}>{profile.quote}</p>
            </div>
          ) : null}

          <div className={styles.fields}>
            {FIELD_ROWS.map((row, ri) => (
              <div key={ri} className={styles.fieldRow}>
                {row.map((f) => (
                  <div
                    key={f.key}
                    className={`${styles.field} ${
                      f.full ? styles.fieldFull : f.wide ? styles.fieldWide : ""
                    }`}
                  >
                    <span className={styles.fieldLabel}>{f.label}</span>
                    <span className={styles.fieldValue}>{val(f.key)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {canEdit ? (
            <div className={styles.editActions}>
              <span />
              <div className={styles.editActionsRight}>
                <button
                  type="button"
                  className={styles.editSaveBtn}
                  onClick={onEdit}
                >
                  편집
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  );
}

/* ── GM: 신규 작성 대상 유저 선택 ── */
function OwnerPicker({
  candidates,
  loading,
  onPick,
  onClose,
}: {
  candidates: GmUserRow[];
  loading: boolean;
  onPick: (u: GmUserRow) => void;
  onClose: () => void;
}) {
  const nameOf = (u: GmUserRow) =>
    `${u.family_name ?? ""} ${u.given_name ?? ""}`.trim() || "(이름 미등록)";

  return (
    <ModalPortal>
      <div className={styles.detailBackdrop} onClick={onClose}>
        <div className={styles.detailCard} onClick={(e) => e.stopPropagation()}>
          <div className={styles.detailHead}>
            <h2 className={styles.detailTitle}>
              <span className={styles.titleSm}>NEW MEMBER</span>
              <span className={styles.titleLg}>대상 유저 선택</span>
            </h2>
            <button
              type="button"
              className={styles.detailClose}
              onClick={onClose}
              aria-label="닫기"
            >
              {"\u2715"}
            </button>
          </div>

          {loading ? (
            <p className={styles.empty}>유저 목록을 불러오는 중…</p>
          ) : candidates.length === 0 ? (
            <p className={styles.empty}>
              프로필을 만들 수 있는 유저가 없습니다.
              <br />
              (모든 유저가 이미 프로필을 가지고 있습니다.)
            </p>
          ) : (
            <ul className={styles.ownerList}>
              {candidates.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={styles.ownerItem}
                    onClick={() => onPick(u)}
                  >
                    <span className={styles.ownerName}>{nameOf(u)}</span>
                    {!u.is_registered ? (
                      <span className={styles.ownerTag}>미가입</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

type Mode =
  | { kind: "list" }
  | { kind: "detail"; profile: MemberProfile }
  | { kind: "pickOwner" }
  | { kind: "editNew"; owner: GmUserRow }
  | { kind: "editExisting"; profile: MemberProfile };

export default function MemberPanel() {
  const { user, isGm } = useCurrentUser();

  const [profiles, setProfiles] = useState<MemberProfile[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  // 작성 대상 후보(유저 - 이미 프로필 가진 유저 제외)
  const [candidates, setCandidates] = useState<GmUserRow[]>([]);
  const [candLoading, setCandLoading] = useState(false);

  /* 목록 로드(초기 + 변경 후 재조회). */
  const reload = useCallback(async () => {
    const [list, mine] = await Promise.all([
      listMemberProfiles(),
      getMyMemberProfile(),
    ]);
    // [임시 디버그] 편집버튼 진단용 — 확인 후 제거
    console.log("[MemberPanel debug] getMyMemberProfile 결과:", JSON.stringify(mine));
    console.log("[MemberPanel debug] 목록 id들:", list.map((p) => p.id));
    setProfiles(list);
    setMyProfileId(mine?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 편집 권한: GM 이거나, 그 프로필이 본인 것. */
  const canEditProfile = useCallback(
    (p: MemberProfile) => {
      const result = isGm || (myProfileId !== null && p.id === myProfileId);
      // [임시 디버그] 편집버튼 진단용 — 확인 후 제거
      console.log("[MemberPanel debug] canEditProfile:", JSON.stringify({
        profileId: p.id, myProfileId, isGm, result,
      }));
      return result;
    },
    [isGm, myProfileId],
  );

  const openDetail = useCallback((profile: MemberProfile) => {
    setMode({ kind: "detail", profile });
  }, []);

  const closeOverlay = useCallback(() => {
    setMode({ kind: "list" });
    setFormMessage(null);
  }, []);

  /* GM: 작성 시작 → 유저 목록 로드 → 이미 프로필 있는 owner 제외 */
  const startCreate = useCallback(async () => {
    setMode({ kind: "pickOwner" });
    setCandLoading(true);
    const users = await listGmUsers(false);
    const takenOwnerIds = new Set(profiles.map((p) => p.ownerId));
    setCandidates(users.filter((u) => !takenOwnerIds.has(u.id)));
    setCandLoading(false);
  }, [profiles]);

  const pickOwner = useCallback((owner: GmUserRow) => {
    setFormMessage(null);
    setMode({ kind: "editNew", owner });
  }, []);

  const startEditExisting = useCallback((profile: MemberProfile) => {
    setFormMessage(null);
    setMode({ kind: "editExisting", profile });
  }, []);

  /* 저장: 신규(GM) / 기존(GM or 본인) 분기 */
  const handleSave = useCallback(
    async (input: MemberProfileInput) => {
      setSaving(true);
      setFormMessage(null);

      if (mode.kind === "editNew") {
        const res = await gmCreateMemberProfile(mode.owner.id, input);
        setSaving(false);
        if (!res.ok) {
          setFormMessage(res.message);
          return;
        }
        await reload();
        closeOverlay();
        return;
      }

      if (mode.kind === "editExisting") {
        const p = mode.profile;
        // GM 은 RPC, 본인은 RLS UPDATE. 둘 다 가능하면 GM RPC 우선(권한 넓음).
        const res = isGm
          ? await gmUpdateMemberProfile(p.id, input)
          : await updateMyMemberProfile(p.id, input);
        setSaving(false);
        if (!res.ok) {
          setFormMessage(res.message);
          return;
        }
        await reload();
        closeOverlay();
        return;
      }

      setSaving(false);
    },
    [mode, isGm, reload, closeOverlay],
  );

  /* 삭제(GM 만) */
  const handleDelete = useCallback(async () => {
    if (mode.kind !== "editExisting") return;
    if (!isGm) return;
    setSaving(true);
    setFormMessage(null);
    const res = await gmDeleteMemberProfile(mode.profile.id);
    setSaving(false);
    if (!res.ok) {
      setFormMessage(res.message);
      return;
    }
    await reload();
    closeOverlay();
  }, [mode, isGm, reload, closeOverlay]);

  return (
    <div className={styles.root}>
      <h2 className={styles.heading}>MEMBER</h2>

      {isGm ? (
        <div className={styles.gmBar}>
          <button
            type="button"
            className={styles.gmCreateBtn}
            onClick={startCreate}
          >
            + 프로필 작성
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className={styles.empty}>불러오는 중…</p>
      ) : profiles.length > 0 ? (
        <div className={styles.grid}>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.slot}
              onClick={() => openDetail(p)}
              aria-label={`${p.name || "프로필"} 카드`}
            >
              <NameTag
                lastName={p.tagLast}
                firstName={p.tagFirst}
                color={p.themeColor}
                width={137}
              />
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>아직 등록된 멤버가 없습니다.</p>
      )}

      {/* 오버레이 분기 */}
      {mode.kind === "detail" ? (
        <MemberDetail
          profile={mode.profile}
          canEdit={canEditProfile(mode.profile)}
          onEdit={() => startEditExisting(mode.profile)}
          onClose={closeOverlay}
        />
      ) : null}

      {mode.kind === "pickOwner" ? (
        <OwnerPicker
          candidates={candidates}
          loading={candLoading}
          onPick={pickOwner}
          onClose={closeOverlay}
        />
      ) : null}

      {mode.kind === "editNew" ? (
        <MemberEditCard
          profile={null}
          ownerId={mode.owner.id}
          ownerLabel={
            `${mode.owner.family_name ?? ""} ${mode.owner.given_name ?? ""}`.trim() ||
            "(이름 미등록)"
          }
          saving={saving}
          onSave={handleSave}
          onCancel={closeOverlay}
          message={formMessage}
        />
      ) : null}

      {mode.kind === "editExisting" ? (
        <MemberEditCard
          profile={mode.profile}
          saving={saving}
          onSave={handleSave}
          onCancel={closeOverlay}
          onDelete={isGm ? handleDelete : undefined}
          message={formMessage}
        />
      ) : null}
    </div>
  );
}