"use client";

// components/noticeboard/panels/ImageCropField.tsx
// ═══════════════════════════════════════════════════════════════════
// 이미지 업로드 + 크롭(줌 슬라이더 + 드래그 위치이동) 필드
// ═══════════════════════════════════════════════════════════════════
//
// 용도: MEMBER 프로필 사진. 표시 슬롯(.photo, 150×165, object-fit:cover)과
//       동일한 비율(CROP_W:CROP_H)로 잘라 dataURL(JPEG)을 만든다.
//
// 조작:
//   · 파일 선택 → 미리보기 프레임에 이미지가 cover 로 들어감.
//   · 줌 슬라이더(1.0~3.0배)로 확대.
//   · 프레임 위에서 드래그해 보이는 부분(위치) 이동.
//   · "적용" 시 프레임에 보이는 영역만 캔버스로 렌더 → dataURL.
//
// 안정성/용량:
//   · 출력 캔버스 긴 변 OUT_MAX_PX 로 제한, JPEG 품질 압축.
//   · 결과가 MAX_BYTES 초과면 onError 로 알리고 값 미반영.
//   · (AvatarSetPanel 의 압축 관례를 따름: 512px / 0.82 / ~0.7MB)
//
// 반환: onChange(dataUrl) — 적용 시. onChange(null) — 사진 제거 시.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/* 크롭 비율: 표시 슬롯 150×165 와 동일. */
const CROP_W = 150;
const CROP_H = 165;

/* 미리보기 프레임 화면 표시 크기(비율 유지, 슬롯보다 크게 보여 조작 쉽게). */
const FRAME_W = 210;
const FRAME_H = 231; // 210 * 165/150

/* 출력/압축 관례(AvatarSetPanel 과 동일 계열). */
const OUT_MAX_PX = 512;         // 출력 긴 변 상한
const JPEG_QUALITY = 0.82;
const MAX_BYTES = 700_000;      // ~0.7MB

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;

type Props = {
  /** 현재 값(dataURL 또는 http URL). 편집 시작 시 미리보기로 보여줄 수 있음. */
  value?: string | null;
  /** 적용/제거 시 호출. dataURL 또는 null. */
  onChange: (dataUrl: string | null) => void;
  /** 처리 실패/용량초과 안내용. */
  onError?: (message: string) => void;
};

type Loaded = {
  img: HTMLImageElement;
  natW: number;
  natH: number;
};

export default function ImageCropField({ value, onChange, onError }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [zoom, setZoom] = useState(1);
  // 오프셋: 프레임 좌상단 기준, 이미지가 이동한 px(화면좌표계, 프레임 스케일 기준).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // 언마운트 시 objectURL 정리.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  /* ── 이미지가 프레임을 cover 하도록 하는 기본 배율(1배 기준 표시 크기) ── */
  // 프레임을 꽉 채우는 최소 배율. 이 위에 zoom 을 곱해 실제 표시 크기 결정.
  const coverScale = loaded
    ? Math.max(FRAME_W / loaded.natW, FRAME_H / loaded.natH)
    : 1;

  const dispW = loaded ? loaded.natW * coverScale * zoom : 0;
  const dispH = loaded ? loaded.natH * coverScale * zoom : 0;

  /* 오프셋을 프레임 밖으로 새지 않게 제한(항상 프레임을 덮도록). */
  const clampOffset = useCallback(
    (x: number, y: number, w: number, h: number) => {
      // 이미지가 프레임보다 크므로, 오프셋 범위는 [프레임-이미지, 0].
      const minX = FRAME_W - w;
      const minY = FRAME_H - h;
      return {
        x: Math.min(0, Math.max(minX, x)),
        y: Math.min(0, Math.max(minY, y)),
      };
    },
    []
  );

  // zoom 변경 시 오프셋을 프레임 중심 기준으로 유지 + 재클램프.
  useEffect(() => {
    if (!loaded) return;
    setOffset((prev) => clampOffset(prev.x, prev.y, dispW, dispH));
    // dispW/dispH 는 zoom 파생값이므로 zoom 만 의존성으로.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, loaded]);

  /* ── 파일 선택 ── */
  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        onError?.("이미지 파일을 선택해주십시오.");
        return;
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;

      const img = new Image();
      img.onload = () => {
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;
        if (!natW || !natH) {
          onError?.("이미지를 읽을 수 없습니다.");
          return;
        }
        setLoaded({ img, natW, natH });
        setZoom(1);
        // 초기 오프셋: 이미지를 프레임 중앙에 정렬.
        const cs = Math.max(FRAME_W / natW, FRAME_H / natH);
        const w = natW * cs;
        const h = natH * cs;
        setOffset({ x: (FRAME_W - w) / 2, y: (FRAME_H - h) / 2 });
      };
      img.onerror = () => {
        onError?.("이미지 파일이 아니거나 손상되었습니다.");
      };
      img.src = url;
    },
    [onError]
  );

  /* ── 드래그 위치이동 ── */
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!loaded) return;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: offset.x,
        baseY: offset.y,
      };
    },
    [loaded, offset]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || !loaded) return;
      const nx = d.baseX + (e.clientX - d.startX);
      const ny = d.baseY + (e.clientY - d.startY);
      setOffset(clampOffset(nx, ny, dispW, dispH));
    },
    [loaded, dispW, dispH, clampOffset]
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  /* ── 적용: 프레임에 보이는 영역을 캔버스로 렌더 → dataURL ── */
  const applyCrop = useCallback(() => {
    if (!loaded) return;
    setBusy(true);
    try {
      // 화면(프레임) → 원본 좌표 매핑.
      // 원본 픽셀당 화면 픽셀 = coverScale * zoom.
      const s = coverScale * zoom;
      // 프레임 좌상단(0,0)에 해당하는 원본 좌표:
      const srcX = -offset.x / s;
      const srcY = -offset.y / s;
      const srcW = FRAME_W / s;
      const srcH = FRAME_H / s;

      // 출력 캔버스: CROP 비율(CROP_W:CROP_H) 유지, 폭을 OUT_MAX_PX 로 제한.
      const targetW = Math.round(Math.min(srcW, OUT_MAX_PX));
      const targetH = Math.round(targetW * (CROP_H / CROP_W));

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onError?.("이미지 처리를 초기화하지 못했습니다.");
        setBusy(false);
        return;
      }
      // JPEG 는 알파 미지원 → 흰 배경 평탄화.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(
        loaded.img,
        srcX, srcY, srcW, srcH,   // 원본에서 잘라낼 사각형
        0, 0, targetW, targetH    // 출력 캔버스 전체
      );

      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      if (dataUrl.length > MAX_BYTES) {
        onError?.("이미지 용량이 너무 큽니다. 더 작게 잘라주십시오.");
        setBusy(false);
        return;
      }
      onChange(dataUrl);
    } catch {
      onError?.("이미지 처리 중 오류가 발생하였습니다.");
    } finally {
      setBusy(false);
    }
  }, [loaded, coverScale, zoom, offset, onChange, onError]);

  const clearPhoto = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setLoaded(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    onChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onChange]);

  return (
    <div style={wrapStyle}>
      {/* 미리보기 프레임 */}
      <div
        ref={frameRef}
        style={frameStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {loaded ? (
          <img
            src={loaded.img.src}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left: offset.x,
              top: offset.y,
              width: dispW,
              height: dispH,
              userSelect: "none",
              pointerEvents: "none",
            }}
          />
        ) : value ? (
          // 기존 값 미리보기(편집 진입 시). 조작하려면 새로 업로드.
          <img
            src={value}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={placeholderStyle}>사진 없음</span>
        )}
      </div>

      {/* 컨트롤 */}
      <div style={controlsStyle}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{ fontSize: 12 }}
        />

        {loaded ? (
          <>
            <label style={labelStyle}>
              확대
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                style={{ width: 140 }}
              />
            </label>
            <p style={hintStyle}>프레임을 드래그해 위치를 맞추세요.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={applyCrop}
                disabled={busy}
                style={applyBtnStyle}
              >
                {busy ? "처리 중" : "이 사진 적용"}
              </button>
              <button type="button" onClick={clearPhoto} style={clearBtnStyle}>
                제거
              </button>
            </div>
          </>
        ) : value ? (
          <button type="button" onClick={clearPhoto} style={clearBtnStyle}>
            사진 제거
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ── 스타일(인라인, 디자인은 프론트 리뉴얼 때 정리) ── */
const wrapStyle: React.CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "flex-start",
  flexWrap: "wrap",
};
const frameStyle: React.CSSProperties = {
  position: "relative",
  width: FRAME_W,
  height: FRAME_H,
  border: "5px solid #fff",
  boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
  background: "#d9d9d9",
  overflow: "hidden",
  touchAction: "none",
  cursor: "grab",
  flex: "0 0 auto",
};
const placeholderStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#8a8a8a",
  fontSize: 13,
};
const controlsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 180,
};
const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  color: "#333",
};
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "#777",
};
const applyBtnStyle: React.CSSProperties = {
  padding: "7px 14px",
  border: 0,
  borderRadius: 8,
  background: "#3f88f9",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
};
const clearBtnStyle: React.CSSProperties = {
  padding: "7px 14px",
  border: "1.5px solid rgba(0,0,0,0.15)",
  borderRadius: 8,
  background: "#fff",
  color: "#555",
  fontSize: 13,
  cursor: "pointer",
};
