"use client";

// components/noticeboard/panels/ModalPortal.tsx
// ═══════════════════════════════════════════════════════════════════
// 모달 포털
// ═══════════════════════════════════════════════════════════════════
//
// 왜 필요한가:
//   MEMBER 패널은 조상 DIV 에 transform:scale(약 0.49) 이 걸려 있어,
//   그 안의 position:fixed 요소는 viewport 가 아니라 그 DIV 기준으로
//   갇힌다(stacking context + containing block 이 transform 요소로 바뀜).
//   → 모달이 축소·오프셋되고 z-index 를 아무리 높여도 헤더 버튼(그 DIV
//     바깥 계층)을 못 이긴다.
//
// 해결:
//   children 을 document.body 에 직접 렌더(portal)해서 transform 조상
//   바깥으로 빼낸다. 그러면 fixed 가 진짜 viewport 기준이 되고 z-index 도
//   정상적으로 최상위가 된다.
//
// SSR 안전: mount 이후에만 portal 을 만든다(서버 렌더 시 document 없음).

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
