"use client";

// lib/useModalA11y.ts
// ═══════════════════════════════════════════════════════════════════
// 모달 접근성 공통 훅
// ═══════════════════════════════════════════════════════════════════
//
// 하나의 훅으로 모든 모달/팝업/오버레이의 키보드 접근성을 표준화한다.
// 각 모달이 제각기 구현하던 것을 이걸로 통일 → 일관성 + 회귀 위험 최소화.
//
// 제공 기능:
//   1) Esc 키로 닫기        — window keydown 리스너 (열려 있을 때만)
//   2) 포커스 트랩          — Tab / Shift+Tab 이 모달 밖으로 못 나가게 순환
//   3) 열릴 때 초기 포커스   — 모달 안 첫 포커스 대상(또는 컨테이너)에 포커스
//   4) 닫힐 때 포커스 복귀   — 모달 열기 전에 포커스돼 있던 요소로 되돌림
//
// 사용법:
//   const ref = useRef<HTMLDivElement>(null);
//   useModalA11y(ref, { open: isOpen, onClose });
//   ...
//   {isOpen && <div ref={ref} role="dialog" aria-modal="true"> ... </div>}
//
// 주의:
//   - ref 는 모달의 "컨테이너"(포커스를 가둘 범위)에 건다. 배경 오버레이가
//     아니라 실제 내용 박스에 거는 것을 권장.
//   - role="dialog" 와 aria-modal="true" 는 각 모달 JSX 에 직접 붙인다
//     (스크린리더에 모달임을 알림). 이 훅이 대신 붙여주진 않는다.
//   - open 이 false 면 아무 것도 하지 않는다(리스너도 안 건다).

import { useEffect, type RefObject } from "react";

// 포커스 가능한 요소 셀렉터 (비활성/음수 tabindex 제외)
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type Options = {
  /** 모달이 열려 있는지. false 면 훅은 아무 것도 안 함. */
  open: boolean;
  /** Esc 또는 트랩 로직에서 닫기를 요청할 때 호출. */
  onClose?: () => void;
  /** Esc 로 닫기 허용 여부(기본 true). 저장 중 등 닫으면 안 될 때 false. */
  closeOnEsc?: boolean;
  /** 초기 포커스를 컨테이너 자신에게 줄지(기본 false → 안의 첫 포커스 요소). */
  focusContainer?: boolean;
};

export function useModalA11y(
  containerRef: RefObject<HTMLElement | null>,
  { open, onClose, closeOnEsc = true, focusContainer = false }: Options = { open: false },
) {
  // ── Esc 닫기 + Tab 포커스 트랩 ──────────────────────────────
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEsc) {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;

      const items = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null); // 화면에 보이는 것만

      if (items.length === 0) {
        // 포커스 가능한 게 없으면 컨테이너 안에 가둠
        e.preventDefault();
        container.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Shift+Tab 으로 첫 요소에서 뒤로 → 마지막으로 순환
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      }
      // Tab 으로 마지막 요소에서 앞으로 → 첫 요소로 순환
      else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, closeOnEsc, containerRef]);

  // ── 열릴 때 초기 포커스 · 닫힐 때 포커스 복귀 ────────────────
  useEffect(() => {
    if (!open) return;

    // 열기 직전 포커스돼 있던 요소 기억(닫을 때 복귀용)
    const prevFocused = document.activeElement as HTMLElement | null;

    // 다음 프레임에 초기 포커스(모달 DOM 이 그려진 뒤)
    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      if (focusContainer) {
        container.focus();
        return;
      }
      const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE);
      (firstFocusable ?? container).focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      // 닫힐 때: 이전 요소가 아직 문서에 있으면 포커스 복귀
      if (prevFocused && document.contains(prevFocused)) {
        prevFocused.focus();
      }
    };
  }, [open, focusContainer, containerRef]);
}
