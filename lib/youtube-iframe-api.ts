// lib/youtube-iframe-api.ts
// ═══════════════════════════════════════════════════════════════════
// YouTube IFrame Player API 로더
// ═══════════════════════════════════════════════════════════════════
//
// 왜 별도 파일인가:
//   · API 스크립트(https://www.youtube.com/iframe_api)는 페이지에 딱 한 번만
//     로드돼야 한다. 여러 컴포넌트가 각자 로드하면 window.onYouTubeIframeAPIReady
//     콜백이 서로 덮어써 깨진다.
//   · 이 로더는 최초 1회만 <script> 를 삽입하고, 이후 호출은 같은 Promise 를
//     공유한다. 이미 준비됐으면 즉시 resolve.
//
// 안정성:
//   · SSR 안전(window 없으면 즉시 reject 대신 pending → 브라우저에서만 호출).
//   · YT 준비 여부를 window.YT?.Player 로 확인.
//   · 콜백 체이닝: 기존 onYouTubeIframeAPIReady 가 있으면 함께 호출.

type YT = typeof window & {
  YT?: {
    Player: new (el: HTMLElement | string, opts: unknown) => unknown;
    PlayerState?: Record<string, number>;
  };
  onYouTubeIframeAPIReady?: () => void;
};

let apiPromise: Promise<void> | null = null;

/** YouTube IFrame API 가 준비되면 resolve. 여러 번 호출해도 안전(1회 로드). */
export function loadYouTubeIframeAPI(): Promise<void> {
  if (typeof window === "undefined") {
    // SSR: 브라우저에서 다시 호출될 때까지 무한 pending(호출부가 useEffect 안에서만 부르므로 실제 영향 없음)
    return new Promise<void>(() => {});
  }

  const w = window as YT;

  // 이미 준비됨
  if (w.YT && w.YT.Player) return Promise.resolve();

  // 로드 진행 중이면 같은 Promise 공유
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve) => {
    // 기존 콜백 보존(다른 곳에서 걸어뒀을 수 있음)
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") {
        try {
          prev();
        } catch {
          /* 기존 콜백 오류는 무시(우리 로더 진행 보장) */
        }
      }
      resolve();
    };

    // 스크립트가 이미 삽입돼 있으면 중복 삽입 안 함
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    if (!existing) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      document.head.appendChild(tag);
    }
  });

  return apiPromise;
}
