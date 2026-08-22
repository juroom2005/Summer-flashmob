// components/gm/users/UserItemsSection.tsx
//
// 유저 아이템 관리 묶음 (지급 + 인벤토리 확인).
//
// 역할:
//   · 대상 유저의 인벤토리를 조회(단일 소스)해서
//       - UserInventoryPanel 에 표시
//       - ItemGrantPanel 에 "이미 보유한 키" 로 전달(중복 방어)
//   · 지급 성공 시 인벤토리를 재조회해 양쪽을 최신화.
//
// 이 컴포넌트를 UserDetail 에 한 번만 얹으면 두 기능이 함께 붙는다.
//
// 안정성:
//   · 조회 실패는 빈 배열로 처리(표시 실패 < 잘못 표시). 지급 자체는 서버가
//     최종 판정하므로 ownedKeys 가 잠깐 비어도 서버 duplicate_* 로 막힌다.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listGmUserInventory,
  type GmInventoryRow,
} from "@/lib/gm-user-helpers";
import ItemGrantPanel     from "./ItemGrantPanel";
import UserInventoryPanel from "./UserInventoryPanel";

type Props = {
  profileId:     string;
  /** 미가입(shell) 유저도 profile 행은 있어 인벤토리 조회는 가능하나,
   *  지급은 가입 유저로 한정하고 싶으면 부모에서 이 컴포넌트를 조건부로 렌더. */
};

export default function UserItemsSection({ profileId }: Props) {
  const [rows,    setRows]    = useState<GmInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const data = await listGmUserInventory(profileId);
    setRows(data);
    setLoading(false);
  }, [profileId]);

  // 대상 유저가 바뀌면 재조회
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await listGmUserInventory(profileId);
      if (!cancelled) {
        setRows(data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  // 중복 방어용 보유 키 집합
  const ownedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.item_ref) s.add(`${r.item_type}:${r.item_ref}`);
    }
    return s;
  }, [rows]);

  return (
    <>
      <ItemGrantPanel
        profileId={profileId}
        ownedKeys={ownedKeys}
        onGranted={() => { void reload(); }}
      />
      <UserInventoryPanel
        rows={rows}
        loading={loading}
        onRefresh={() => { void reload(); }}
      />
    </>
  );
}
