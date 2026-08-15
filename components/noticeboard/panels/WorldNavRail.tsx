// components/noticeboard/panels/WorldNavRail.tsx
// ═══════════════════════════════════════════════════════════════════
// WORLD 탭 내비게이터 (폴더 바깥, 오른쪽 세로 바)
// ═══════════════════════════════════════════════════════════════════
// NoticeNavRail 과 동일 구조. world 섹션(worldSections)을 가리킨다.
// 본문(폴더 안)과 DOM 분리 → 섹션 id 로 직접 스크롤·관찰.
// ═══════════════════════════════════════════════════════════════════

"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from "react";
import styles from "./NoticeNavRail.module.css"; // 내비 스타일 공용
import {
  WORLD_SECTIONS,
  worldSectionDomId,
  type WorldSection,
} from "./worldSections";

type Props = {
  style?: CSSProperties;
};

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export default function WorldNavRail({ style }: Props) {
  const [active, setActive] = useState<string>(WORLD_SECTIONS[0].id);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const goTo = useCallback((id: string) => {
    const el = document.getElementById(worldSectionDomId(id));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  }, []);

  useEffect(() => {
    let raf = 0;
    let tries = 0;

    const setup = () => {
      const first = document.getElementById(
        worldSectionDomId(WORLD_SECTIONS[0].id),
      );
      const scrollParent = findScrollParent(first);
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

      WORLD_SECTIONS.forEach((s: WorldSection) => {
        const el = document.getElementById(worldSectionDomId(s.id));
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
    <nav className={styles.nav} style={style} aria-label="월드 섹션 내비게이터">
      <div className={styles.inner}>
        {WORLD_SECTIONS.map((sec: WorldSection) => (
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
