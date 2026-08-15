// components/noticeboard/widgets/PlayerIcons.tsx
// ═══════════════════════════════════════════════════════════════════
// 플레이어 컨트롤 아이콘 (직접 제작 인라인 SVG)
// ═══════════════════════════════════════════════════════════════════
//
// Font Awesome 등 외부 의존 없이 프로젝트 관례(인라인 SVG)대로 직접 그림.
// 모두 currentColor 사용 → 부모 color 로 색 제어. size(px) 로 크기.
//
// 6종: Play · Pause · Prev · Next · Random · Repeat
// ═══════════════════════════════════════════════════════════════════

type IconProps = {
  size?: number;
  className?: string;
};

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor" as const,
  xmlns: "http://www.w3.org/2000/svg",
});

export function PlayIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7 5.5v13a1 1 0 0 0 1.53.85l10.5-6.5a1 1 0 0 0 0-1.7L8.53 4.65A1 1 0 0 0 7 5.5Z" />
    </svg>
  );
}

export function PauseIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function PrevIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="5" y="5" width="2.5" height="14" rx="1" />
      <path d="M20 5.5v13a1 1 0 0 1-1.55.83l-9-6.5a1 1 0 0 1 0-1.66l9-6.5A1 1 0 0 1 20 5.5Z" />
    </svg>
  );
}

export function NextIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 5.5v13a1 1 0 0 0 1.55.83l9-6.5a1 1 0 0 0 0-1.66l-9-6.5A1 1 0 0 0 4 5.5Z" />
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
    </svg>
  );
}

// 셔플(랜덤): 교차하는 두 화살표 (선 기반)
export function RandomIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      {...base(size)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 7h3.5c1 0 1.8.5 2.4 1.3l4.2 6.4c.6.8 1.4 1.3 2.4 1.3H21" />
      <path d="M4 17h3.5c1 0 1.8-.5 2.4-1.3l1.1-1.7" />
      <path d="M14 8.5l1-1.5H21" />
      <path d="M18.5 4.5 21 7l-2.5 2.5" />
      <path d="M18.5 14.5 21 17l-2.5 2.5" />
    </svg>
  );
}

// 반복: 둥근 화살표 루프
export function RepeatIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      {...base(size)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M17 3.5 20 6.5 17 9.5" />
      <path d="M20 6.5H8.5A4.5 4.5 0 0 0 4 11v.5" />
      <path d="M7 20.5 4 17.5 7 14.5" />
      <path d="M4 17.5h11.5A4.5 4.5 0 0 0 20 13v-.5" />
    </svg>
  );
}
