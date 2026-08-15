// components/shared/useModalKeys.ts
//
// 팝업/모달 공통 키보드 매핑 훅.
//   · Esc   → onCancel  (닫기·취소)
//   · Enter → onConfirm (기본 동작·확인)
//
// 홈페이지 팝업들이 제각각 구현돼 있어, 이 훅을 붙이면 두세 줄로 일관된
// 키 동작을 얻는다. 신규 팝업은 처음부터 사용하고 기존 팝업은 점진 적용.
//
// 사용 예:
//   useModalKeys({ onConfirm: handleOk, onCancel: onClose });
//
// 동작 규칙:
//   · document 레벨 keydown 을 듣고, 언마운트/비활성 시 정리한다.
//   · enabled=false 면 아무 것도 하지 않는다(조건부 팝업에서 끄기 편하게).
//   · 입력 중(input·textarea·contentEditable 포커스) 에는 Enter 를 가로채지
//     않는다. 텍스트 입력·IME 조합 중 확인이 튀는 오작동을 막기 위함.
//     단 Esc(취소)는 입력 중에도 동작한다(자연스러운 닫기).
//   · IME 한글 조합 중(Enter 로 조합 확정) 에는 confirm 을 발동하지 않는다.
//   · onConfirm/onCancel 이 없으면 해당 키는 무시(다른 핸들러 방해 안 함).

import { useEffect, useRef } from "react";

export type UseModalKeysOptions = {
  onConfirm?: () => void;
  onCancel?: () => void;
  /** false 면 훅이 아무 동작도 하지 않는다. 기본 true. */
  enabled?: boolean;
  /**
   * true 면 입력 필드에 포커스가 있어도 Enter 로 confirm 을 발동한다.
   * 기본 false (입력 중 오발동 방지). 입력이 없는 단순 확인 팝업에서만 true 권장.
   */
  confirmOnEnterInInput?: boolean;
};

function isTextEntryTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useModalKeys(options: UseModalKeysOptions): void {
  const { onConfirm, onCancel, enabled = true, confirmOnEnterInInput = false } = options;

  // 최신 콜백을 ref 로 들고 있어, 리스너를 매번 재등록하지 않는다.
  const confirmRef = useRef<(() => void) | undefined>(onConfirm);
  const cancelRef  = useRef<(() => void) | undefined>(onCancel);
  const inInputRef = useRef<boolean>(confirmOnEnterInInput);

  useEffect(() => { confirmRef.current = onConfirm; }, [onConfirm]);
  useEffect(() => { cancelRef.current  = onCancel;  }, [onCancel]);
  useEffect(() => { inInputRef.current = confirmOnEnterInInput; }, [confirmOnEnterInInput]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    const handler = (e: KeyboardEvent) => {
      // IME 조합 중이면 확정/취소를 가로채지 않는다.
      if (e.isComposing || e.keyCode === 229) return;

      if (e.key === "Escape") {
        const fn = cancelRef.current;
        if (fn) { e.preventDefault(); fn(); }
        return;
      }

      if (e.key === "Enter") {
        const fn = confirmRef.current;
        if (!fn) return;
        // 입력 중이면 기본은 무시 (opt-in 시에만 발동)
        if (!inInputRef.current && isTextEntryTarget(e.target)) return;
        // 조합키(Shift+Enter 등)는 줄바꿈 등 다른 의도일 수 있어 제외
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        fn();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled]);
}

export default useModalKeys;
