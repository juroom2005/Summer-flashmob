// lib/session-name-color.ts
//
// 채팅에서 참가자 이름 글자색을 발신자별로 자동 배정한다.
//
// 설계:
//   · 순수 함수. 저장(DB·메모리·localStorage) 일절 없음. sender_profile_id 를
//     그 자리에서 해시해 고정 팔레트의 한 색으로 매핑할 뿐이다. 같은 id 는
//     언제·어디서 계산해도 같은 색이라, 모든 참가자 화면에서 같은 사람이
//     같은 색으로 보인다. 마이그레이션·RPC 변경 불필요.
//   · GM·본인 메시지는 호출부에서 이 함수를 쓰지 않고 기존 색을 유지한다.
//     (이미 시각 구분이 되어 있어 팔레트를 섞으면 오히려 혼란)
//
// 접근성:
//   · 색은 "빠른 스캔"용 보조 수단일 뿐, 식별의 근거는 항상 이름 텍스트다.
//     색각 이상이 있어도 이름으로 구분되므로 정보 손실이 없다.
//   · 팔레트는 밝은 채팅 배경(흰/연회색)에서 대비가 확보되도록 충분히
//     어두운 색만 골랐고, 색상환에서 서로 떨어뜨려 인접 혼동을 줄였다.

/** 밝은 배경에서 읽히는 12색. 서로 색상 간격을 두어 구분이 쉽게. */
const NAME_PALETTE = [
  "#1f6feb", // 파랑
  "#c0392b", // 빨강
  "#1e8e5a", // 초록
  "#8e44ad", // 보라
  "#b9770e", // 황토
  "#0e7c86", // 청록
  "#c2185b", // 자홍
  "#4527a0", // 남보라
  "#2e7d32", // 짙은 초록
  "#d84315", // 주황빨강
  "#00695c", // 짙은 청록
  "#5d4037", // 갈색
] as const;

/**
 * 문자열을 32bit 정수 해시로. (FNV-1a 변형)
 * 암호학적 용도 아님 — 색 분산이 목적이라 단순·결정적이면 충분.
 */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32bit 로 유지 (곱셈 후 오버플로 방지)
    h = Math.imul(h, 0x01000193);
  }
  // 부호 제거
  return h >>> 0;
}

/**
 * 발신자 id → 이름 글자색(hex). (단건용)
 * id 가 비어 있으면(탈퇴 등) 팔레트 첫 색으로 안전 폴백.
 * 방 맥락 없이 한 명의 색만 필요할 때 쓴다. 여러 명을 구분해야 하면
 * buildNameColorMap 을 써서 방 안 충돌을 없애는 쪽이 낫다.
 */
export function nameColorFor(profileId: string | null | undefined): string {
  if (!profileId) return NAME_PALETTE[0];
  return NAME_PALETTE[hashString(profileId) % NAME_PALETTE.length];
}

/**
 * 방에 등장한 발신자들에게 팔레트 색을 "분산" 배정한 map(id → hex)을 만든다.
 *
 * 단순 해시(nameColorFor)는 10명이면 생일 문제로 색이 겹칠 수 있다. 여기서는
 * 등장 순서대로 팔레트를 순환 배정하므로 팔레트 길이(12) 이하 인원은 색이
 * 절대 겹치지 않는다. 12명을 넘으면 그때부터 앞 색을 재사용한다.
 *
 * 안정성:
 *   · 배정 순서를 "id 정렬"로 고정한다. 메시지 도착 순서나 배열 순서가
 *     바뀌어도 같은 참가자 집합이면 항상 같은 색이 나온다(재조회·재정렬에
 *     흔들리지 않음). 다만 새 참가자가 늘면 그 뒤 순번 색은 바뀔 수 있는데,
 *     이는 "겹침 없음"을 위해 감수하는 트레이드오프다.
 *   · 시작 오프셋을 참가자 집합 해시로 정해, 방마다 첫 색이 파랑으로만
 *     쏠리지 않게 한다.
 *
 * ids 는 중복·null 이 섞여도 되고, 내부에서 정리한다.
 */
export function buildNameColorMap(
  ids: readonly (string | null | undefined)[]
): Map<string, string> {
  const uniq = Array.from(
    new Set(ids.filter((v): v is string => !!v))
  ).sort();

  const map = new Map<string, string>();
  if (uniq.length === 0) return map;

  // 집합 전체를 해시해 시작 오프셋 결정 (방마다 색 쏠림 완화, 결정적).
  const offset = hashString(uniq.join("|")) % NAME_PALETTE.length;

  uniq.forEach((id, i) => {
    map.set(id, NAME_PALETTE[(offset + i) % NAME_PALETTE.length]);
  });
  return map;
}