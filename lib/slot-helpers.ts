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

// ────────────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────────────
export type SlotConfig = {
  spinCost: number;
  lockSeconds: number;
  jackpotRate: number;
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
};

const ALLOWED_REASONS: readonly SpinFailReason[] = [
  "auth_required",
  "insufficient_mobil",
  "profile_not_found",
  "slot_pool_empty",
  "slot_config_missing",
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
    .select("spin_cost, lock_seconds, jackpot_rate")
    .eq("id", 1)
    .maybeSingle<SlotConfigRow>();

  if (error || !data) {
    if (error) console.warn("[slot] getSlotConfig failed:", error.message);
    return {
      spinCost: DEFAULT_SPIN_COST,
      lockSeconds: DEFAULT_LOCK_SECONDS,
      jackpotRate: DEFAULT_JACKPOT_RATE,
    };
  }

  return {
    spinCost: data.spin_cost ?? DEFAULT_SPIN_COST,
    lockSeconds: data.lock_seconds ?? DEFAULT_LOCK_SECONDS,
    jackpotRate:
      data.jackpot_rate !== null ? Number(data.jackpot_rate) : DEFAULT_JACKPOT_RATE,
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