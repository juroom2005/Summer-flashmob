// components/noticeboard/daily-board/DailyBoardOverlay.tsx
// ═══════════════════════════════════════════════════════════════════
// 연습일지 (공용 데일리 보드) 오버레이
// ═══════════════════════════════════════════════════════════════════
//
// 메인홈 "연습일지" 위젯 클릭 시 여는 풀 오버레이. 시안 1B(화이트보드).
//
// 기능:
//   · 날짜 넘기기(‹ › / TODAY) · 날짜별 공용 보드 (KST 자정 기준 분리)
//   · 타이핑 → "배치 ▶" → 보드 클릭 배치      (아이템 불필요)
//   · 드로잉(DRAW)                             (사인펜 marker 보유 필요)
//   · 스티커(STICKER) → 팔레트 선택 → 배치      (sticker 아이템 보유 필요)
//   · 폴라로이드(PHOTO)                         (사진기 camera 보유 필요)
//   · 선택 아이템 기울기/크기/삭제, 드래그 이동
//
// 권한:
//   · 일반 유저 : 본인 아이템만 이동/조정/삭제. 남의 것은 열람만(선택·드래그 불가).
//   · GM        : 전 유저 아이템 이동/조정/삭제.
//   → 서버 RLS/GM RPC 로 강제. 프론트는 UX 로 사전 차단(canEdit 판정).
//
// 저장:
//   · 아이템 1개 = daily_board_items 행 1개. 낙관적 UI 후 서버 반영, 실패 시 롤백.
//   · 드로잉은 stroke 완료 시 1개 행으로 저장(그리는 중엔 로컬 미리보기).
//
// 원작 프로토타입(DailyBoard.jsx)의 UI/인터랙션을 보존하며 TS·DB·권한·게이팅
// 을 통합. 스티커 툴은 신설.
// ═══════════════════════════════════════════════════════════════════

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { getCurrentProfile } from "@/lib/auth-helpers";
import {
  listBoardItems,
  addBoardItem,
  updateBoardItemContent,
  deleteBoardItem,
  gmDeleteBoardItem,
  gmUpdateBoardItemContent,
  getBoardCapabilities,
  consumeMarkerInk,
  grantDailyJournalReward,
  kstDateString,
  type BoardItemRow,
  type BoardItemKind,
  type BoardCapabilities,
  type UsableSticker,
  type UsablePen,
} from "@/lib/daily-board-helpers";
import BadgeRow from "@/components/shared/BadgeRow";
import { listBadgesForProfiles, type UserBadge } from "@/lib/badge-helpers";

const BOARD_W = 800;
const BOARD_H = 1120;
const BOARD_VIEW_H = 700;
const WD = ["일", "월", "화", "수", "목", "금", "토"];

// 1B 화이트보드 스킨 토큰 (원작 유지)
const S = {
  tag: "CLEAN",
  pageBg: "#f5f8fd",
  chrome: "#eaf0fb",
  chromeInk: "#12306e",
  line: "#1a3a86",
  accent: "#1e63e9",
  boardBg: "#fbfcfe",
  boardBg2: "#f4f7fd",
  boardGrid:
    "linear-gradient(rgba(30,99,233,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(30,99,233,.10) 1px,transparent 1px)",
  ink: "#12306e",
  marker: "#1e63e9",
  mkSize: 5,
  ghost: "rgba(30,99,233,.35)",
};

const RANGE_CSS = `
.brd-range{-webkit-appearance:none;appearance:none;height:6px;border-radius:999px;outline:none}
.brd-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid ${S.accent};cursor:pointer}
.brd-range::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid ${S.accent};cursor:pointer}
.brd-ta::placeholder{opacity:.5}
`;

const mono = "'Space Mono',monospace";

// ── 로컬 아이템 표현 (행 + 파생 배치값을 평탄화) ──────────────────
type Placement = { x: number; y: number; rot: number; scale: number };
type Stroke = { color: string; size: number; pts: { x: number; y: number }[] };

type LocalItem = {
  id: string;            // 서버 행 id (낙관적 임시행은 'tmp-...')
  ownerId: string;
  ownerName: string;     // 작성자 표시명
  kind: BoardItemKind;
  place: Placement;      // text/sticker/photo 공통 (drawing 은 미사용)
  // kind 별
  text?: string;
  emoji?: string;
  src?: string;
  caption?: string;
  stroke?: Stroke;       // drawing
  pending?: boolean;     // 서버 반영 대기중
};

type Tool = "select" | "draw" | "sticker" | "eraser";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenLogin: () => void;
  isLoggedIn: boolean;
};

function rowToLocal(row: BoardItemRow): LocalItem {
  const c = row.content as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
  const place: Placement = {
    x: num(c.x, BOARD_W / 2),
    y: num(c.y, BOARD_H / 2),
    rot: num(c.rot, 0),
    scale: num(c.scale, 1),
  };
  const base: LocalItem = {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? "이름 미등록",
    kind: row.kind,
    place,
  };
  if (row.kind === "text") base.text = typeof c.text === "string" ? c.text : "";
  else if (row.kind === "sticker") base.emoji = typeof c.emoji === "string" ? c.emoji : "⭐";
  else if (row.kind === "photo") {
    base.src = typeof c.src === "string" ? c.src : "";
    base.caption = typeof c.caption === "string" ? c.caption : "";
  } else if (row.kind === "drawing") {
    const pts = Array.isArray(c.pts) ? (c.pts as { x: number; y: number }[]) : [];
    base.stroke = {
      color: typeof c.color === "string" ? c.color : S.marker,
      size: typeof c.size === "number" ? c.size : S.mkSize,
      pts,
    };
  }
  return base;
}

function localToContent(it: LocalItem): Record<string, unknown> {
  if (it.kind === "text")
    return { text: it.text ?? "", ...it.place };
  if (it.kind === "sticker")
    return { emoji: it.emoji ?? "⭐", ...it.place };
  if (it.kind === "photo")
    return { src: it.src ?? "", caption: it.caption ?? "", ...it.place };
  // drawing
  return {
    pts: it.stroke?.pts ?? [],
    color: it.stroke?.color ?? S.marker,
    size: it.stroke?.size ?? S.mkSize,
  };
}

export default function DailyBoardOverlay({
  open,
  onClose,
  onOpenLogin,
  isLoggedIn,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const CLOSE_MS = 220;
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setRender(true);
      let r2 = 0;
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(r1);
        cancelAnimationFrame(r2);
      };
    }

    setShown(false);
    const t = setTimeout(() => setRender(false), CLOSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  // 전역 range CSS 1회 주입
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("brd-range-css")) return;
    const el = document.createElement("style");
    el.id = "brd-range-css";
    el.textContent = RANGE_CSS;
    document.head.appendChild(el);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [placing, setPlacing] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // 작성자 뱃지 배치 조회 결과 (ownerId → 뱃지 목록)
  const [badgeMap, setBadgeMap] = useState<Map<string, UserBadge[]>>(new Map());
  // drawing hover 시 이름표를 띄울 보드 좌표 (마우스 위치)
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // 내 정보 · 권한
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>("이름 미등록");
  const [isGm, setIsGm] = useState(false);
  const [caps, setCaps] = useState<BoardCapabilities>({
    canDraw: false,
    canSticker: false,
    canPhoto: false,
    stickers: [],
    pens: [],
  });
  const [pickedSticker, setPickedSticker] = useState<UsableSticker | null>(null);
  const [pickedPen, setPickedPen] = useState<UsablePen | null>(null);

  const boardDate = kstDateString(offset);

  // ── 작성자 뱃지 배치 조회 (items 의 ownerId 모아 한 번에) ──
  useEffect(() => {
    const ids = items.map((i) => i.ownerId).filter(Boolean);
    if (ids.length === 0) {
      setBadgeMap(new Map());
      return;
    }
    let live = true;
    listBadgesForProfiles(ids).then((map) => {
      if (live) setBadgeMap(map);
    });
    return () => {
      live = false;
    };
  }, [items]);

  // ── 권한 판정 ──
  const canEdit = useCallback(
    (it: LocalItem) => isGm || (myProfileId != null && it.ownerId === myProfileId),
    [isGm, myProfileId]
  );

  // ── 일일 일지 보상 ──
  // 아이템(글·그림·스티커·사진)을 성공적으로 올린 뒤 호출.
  // 그날 최초면 DB(RPC)가 100 모빌을 지급하고, 이미 받았으면 조용히 무시된다.
  // "하루 1회"·"KST 초기화"·중복방지는 전부 서버가 보장하므로 매번 불러도 안전.
  const rewardJournalOnce = useCallback(async () => {
    const r = await grantDailyJournalReward();
    if (r && r.granted) {
      setBanner(`오늘 첫 일지 작성! ${r.amount} 모빌을 받았어요.`);
    }
  }, []);

  // ── open 시 프로필/권한/능력 로드 ──
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBanner(null);
    setSel(null);
    setTool("select");
    setPlacing(false);

    (async () => {
      if (isLoggedIn) {
        const p = await getCurrentProfile();
        if (alive) {
          setMyProfileId((p?.id as string) ?? null);
          setIsGm(p?.is_gm === true);
          const nm = p
            ? [p.family_name, p.given_name].filter(Boolean).join(" ")
            : "";
          setMyName(nm.length > 0 ? nm : "이름 미등록");
        }
        const c = await getBoardCapabilities();
        if (alive) {
          setCaps(c);
          setPickedPen(c.pens.length > 0 ? c.pens[0] : null);
        }
      } else {
        if (alive) {
          setMyProfileId(null);
          setIsGm(false);
          setMyName("이름 미등록");
          setCaps({ canDraw: false, canSticker: false, canPhoto: false, stickers: [], pens: [] });
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, isLoggedIn]);

  // ── 날짜 바뀌면 보드 재조회 ──
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setSel(null);
    setPlacing(false);

    listBoardItems(boardDate).then((rows) => {
      if (!alive) return;
      setItems(rows.map(rowToLocal));
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [open, boardDate]);

  // ── canvas 다시 그리기 ── (매 렌더 후 실행. items·strokeRef 반영)
  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const paint = (s: Stroke, highlight?: "select" | "erase") => {
      // 선택/지우기 강조: 원래 선 밑에 반투명 굵은 선을 깔아 하이라이트
      if (highlight) {
        ctx.strokeStyle = highlight === "erase" ? "rgba(229,72,77,.45)" : "rgba(30,99,233,.35)";
        ctx.lineWidth = s.size + 10;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    };
    for (const it of items) {
      if (it.kind === "drawing" && it.stroke) {
        const hl =
          tool === "eraser" && hoveredId === it.id && canEdit(it)
            ? "erase"
            : sel === it.id
              ? "select"
              : undefined;
        paint(it.stroke, hl);
      }
    }
    if (strokeRef.current) paint(strokeRef.current);
  };
  useEffect(draw);

  const localPt = (e: ReactPointerEvent) => {
    const r = layerRef.current!.getBoundingClientRect();
    const sx = r.width / BOARD_W;
    const sy = r.height / BOARD_H;
    return { x: (e.clientX - r.left) / sx, y: (e.clientY - r.top) / sy };
  };

  // ── 로그인/게이팅 가드 ──
  const requireLogin = (): boolean => {
    if (!isLoggedIn) {
      onOpenLogin();
      return false;
    }
    return true;
  };

  // ── 드로잉 ──
  const onCanvasDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool !== "draw") return;
    if (!requireLogin()) return;
    if (!caps.canDraw) {
      setBanner("드로잉은 사인펜 아이템이 있어야 사용할 수 있어요.");
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    strokeRef.current = {
      color: pickedPen?.color ?? S.marker,
      size: S.mkSize,
      pts: [{ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }],
    };
    draw();
  };
  const onCanvasMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!strokeRef.current) return;
    strokeRef.current.pts.push({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    draw();
  };
  const onCanvasUp = async () => {
    if (!strokeRef.current) return;
    const st = strokeRef.current;
    strokeRef.current = null;
    if (st.pts.length < 2 || !myProfileId) {
      draw();
      return;
    }
    // 서버 저장 (drawing 은 낙관적 표시 후 반영)
    const res = await addBoardItem({
      boardDate,
      ownerId: myProfileId,
      kind: "drawing",
      content: { pts: st.pts, color: st.color, size: st.size },
      ownerName: myName,
    });
    if (res.ok) {
      setItems((prev) => [...prev, rowToLocal(res.data)]);
      void rewardJournalOnce();

      // ── 잉크 소모 (선 길이 비례) ──
      // 그리기 자체는 이미 저장됨. 잉크는 별도로 차감 시도하며, 실패해도
      // 그림은 유지한다(잉크 정합은 다음 조회 때 재동기화됨).
      const pen = pickedPen;
      if (pen && pen.durability != null) {
        // 획(stroke) 하나당 잉크 1 소모. (선 길이 비례는 너무 빨리 닳아 획 단위로)
        const cost = 1;
        const r = await consumeMarkerInk(pen.inventoryId, cost);
        if (r.ok) {
          const remaining = r.remaining; // null=무한
          setCaps((prev) => {
            const nextPens = prev.pens
              .map((p) =>
                p.inventoryId === pen.inventoryId
                  ? { ...p, durability: remaining }
                  : p
              )
              // 잔량 0 이하인 펜은 팔레트에서 제거 (행은 DB 에 durability=0 으로 남음)
              .filter((p) => p.durability == null || p.durability > 0);
            return { ...prev, pens: nextPens, canDraw: nextPens.length > 0 };
          });
          // 방금 쓰던 펜이 다 떨어졌으면 선택을 다른 펜으로 옮기거나 해제
          if (remaining != null && remaining <= 0) {
            // 아직 잉크 남은 다른 펜으로 자동 전환 (없으면 해제)
            const alt = caps.pens.find(
              (p) => p.inventoryId !== pen.inventoryId && (p.durability == null || p.durability > 0)
            );
            setPickedPen(alt ?? null);
            setBanner("사인펜 잉크를 다 썼어요. 리필하거나 다른 펜을 사용해주세요.");
          }
        }
      }
    } else {
      setBanner(res.message);
      draw();
    }
  };

  // ── 타이핑 → 배치 ──
  const startPlace = () => {
    if (!draft.trim()) return;
    if (!requireLogin()) return;
    setPlacing(true);
    setTool("select");
    setSel(null);
  };

  // ── 스티커 팔레트에서 고르기 → 배치 모드 ──
  const pickSticker = (s: UsableSticker) => {
    if (!requireLogin()) return;
    setPickedSticker(s);
    setTool("sticker");
    setPlacing(false);
    setSel(null);
  };

  // ── 사진 ──
  const onPhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f || !myProfileId) return;
    const rd = new FileReader();
    rd.onload = async (ev) => {
      const src = String(ev.target?.result ?? "");
      const cap = f.name.replace(/\.[^.]+$/, "").slice(0, 16);
      const place: Placement = {
        x: BOARD_W / 2,
        y: BOARD_H / 2,
        rot: Math.random() * 10 - 5,
        scale: 1,
      };
      const res = await addBoardItem({
        boardDate,
        ownerId: myProfileId,
        kind: "photo",
        content: { src, caption: cap, ...place },
        ownerName: myName,
      });
      if (res.ok) {
        const li = rowToLocal(res.data);
        setItems((prev) => [...prev, li]);
        setSel(li.id);
        setTool("select");
        void rewardJournalOnce();
      } else {
        setBanner(res.message);
      }
    };
    rd.readAsDataURL(f);
  };

  // ── 보드 배경 클릭: 배치 확정 or 선택 해제 ──
  const onLayerDown = async (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== layerRef.current) return;

    // 지우개: hover 중인 drawing 을 바로 삭제 (권한 있는 것만)
    if (tool === "eraser") {
      if (hoveredId) {
        const h = items.find((i) => i.id === hoveredId);
        if (h && h.kind === "drawing") {
          if (canEdit(h)) {
            void deleteById(h.id);
          } else {
            setBanner("다른 사람이 그린 것이라 지울 수 없어요.");
          }
        }
      }
      return;
    }

    // 타이핑 배치
    if (placing && draft.trim() && myProfileId) {
      const p = localPt(e);
      const place: Placement = { x: p.x, y: p.y, rot: Math.random() * 10 - 5, scale: 1 };
      setPlacing(false);
      const text = draft;
      setDraft("");
      const res = await addBoardItem({
        boardDate,
        ownerId: myProfileId,
        kind: "text",
        content: { text, ...place },
        ownerName: myName,
      });
      if (res.ok) {
        const li = rowToLocal(res.data);
        setItems((prev) => [...prev, li]);
        setSel(li.id);
        void rewardJournalOnce();
      } else {
        setBanner(res.message);
      }
      return;
    }

    // 스티커 배치
    if (tool === "sticker" && pickedSticker && myProfileId) {
      const p = localPt(e);
      const place: Placement = { x: p.x, y: p.y, rot: Math.random() * 10 - 5, scale: 1 };
      const emoji = pickedSticker.emoji;
      const res = await addBoardItem({
        boardDate,
        ownerId: myProfileId,
        kind: "sticker",
        content: { emoji, ...place },
        ownerName: myName,
      });
      if (res.ok) {
        const li = rowToLocal(res.data);
        setItems((prev) => [...prev, li]);
        setSel(li.id);
        setTool("select");
        void rewardJournalOnce();
      } else {
        setBanner(res.message);
      }
      return;
    }

    // 드로잉 선택: select 모드에서 stroke 근처를 클릭하면 그 drawing 을 선택.
    // (drawing 은 canvas 에 그려져 클릭 대상이 없으므로 hover 감지 결과를 사용)
    if (tool === "select" && hoveredId) {
      const h = items.find((i) => i.id === hoveredId);
      if (h && h.kind === "drawing") {
        setSel(h.id);
        return;
      }
    }

    setSel(null);
  };
  const onItemDown = (e: ReactPointerEvent<HTMLDivElement>, it: LocalItem) => {
    if (tool === "draw") return;
    e.stopPropagation();
    // 열람 전용: 권한 없으면 선택만(조정 불가), 드래그 없음
    if (!canEdit(it)) {
      setSel(it.id);
      return;
    }
    layerRef.current!.setPointerCapture(e.pointerId);
    const p = localPt(e);
    dragRef.current = { id: it.id, dx: p.x - it.place.x, dy: p.y - it.place.y };
    setSel(it.id);
  };
  const onLayerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      const p = localPt(e);
      const { id, dx, dy } = dragRef.current;
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, place: { ...i.place, x: p.x - dx, y: p.y - dy } } : i
        )
      );
      return;
    }
    // 드래그 아님: drawing stroke hover 감지 (select·eraser 모드에서)
    if (tool !== "select" && tool !== "eraser") {
      if (hoverPt) setHoverPt(null);
      return;
    }
    const p = localPt(e);
    const HIT = 10; // 선에서 이 거리(px) 안이면 hover 판정
    let found: LocalItem | null = null;
    for (const it of items) {
      if (it.kind !== "drawing" || !it.stroke) continue;
      const pts = it.stroke.pts;
      for (const pt of pts) {
        const dxp = pt.x - p.x;
        const dyp = pt.y - p.y;
        if (dxp * dxp + dyp * dyp <= HIT * HIT) {
          found = it;
          break;
        }
      }
      if (found) break;
    }
    if (found) {
      setHoveredId(found.id);
      setHoverPt(p);
    } else if (hoveredId && items.find((i) => i.id === hoveredId)?.kind === "drawing") {
      // 이전에 drawing 을 hover 중이었다면 해제 (text/sticker hover 는 각자 처리)
      setHoveredId(null);
      setHoverPt(null);
    }
  };
  const onLayerUp = async () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const it = items.find((i) => i.id === d.id);
    if (it) void persist(it); // 이동 결과 저장
  };

  // ── 선택 조정 (기울기/크기) ──
  const updSel = (fn: (p: Placement) => Placement) => {
    if (!sel) return;
    setItems((prev) =>
      prev.map((i) => (i.id === sel ? { ...i, place: fn({ ...i.place }) } : i))
    );
  };
  const commitSel = () => {
    const it = items.find((i) => i.id === sel);
    if (it) void persist(it);
  };

  // content 저장 (본인=직접, GM 이 남의 것=RPC)
  const persist = async (it: LocalItem) => {
    if (it.kind === "drawing") return; // 드로잉은 이동/조정 없음
    const content = localToContent(it);
    const mine = myProfileId != null && it.ownerId === myProfileId;
    const res = mine
      ? await updateBoardItemContent(it.id, content)
      : await gmUpdateBoardItemContent(it.id, content);
    if (!res.ok) setBanner(res.message);
  };

  // id 로 아이템 삭제 (본인=직접, GM 이 남의 것=RPC). 권한 없으면 무시.
  const deleteById = async (id: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    if (!canEdit(it)) return;
    const mine = myProfileId != null && it.ownerId === myProfileId;
    // 낙관적 제거
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (sel === id) setSel(null);
    const res = mine ? await deleteBoardItem(id) : await gmDeleteBoardItem(id);
    if (!res.ok) {
      setBanner(res.message);
      const rows = await listBoardItems(boardDate);
      setItems(rows.map(rowToLocal));
    }
  };

  const deleteSel = async () => {
    if (!sel) return;
    await deleteById(sel);
  };

  // ── 파생값 ──
  const selItem = items.find((i) => i.id === sel) ?? null;
  const selEditable = selItem ? canEdit(selItem) : false;
  const d = new Date();
  // KST 라벨 (offset 반영)
  const kstStr = boardDate; // 'YYYY-MM-DD'
  const [yy, mm, dd] = kstStr.split("-").map((n) => parseInt(n, 10));
  const labelDate = new Date(Date.UTC(yy, mm - 1, dd));
  const dateLabel = `${yy}.${String(mm).padStart(2, "0")}.${String(dd).padStart(2, "0")} (${WD[labelDate.getUTCDay()]})`;
  const isEmpty = items.length === 0;

  const drawableTools = [
    { label: "SELECT", k: "select" as const, enabled: true },
    { label: "DRAW", k: "draw" as const, enabled: caps.canDraw },
    { label: "ERASER", k: "eraser" as const, enabled: true },
    { label: "PHOTO", k: "photo" as const, enabled: caps.canPhoto },
  ];

  if (!render || !mounted) return null;

  const dimAnim: CSSProperties = {
    opacity: shown ? 1 : 0,
    transition: "opacity 240ms ease",
  };
  const sheetAnim: CSSProperties = {
    transform: shown ? "translateY(0)" : "translateY(40px)",
    opacity: shown ? 1 : 0,
    transition:
      "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease",
    willChange: "transform, opacity",
  };

  const overlay = (
    <div style={{ ...dimStyle, ...dimAnim }} onPointerDown={onClose}>
      <div style={{ ...sheetStyle, ...sheetAnim }} onPointerDown={(e) => e.stopPropagation()}>
        {/* 닫기 */}
        <button onClick={onClose} style={closeStyle} aria-label="닫기">✕</button>

        <div style={springWrap}>
          {Array.from({ length: 22 }).map((_, i) => (
            <span key={i} style={springStyle} />
          ))}
        </div>

        <div style={{ position: "absolute", left: 0, right: 0, top: 48, height: 836 }}>
          {/* header */}
          <div style={headerRow}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <div style={{ fontFamily: "'Anton',sans-serif", fontSize: 30, letterSpacing: 1, color: S.chromeInk }}>
                연습일지
              </div>
              <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, letterSpacing: 3, color: S.accent }}>
                DAILY BOARD
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div onClick={() => { setOffset((o) => o - 1); setSel(null); }} style={navBtn}>‹</div>
              <div style={dateBox}>{dateLabel}</div>
              {/* 미래로는 못 감(과거·오늘만). offset<0 만 앞으로 이동 허용 */}
              <div
                onClick={() => { if (offset < 0) { setOffset((o) => o + 1); setSel(null); } }}
                style={{ ...navBtn, opacity: offset < 0 ? 1 : 0.35, cursor: offset < 0 ? "pointer" : "not-allowed" }}
              >›</div>
              <div onClick={() => { setOffset(0); setSel(null); }} style={todayBtn}>TODAY</div>
            </div>
          </div>

          {/* 배너 */}
          {banner && (
            <div style={bannerStyle} onClick={() => setBanner(null)}>
              {banner} <span style={{ opacity: 0.7 }}>(탭하여 닫기)</span>
            </div>
          )}

          {/* board layer */}
          <div style={boardWrap}>
            <div style={boardContent}>
            <div
              ref={layerRef}
              onPointerDown={onLayerDown}
              onPointerMove={onLayerMove}
              onPointerUp={onLayerUp}
              style={{
                ...boardLayer,
                // DRAW 모드에선 layer 가 pointer 를 놓아 canvas(아래 zIndex)가
                // 마우스를 받게 한다. 안 그러면 위에 있는 layer 가 가로채
                // 선이 안 그려진다.
                pointerEvents: tool === "draw" ? "none" : "auto",
              }}
            >
              {/* 아이템들 (drawing 제외) */}
              {items.map((it) => {
                if (it.kind === "drawing") return null;
                const selected = sel === it.id;
                const editable = canEdit(it);
                return (
                  <div
                    key={it.id}
                    onPointerDown={(e) => onItemDown(e, it)}
                    onMouseEnter={() => setHoveredId(it.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === it.id ? null : h))}
                    style={{
                      position: "absolute",
                      left: it.place.x,
                      top: it.place.y,
                      transform: `translate(-50%,-50%) rotate(${it.place.rot}deg) scale(${it.place.scale})`,
                      transformOrigin: "center",
                      cursor: editable ? "grab" : "default",
                      userSelect: "none",
                      zIndex: selected ? 9 : 3,
                      outline: selected ? `2px dashed ${editable ? S.accent : "#9aa8c8"}` : "none",
                      outlineOffset: 8,
                    }}
                  >
                    {it.kind === "text" && (
                      <div style={textItemStyle}>{it.text}</div>
                    )}
                    {it.kind === "sticker" && (
                      <div style={{ fontSize: 54, lineHeight: 1 }}>{it.emoji}</div>
                    )}
                    {it.kind === "photo" && (
                      <div style={{ position: "relative", background: "#fff", padding: "10px 10px 6px", boxShadow: "0 8px 22px rgba(0,0,0,.35)" }}>
                        {/* 폴라로이드 틀 왼상단: 작성자명 상시 표시 */}
                        <div style={{ ...photoAuthorTag, display: "flex", alignItems: "center", gap: 3 }}>
                          <span>{it.ownerName}</span>
                          <BadgeRow badges={badgeMap.get(it.ownerId) ?? []} size={14} gap={2} titlePrefix={`${it.ownerName} · `} />
                        </div>
                        <img src={it.src} alt="" style={{ display: "block", width: 180, height: 150, objectFit: "cover", background: "#ccc" }} />
                        <div style={photoCaption}>{it.caption}</div>
                      </div>
                    )}

                    {/* text/drawing/sticker: hover 시 작성자명 툴팁.
                        (drawing 은 이 레이어에 없어 canvas 별도지만, text·sticker 는 여기서 처리) */}
                    {it.kind !== "photo" && hoveredId === it.id && (
                      <div style={{ ...hoverAuthorTag, display: "flex", alignItems: "center", gap: 3 }}>
                        <span>{it.ownerName}</span>
                        <BadgeRow badges={badgeMap.get(it.ownerId) ?? []} size={13} gap={2} titlePrefix={`${it.ownerName} · `} />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* drawing hover 이름표 (마우스 근처) */}
              {(() => {
                if (!hoverPt || !hoveredId) return null;
                const h = items.find((i) => i.id === hoveredId);
                if (!h || h.kind !== "drawing") return null;
                return (
                  <div
                    style={{
                      ...hoverAuthorTag,
                      position: "absolute",
                      left: hoverPt.x,
                      top: hoverPt.y - 14,
                      bottom: "auto",
                      transform: "translate(-50%, -100%)",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <span>{h.ownerName}</span>
                    <BadgeRow badges={badgeMap.get(h.ownerId) ?? []} size={13} gap={2} titlePrefix={`${h.ownerName} · `} />
                  </div>
                );
              })()}
            </div>

            {/* drawing canvas */}
            <canvas
              ref={canvasRef}
              width={BOARD_W}
              height={BOARD_H}
              onPointerDown={onCanvasDown}
              onPointerMove={onCanvasMove}
              onPointerUp={onCanvasUp}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                width: BOARD_W,
                height: BOARD_H,
                pointerEvents: tool === "draw" ? "auto" : "none",
                cursor: "crosshair",
                touchAction: "none",
              }}
            />
            </div>

            {loading && (
              <div style={centerGhost}>불러오는 중…</div>
            )}
            {!loading && placing && (
              <div style={placingHint}>보드를 클릭해 메모를 배치하세요 · 배치 후 기울기·크기 조정</div>
            )}
            {!loading && tool === "sticker" && pickedSticker && (
              <div style={placingHint}>보드를 클릭해 {pickedSticker.emoji} 스티커를 붙이세요</div>
            )}
            {!loading && tool === "eraser" && (
              <div style={{ ...placingHint, background: "#e5484d" }}>지우개 · 그린 선 위를 클릭하면 지워져요</div>
            )}
            {!loading && isEmpty && !placing && (
              <div style={centerGhost}>— 아직 비어있는 보드 —</div>
            )}
          </div>

          {/* right tool tabs */}
          <div style={toolRail}>
            {drawableTools.map((t) => {
              const active =
                (t.k === "draw" && tool === "draw") ||
                (t.k === "select" && tool === "select") ||
                (t.k === "eraser" && tool === "eraser");
              return (
                <div
                  key={t.label}
                  onClick={() => {
                    if (!t.enabled) {
                      const msg =
                        t.k === "draw" ? "드로잉은 사인펜 아이템이 필요해요."
                        : t.k === "photo" ? "폴라로이드는 사진기 아이템이 필요해요."
                        : "";
                      if (msg) setBanner(msg);
                      return;
                    }
                    if (t.k === "photo") { if (requireLogin()) fileRef.current?.click(); }
                    else if (t.k === "draw") {
                      if (!requireLogin()) return;
                      setTool((x) => (x === "draw" ? "select" : "draw"));
                      setPlacing(false); setSel(null);
                    } else if (t.k === "eraser") {
                      if (!requireLogin()) return;
                      setTool((x) => (x === "eraser" ? "select" : "eraser"));
                      setPlacing(false); setSel(null);
                    } else {
                      setTool("select"); setPlacing(false);
                    }
                  }}
                  style={chip(active, t.enabled)}
                >
                  {t.label}{!t.enabled ? " 🔒" : ""}
                </div>
              );
            })}
            <input type="file" accept="image/*" ref={fileRef} onChange={onPhotoFile} style={{ display: "none" }} />

            {/* 펜 팔레트 (DRAW 모드에서만 노출) */}
            {tool === "draw" && caps.pens.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, border: `2px solid ${S.line}`, background: S.chrome }}>
                <div style={railLabel}>PEN</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {caps.pens.map((p) => {
                    const picked = pickedPen?.inventoryId === p.inventoryId;
                    return (
                      <div
                        key={p.inventoryId}
                        onClick={() => setPickedPen(p)}
                        title={p.name}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          cursor: "pointer", padding: "3px 7px", borderRadius: 6,
                          border: `2px solid ${picked ? S.accent : "#c3d3ee"}`,
                          background: picked ? "#e4edff" : "#fff",
                        }}
                      >
                        {/* 색 스와치 */}
                        <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.color, display: "block", border: "1px solid rgba(0,0,0,.15)" }} />
                        <span style={{ fontFamily: mono, fontSize: 10, color: S.chromeInk }}>
                          {p.name}
                          {p.durability != null && (
                            <span style={{ opacity: 0.6 }}> · {p.durability}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 스티커 팔레트 */}
            <div style={{ marginTop: 10, padding: 10, border: `2px solid ${S.line}`, background: S.chrome }}>
              <div style={railLabel}>STICKER{!caps.canSticker ? " 🔒" : ""}</div>
              {caps.canSticker ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {caps.stickers.map((s, i) => (
                    <div
                      key={s.itemRef + i}
                      onClick={() => pickSticker(s)}
                      title={s.name}
                      style={{
                        fontSize: 24, cursor: "pointer", lineHeight: 1,
                        padding: 4, borderRadius: 6,
                        background: pickedSticker?.itemRef === s.itemRef && tool === "sticker" ? S.accent : "transparent",
                      }}
                    >
                      {s.emoji}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontFamily: mono, fontSize: 10, color: S.chromeInk, opacity: 0.6, marginTop: 6 }}>
                  스티커 아이템 필요
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, padding: 10, border: `2px solid ${S.line}`, background: S.chrome }}>
              <div style={railLabel}>ITEMS</div>
              <div style={{ fontFamily: "'Anton',sans-serif", fontSize: 30, lineHeight: 1, color: S.accent }}>
                {items.length}
              </div>
            </div>
          </div>

          {/* bottom compose panel */}
          <div style={composeWrap}>
            <div style={composeTag}>COMPOSE</div>

            <div style={{ display: "flex", gap: 12 }}>
              <textarea
                className="brd-ta"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={isLoggedIn ? "메모를 입력하고 → 배치 ▶를 누른 뒤 보드를 클릭하세요" : "로그인 후 이용할 수 있어요"}
                disabled={!isLoggedIn}
                style={composeTa}
              />
              <div onClick={startPlace} style={placeBtn}>
                <span style={{ fontSize: 20 }}>배치 ▶</span>
                <span style={{ fontSize: 10, opacity: 0.85 }}>PLACE ON BOARD</span>
              </div>
            </div>

            {selItem ? (
              <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 14 }}>
                <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, letterSpacing: 2, color: S.chromeInk }}>
                  {selEditable ? "SELECTED ›" : "열람 전용 ›"}
                </div>
                {selEditable && selItem.kind !== "drawing" ? (
                  <>
                    <label style={ctrlLabel}>
                      기울기
                      <input type="range" className="brd-range" min={-45} max={45} step={1}
                        value={selItem.place.rot}
                        onChange={(e) => updSel((p) => ({ ...p, rot: parseFloat(e.target.value) }))}
                        onPointerUp={commitSel}
                        style={{ width: 130, background: S.line }} />
                      <span style={{ width: 40, color: S.accent }}>{Math.round(selItem.place.rot)}°</span>
                    </label>
                    <label style={ctrlLabel}>
                      크기
                      <input type="range" className="brd-range" min={0.4} max={2.2} step={0.05}
                        value={selItem.place.scale}
                        onChange={(e) => updSel((p) => ({ ...p, scale: parseFloat(e.target.value) }))}
                        onPointerUp={commitSel}
                        style={{ width: 130, background: S.line }} />
                      <span style={{ width: 40, color: S.accent }}>{selItem.place.scale.toFixed(2)}×</span>
                    </label>
                    <div onClick={deleteSel} style={delBtn}>삭제</div>
                  </>
                ) : (
                  <>
                    <span style={{ fontFamily: mono, fontSize: 12, color: S.chromeInk, opacity: 0.7 }}>
                      {selEditable
                        ? "드로잉은 위치·크기 조정은 안 되고 삭제만 가능해요."
                        : "다른 사람이 올린 항목이라 열람만 가능해요."}
                    </span>
                    {selEditable && (
                      <div onClick={deleteSel} style={{ ...delBtn, marginLeft: "auto" }}>삭제</div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div style={composeFootHint}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: S.accent, display: "block" }} />
                요소 클릭 → 조정·삭제 · 드래그로 이동 · 드로잉은 선 위를 클릭하면 선택돼요{isGm ? " (GM은 전체 편집)" : ""}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

/* ── 스타일 ── */

const dimStyle: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 60,
  background: "rgba(12,26,58,.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20,
};

const sheetStyle: CSSProperties = {
  position: "relative",
  width: 1040, maxWidth: "100%", height: 908, maxHeight: "94vh",
  boxSizing: "border-box", padding: 24,
  background: S.pageBg, borderRadius: 18,
  boxShadow: "0 22px 55px rgba(20,40,90,.28)",
  fontFamily: "'Gothic A1',sans-serif",
  overflow: "auto",
};

const closeStyle: CSSProperties = {
  position: "absolute", top: 14, right: 16, zIndex: 30,
  width: 34, height: 34, border: `2px solid ${S.line}`,
  background: S.chrome, color: S.chromeInk,
  fontFamily: mono, fontWeight: 700, fontSize: 15,
  cursor: "pointer", borderRadius: 6,
};

const springWrap: CSSProperties = {
  position: "absolute", zIndex: 20, left: 60, top: 12, width: 800,
  display: "flex", justifyContent: "center", gap: 16,
};
const springStyle: CSSProperties = {
  width: 12, height: 30, boxSizing: "border-box",
  border: "3px solid #aab6cf", borderRadius: 7,
  background: "linear-gradient(180deg,#fbfdff,#c6d0e6)",
};

const headerRow: CSSProperties = {
  position: "absolute", left: 60, top: 26, right: 24,
  display: "flex", alignItems: "center", justifyContent: "space-between",
};

const navBtn: CSSProperties = {
  width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
  background: S.chrome, border: `2px solid ${S.line}`, color: S.chromeInk,
  fontSize: 18, fontWeight: 800, cursor: "pointer", userSelect: "none",
};
const dateBox: CSSProperties = {
  minWidth: 200, textAlign: "center", padding: "6px 16px",
  background: S.chrome, border: `2px solid ${S.line}`, color: S.chromeInk,
  fontFamily: mono, fontWeight: 700, fontSize: 16, letterSpacing: 1,
};
const todayBtn: CSSProperties = {
  padding: "8px 12px", background: S.accent, color: "#fff",
  border: `2px solid ${S.line}`, fontFamily: mono, fontWeight: 700,
  fontSize: 12, letterSpacing: 1, cursor: "pointer",
};

const bannerStyle: CSSProperties = {
  position: "absolute", left: 60, top: 66, width: 800, zIndex: 25,
  background: "#fff3d8", border: "2px solid #e6c675", color: "#7a5b12",
  fontFamily: mono, fontSize: 12, fontWeight: 700, padding: "8px 12px",
  cursor: "pointer",
};

const boardWrap: CSSProperties = {
  position: "absolute", left: 60, top: 100, width: BOARD_W, height: BOARD_VIEW_H,
  border: `3px solid ${S.line}`, background: S.boardBg,
  backgroundImage: S.boardGrid, backgroundSize: "28px 28px",
  overflowX: "hidden", overflowY: "auto",
};
const boardContent: CSSProperties = {
  position: "relative", width: BOARD_W, height: BOARD_H,
};
const boardLayer: CSSProperties = {
  position: "absolute", inset: 0, zIndex: 3, width: BOARD_W, height: BOARD_H,
  touchAction: "none",
};

const textItemStyle: CSSProperties = {
  fontFamily: "'Nanum Pen Script',cursive", fontSize: 34, lineHeight: 1.15,
  color: S.ink, maxWidth: 280, whiteSpace: "pre-wrap", textAlign: "center",
  textShadow: "0 1px 2px rgba(0,0,0,.15)",
};
const photoCaption: CSSProperties = {
  fontFamily: "'Nanum Pen Script',cursive", fontSize: 22, color: "#333",
  textAlign: "center", padding: "6px 4px 0", lineHeight: 1,
};
// 폴라로이드 왼상단 작성자명 (상시)
const photoAuthorTag: CSSProperties = {
  position: "absolute", top: 4, left: 6, zIndex: 2,
  maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  fontFamily: mono, fontSize: 10, fontWeight: 700, color: "#12306e",
  background: "rgba(255,255,255,.82)", padding: "1px 6px", borderRadius: 6,
  pointerEvents: "none",
};
// text/sticker hover 작성자명 툴팁 (아이템 위쪽에 뜸)
const hoverAuthorTag: CSSProperties = {
  position: "absolute", left: "50%", bottom: "100%",
  transform: "translate(-50%, -6px)",
  whiteSpace: "nowrap",
  fontFamily: mono, fontSize: 11, fontWeight: 700, color: "#fff",
  background: "rgba(18,48,110,.92)", padding: "3px 8px", borderRadius: 6,
  pointerEvents: "none", zIndex: 12,
};

const centerGhost: CSSProperties = {
  position: "absolute", inset: 0, zIndex: 0, display: "flex",
  alignItems: "center", justifyContent: "center", color: S.ghost,
  fontFamily: mono, fontSize: 14, letterSpacing: 2, pointerEvents: "none",
};
const placingHint: CSSProperties = {
  position: "absolute", zIndex: 5, left: 0, right: 0, top: 0, padding: 10,
  textAlign: "center", background: S.accent, color: "#fff",
  fontFamily: mono, fontWeight: 700, fontSize: 13, letterSpacing: 1,
  pointerEvents: "none",
};

const toolRail: CSSProperties = {
  position: "absolute", left: 880, top: 100, width: 150,
  display: "flex", flexDirection: "column", gap: 8,
};
const railLabel: CSSProperties = {
  fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: 2, color: S.chromeInk,
};
function chip(active: boolean, enabled: boolean): CSSProperties {
  return {
    padding: "11px 14px 11px 16px", fontFamily: mono, fontWeight: 700,
    fontSize: 14, letterSpacing: 2, cursor: enabled ? "pointer" : "not-allowed",
    border: `2px solid ${S.line}`,
    clipPath: "polygon(0 0,100% 0,88% 100%,0 100%)",
    background: active ? S.accent : S.chrome,
    color: active ? "#fff" : S.chromeInk,
    opacity: enabled ? 1 : 0.55,
  };
}

const composeWrap: CSSProperties = {
  position: "absolute", left: 60, top: 676, width: BOARD_W, height: 160,
  boxSizing: "border-box", border: `3px solid ${S.line}`, background: S.chrome,
  padding: "14px 16px",
};
const composeTag: CSSProperties = {
  position: "absolute", left: -3, top: -30, background: S.accent, color: "#fff",
  fontFamily: mono, fontWeight: 700, fontSize: 12, letterSpacing: 2,
  padding: "5px 18px 5px 14px", clipPath: "polygon(0 0,100% 0,90% 100%,0 100%)",
};
const composeTa: CSSProperties = {
  flex: 1, height: 64, resize: "none", boxSizing: "border-box", padding: "10px 12px",
  border: `2px solid ${S.line}`, background: S.boardBg2, color: S.chromeInk,
  fontFamily: "'Gothic A1',sans-serif", fontSize: 15, outline: "none",
};
const placeBtn: CSSProperties = {
  width: 120, display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "center", gap: 2, background: S.accent, color: "#fff",
  border: `2px solid ${S.line}`, cursor: "pointer", fontFamily: mono,
  fontWeight: 700, letterSpacing: 1, userSelect: "none",
};
const ctrlLabel: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  fontFamily: mono, fontSize: 12, fontWeight: 700, color: S.chromeInk,
};
const delBtn: CSSProperties = {
  marginLeft: "auto", padding: "7px 14px", background: "#e5484d", color: "#fff",
  border: `2px solid ${S.line}`, fontFamily: mono, fontWeight: 700, fontSize: 12,
  cursor: "pointer",
};
const composeFootHint: CSSProperties = {
  marginTop: 16, display: "flex", alignItems: "center", gap: 10,
  fontFamily: mono, fontSize: 12, letterSpacing: 1, color: S.chromeInk, opacity: 0.7,
};