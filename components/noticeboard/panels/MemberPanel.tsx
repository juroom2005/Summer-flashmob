"use client";

import { useState, useCallback } from "react";
import styles from "./MemberPanel.module.css";

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
};

const FIELD_ROWS: { label: string; key: keyof MemberProfile; wide?: boolean }[][] = [
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
    { label: "PERSONALITY", key: "personality", wide: true },
    { label: "ETC", key: "etc", wide: true },
  ],
];

const PROFILES: MemberProfile[] = [];

function MemberDetail({
  profile,
  onClose,
}: {
  profile: MemberProfile | null;
  onClose: () => void;
}) {
  const val = (key: keyof MemberProfile) =>
    profile ? String(profile[key] ?? "") : "";

  return (
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
          <div className={styles.photo}>
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt="" className={styles.photoImg} />
            ) : null}
          </div>
        </div>

        <div className={styles.fields}>
          {FIELD_ROWS.map((row, ri) => (
            <div key={ri} className={styles.fieldRow}>
              {row.map((f) => (
                <div
                  key={f.key}
                  className={`${styles.field} ${f.wide ? styles.fieldWide : ""}`}
                >
                  <span className={styles.fieldLabel}>{f.label}</span>
                  <span className={styles.fieldValue}>{val(f.key)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MemberPanel() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [active, setActive] = useState<MemberProfile | null>(null);

  const openDetail = useCallback((profile: MemberProfile | null) => {
    setActive(profile);
    setDetailOpen(true);
  }, []);
  const closeDetail = useCallback(() => setDetailOpen(false), []);

  return (
    <div className={styles.root}>
      <h2 className={styles.heading}>MEMBER</h2>

      {PROFILES.length > 0 ? (
        <div className={styles.grid}>
          {PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.slot}
              onClick={() => openDetail(p)}
              aria-label={`${p.name || "프로필"} 카드`}
            />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>아직 등록된 멤버가 없습니다.</p>
      )}

      {detailOpen ? (
        <MemberDetail profile={active} onClose={closeDetail} />
      ) : null}
    </div>
  );
}
