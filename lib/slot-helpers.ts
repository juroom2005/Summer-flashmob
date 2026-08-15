// lib/slot-helpers.ts
// ═══════════════════════════════════════════════════════════════════
// 슬롯머신 헬퍼
// ═══════════════════════════════════════════════════════════════════
//
// RPC 래퍼:
//   - getSlotConfig()  : 슬롯 설정(비용·락 시간·잭팟 확률) 조회
//   - spinSlot()       : 스핀 실행. 모빌 차감 + 당첨 판정 + 아이템 지급을
//                        서버가 원자적으로 처리. 결과(당첨/보상/잔액) 반환.
//
// 서버 RPC 정의:
//   - sql/pending/2026-08-14_slot_machine.sql
//     · spin_slot()  : 잔액 FOR UPDATE 잠금 → 비용 차감 → 잭팟 판정
//                      → 잭팟이면 인형 1개, 아니면 쿠폰1+잡템1 지급
//                      → 인벤토리 스택(최대 99) 처리
//     · slot_config  : spin_cost · lock_seconds · jackpot_rate (GM 관리)
//
// 방침:
//   - 실패는 서버가 RAISE EXCEPTION 으로 던지므로 error.message 를
//     정규화해 reason 으로 매핑한다.
//   - 조회(getSlotConfig)는 실패 시 기본값을 반환해 화면이 죽지 않게 한다.
//   - 재화가 걸린 실행이므로, 애매한 실패는 절대 성공으로 처리하지 않는다.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from "./supabase";

// ────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────
const DEFAULT_SPIN_COST = 400;
const DEFAULT_LOCK_SECONDS = 50;
const DEFAULT_JACKPOT_RATE = 0.02;
const DEFAULT_IS_LOCKED = false;
const DEFAULT_LOCK_MESSAGE = "";

// ────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────
export type SlotConfig = {
  spinCost: number;
  lockSeconds: number;
  jackpotRate: number;
  isLocked: boolean;
  lockMessage: string;
};

/** 슬롯 보상 종류 */
export type SlotRewardKind = "doll" | "coupon" | "junk";

export type SlotReward = {
  kind: SlotRewardKind;
  itemRef: string;
  name: string;
  imageUrl: string | null;
  /** 커스텀 이모지 (metadata.emoji). 이미지가 없을 때 종류 기본 이모지 대신 표시. */
  emoji: string | null;
};

export type SpinFailReason =
  | "auth_required"       // 로그인 필요
  | "insufficient_mobil"  // 잔액 부족
  | "profile_not_found"   // 프로필 없음
  | "slot_pool_empty"     // 지급할 보상 풀이 비어 있음 (차감되지 않음)
  | "slot_config_missing" // 설정 행 없음
  | "slot_locked"         // GM 이 슬롯을 잠금 (차감되지 않음)
  | "unknown";

export type SpinSuccess = {
  ok: true;
  jackpot: boolean;
  newMobil: number;
  rewards: SlotReward[];
};

export type SpinFailure = {
  ok: false;
  reason: SpinFailReason;
};

export type SpinResult = SpinSuccess | SpinFailure;

// ── RPC 응답 원본 (안전 파싱용 좁은 타입) ──
type SpinRewardRaw = {
  kind?: string | null;
  item_ref?: string | null;
  name?: string | null;
  image_url?: string | null;
  emoji?: string | null;
};

type SpinSlotRaw = {
  ok?: boolean | null;
  jackpot?: boolean | null;
  new_mobil?: number | null;
  rewards?: SpinRewardRaw[] | null;
};

type SlotConfigRow = {
  spin_cost: number | null;
  lock_seconds: number | null;
  jackpot_rate: number | string | null;
  is_locked: boolean | null;
  lock_message: string | null;
};

const ALLOWED_REASONS: readonly SpinFailReason[] = [
  "auth_required",
  "insufficient_mobil",
  "profile_not_found",
  "slot_pool_empty",
  "slot_config_missing",
  "slot_locked",
  "unknown",
] as const;

const ALLOWED_KINDS: readonly SlotRewardKind[] = ["doll", "coupon", "junk"] as const;

// ────────────────────────────────────────────────────────────────────
// 내부 유틸
// ────────────────────────────────────────────────────────────────────

/** 서버 예외 메시지에서 알려진 reason 을 추출. 못 찾으면 unknown. */
function normalizeSpinError(message: string | null | undefined): SpinFailReason {
  const msg = (message ?? "").toLowerCase();
  for (const r of ALLOWED_REASONS) {
    if (r !== "unknown" && msg.includes(r)) return r;
  }
  return "unknown";
}

function normalizeKind(raw: string | null | undefined): SlotRewardKind | null {
  if (!raw) return null;
  return (ALLOWED_KINDS as readonly string[]).includes(raw)
    ? (raw as SlotRewardKind)
    : null;
}

function parseRewards(raw: SpinRewardRaw[] | null | undefined): SlotReward[] {
  if (!Array.isArray(raw)) return [];
  const out: SlotReward[] = [];
  for (const r of raw) {
    const kind = normalizeKind(r?.kind);
    const itemRef = r?.item_ref ?? "";
    if (!kind || !itemRef) continue; // 종류/참조 없는 보상은 무시 (방어)
    const emojiRaw = (r?.emoji ?? "").trim();
    out.push({
      kind,
      itemRef,
      name: r?.name ?? "",
      imageUrl: r?.image_url ?? null,
      emoji: emojiRaw === "" ? null : emojiRaw,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// 조회 : 슬롯 설정
// ────────────────────────────────────────────────────────────────────
/**
 * 슬롯 설정을 조회한다. 실패 시 기본값(400 / 50 / 0.02)을 반환해
 * 화면이 죽지 않게 한다. (실제 차감·확률은 서버가 다시 검증하므로,
 * 이 값은 표시·클라 락 용도로만 쓴다.)
 */
export async function getSlotConfig(): Promise<SlotConfig> {
  const { data, error } = await supabase
    .from("slot_config")
    .select("spin_cost, lock_seconds, jackpot_rate, is_locked, lock_message")
    .eq("id", 1)
    .maybeSingle<SlotConfigRow>();

  if (error || !data) {
    if (error) console.warn("[slot] getSlotConfig failed:", error.message);
    return {
      spinCost: DEFAULT_SPIN_COST,
      lockSeconds: DEFAULT_LOCK_SECONDS,
      jackpotRate: DEFAULT_JACKPOT_RATE,
      isLocked: DEFAULT_IS_LOCKED,
      lockMessage: DEFAULT_LOCK_MESSAGE,
    };
  }

  return {
    spinCost: data.spin_cost ?? DEFAULT_SPIN_COST,
    lockSeconds: data.lock_seconds ?? DEFAULT_LOCK_SECONDS,
    jackpotRate:
      data.jackpot_rate !== null ? Number(data.jackpot_rate) : DEFAULT_JACKPOT_RATE,
    isLocked: data.is_locked ?? DEFAULT_IS_LOCKED,
    lockMessage: data.lock_message ?? DEFAULT_LOCK_MESSAGE,
  };
}

// ────────────────────────────────────────────────────────────────────
// GM : 슬롯 설정 갱신
// ────────────────────────────────────────────────────────────────────
//
// slot_config 는 RLS 로 UPDATE 가 GM 에게만 허용된다(2026-08-14). 이 함수는
// 부분 갱신(patch)을 받아 전달된 필드만 바꾼다. 값 범위는 서버 CHECK 제약이
// 최종 방어하지만, 클라에서도 상식 범위를 선검증해 잘못된 저장을 줄인다.
//
// 반환 : 성공/실패. 실패 사유는 대략적으로만 구분(권한·범위·기타).

export const SLOT_COST_MAX     = 100_000;
export const SLOT_LOCK_SEC_MAX = 3_600;   // 진입 오클릭 방지 초 상한 (1시간)
export const SLOT_RATE_MIN     = 0;
export const SLOT_RATE_MAX     = 1;

export type SlotConfigPatch = {
  spinCost?: number;
  lockSeconds?: number;
  jackpotRate?: number;
  isLocked?: boolean;
  lockMessage?: string;
};

export type UpdateConfigResult =
  | { ok: true; config: SlotConfig }
  | { ok: false; reason: "invalid_value" | "permission_denied" | "unknown" };

export async function updateSlotConfig(patch: SlotConfigPatch): Promise<UpdateConfigResult> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (patch.spinCost !== undefined) {
    if (!Number.isInteger(patch.spinCost) || patch.spinCost < 0 || patch.spinCost > SLOT_COST_MAX) {
      return { ok: false, reason: "invalid_value" };
    }
    row.spin_cost = patch.spinCost;
  }
  if (patch.lockSeconds !== undefined) {
    if (!Number.isInteger(patch.lockSeconds) || patch.lockSeconds < 0 || patch.lockSeconds > SLOT_LOCK_SEC_MAX) {
      return { ok: false, reason: "invalid_value" };
    }
    row.lock_seconds = patch.lockSeconds;
  }
  if (patch.jackpotRate !== undefined) {
    if (!Number.isFinite(patch.jackpotRate) || patch.jackpotRate < SLOT_RATE_MIN || patch.jackpotRate > SLOT_RATE_MAX) {
      return { ok: false, reason: "invalid_value" };
    }
    row.jackpot_rate = patch.jackpotRate;
  }
  if (patch.isLocked !== undefined) {
    row.is_locked = patch.isLocked;
  }
  if (patch.lockMessage !== undefined) {
    row.lock_message = patch.lockMessage;
  }

  const { data, error } = await supabase
    .from("slot_config")
    .update(row)
    .eq("id", 1)
    .select("spin_cost, lock_seconds, jackpot_rate, is_locked, lock_message")
    .maybeSingle<SlotConfigRow>();

  if (error) {
    // RLS 위반(비GM)이면 permission 계열로 실패
    const msg = (error.message ?? "").toLowerCase();
    const reason = msg.includes("row-level") || msg.includes("policy") || msg.includes("permission")
      ? "permission_denied"
      : "unknown";
    console.warn("[slot] updateSlotConfig failed:", reason, error.message);
    return { ok: false, reason };
  }

  if (!data) {
    // 업데이트가 0행(권한 없어 필터로 걸러진 경우 포함)
    return { ok: false, reason: "permission_denied" };
  }

  return {
    ok: true,
    config: {
      spinCost: data.spin_cost ?? DEFAULT_SPIN_COST,
      lockSeconds: data.lock_seconds ?? DEFAULT_LOCK_SECONDS,
      jackpotRate: data.jackpot_rate !== null ? Number(data.jackpot_rate) : DEFAULT_JACKPOT_RATE,
      isLocked: data.is_locked ?? DEFAULT_IS_LOCKED,
      lockMessage: data.lock_message ?? DEFAULT_LOCK_MESSAGE,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// 실행 : 스핀 (모빌 차감 + 당첨 판정 + 지급, 전부 서버 원자 처리)
// ────────────────────────────────────────────────────────────────────
/**
 * 슬롯을 1회 돌린다. 서버가 잔액을 잠그고 차감·판정·지급을 한 트랜잭션으로
 * 처리하므로, 이 함수는 그 결과만 받아 반환한다.
 *
 * 실패 시 절대 성공으로 넘어가지 않으며, reason 으로 원인을 구분한다.
 *   - insufficient_mobil : 잔액 부족 (차감 안 됨)
 *   - slot_pool_empty    : 보상 풀 비어 있음 (차감 안 됨 — 서버가 롤백)
 *   - auth_required      : 로그인 필요
 */
export async function spinSlot(): Promise<SpinResult> {
  const { data, error } = await supabase.rpc("spin_slot");

  if (error) {
    const reason = normalizeSpinError(error.message);
    console.warn("[slot] spin_slot failed:", reason, error.message);
    return { ok: false, reason };
  }

  const row: SpinSlotRaw | null = Array.isArray(data)
    ? ((data[0] as SpinSlotRaw | undefined) ?? null)
    : ((data as SpinSlotRaw | null | undefined) ?? null);

  if (!row || row.ok !== true || row.new_mobil === null || row.new_mobil === undefined) {
    return { ok: false, reason: "unknown" };
  }

  return {
    ok: true,
    jackpot: Boolean(row.jackpot),
    newMobil: row.new_mobil,
    rewards: parseRewards(row.rewards),
  };
}