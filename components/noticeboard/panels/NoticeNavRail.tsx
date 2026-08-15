// components/noticeboard/panels/NoticeNavRail.tsx
// ═══════════════════════════════════════════════════════════════════
// NOTICE 탭 내비게이터 (폴더 바깥, 오른쪽 세로 바)
// ═══════════════════════════════════════════════════════════════════
//
// 본문(NoticeDocPanel)은 폴더 안 스크롤 영역에, 이 내비게이터는
// 폴더 오른쪽 바깥(NoticeBoard 스테이지 좌표)에 렌더된다. 둘은 DOM 이
// 분리돼 있으므로, 이 컴포넌트가 본문 섹션 엘리먼트를 id 로 직접 찾아
// 스크롤·관찰한다.
//
// ── 동작 ─────────────────────────────────────────────────────────
//   · 클릭  : sectionDomId(id) 엘리먼트를 찾아 스크롤 컨테이너 안에서
//             해당 위치로 부드럽게 스크롤.
//   · 활성  : 스크롤 컨테이너에 IntersectionObserver 를 걸어, 상단에
//             가장 가까운 섹션의 점을 활성화.
//
// ── 마운트 타이밍 ────────────────────────────────────────────────
//   notice 탭으로 전환된 직후엔 본문이 아직 안 붙었을 수 있어, 섹션
//   엘리먼트를 못 찾으면 rAF 로 잠깐 재시도한다(최대 몇 프레임).
//
// ── 위치 ─────────────────────────────────────────────────────────
//   NoticeBoard 에서 style prop 으로 절대좌표(top/left)를 받는다.
//   스테이지 스케일 컨테이너 안에 있으므로 스케일이 함께 적용됨.
// ═══════════════════════════════════════════════════════════════════

"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from "react";
import styles from "./NoticeNavRail.module.css";
import { NOTICE_SECTIONS, sectionDomId, type Section } from "./noticeSections";

type Props = {
  /** 스테이지 좌표계 기준 절대 위치 (폴더 오른쪽 바깥) */
  style?: CSSProperties;
};

// 본문 섹션들이 들어있는 스크롤 컨테이너를 찾는다.
// (섹션 엘리먼트에서 위로 올라가며 overflow:auto/scroll 조상 탐색)
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export default function NoticeNavRail({ style }: Props) {
  const [active, setActive] = useState<string>(NOTICE_SECTIONS[0].id);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // 클릭 → 해당 섹션으로 스크롤
  const goTo = useCallback((id: string) => {
    const el = document.getElementById(sectionDomId(id));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  }, []);

  // 스크롤 위치 → 활성 점 (IntersectionObserver)
  useEffect(() => {
    let raf = 0;
    let tries = 0;

    const setup = () => {
      const first = document.getElementById(sectionDomId(NOTICE_SECTIONS[0].id));
      const scrollParent = findScrollParent(first);
      // 본문이 아직 안 붙었으면 잠깐 재시도
      if (!first) {
        if (tries++ < 30) raf = requestAnimationFrame(setup);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort(
              (a, b) =>
                a.boundingClientRect.top - b.boundingClientRect.top,
            );
          if (visible.length > 0) {
            const id = visible[0].target.getAttribute("data-section-id");
            if (id) setActive(id);
          }
        },
        {
          root: scrollParent ?? null,
          rootMargin: "0px 0px -70% 0px",
          threshold: 0,
        },
      );

      NOTICE_SECTIONS.forEach((s: Section) => {
        const el = document.getElementById(sectionDomId(s.id));
        if (el) observer.observe(el);
      });
      observerRef.current = observer;
    };

    setup();

    return () => {
      cancelAnimationFrame(raf);
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  return (
    <nav className={styles.nav} style={style} aria-label="공지 섹션 내비게이터">
      <div className={styles.inner}>
        {NOTICE_SECTIONS.map((sec: Section) => (
          <button
            key={sec.id}
            type="button"
            className={`${styles.item} ${
              active === sec.id ? styles.itemActive : ""
            }`}
            onClick={() => goTo(sec.id)}
            aria-label={sec.navLabel}
          >
            <span className={styles.dot} />
            <span className={styles.label}>{sec.navLabel}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}