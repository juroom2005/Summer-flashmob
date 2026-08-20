"use client";

// components/noticeboard/panels/SpriteUploadField.tsx
// ═══════════════════════════════════════════════════════════════════
// 리듬게임 캐릭터 스프라이트 업로드 필드 (투명 PNG, 크롭 없음)
// ═══════════════════════════════════════════════════════════════════
//
// 용도: MEMBER 프로필의 리듬게임 캐릭터 스프라이트.
//   두상(ImageCropField)과 달리 크롭/줌/드래그가 없다. 통일 규격(400×400
//   투명 PNG)으로 이미 만들어진 에셋을 그대로 받는 것이라, 파일 선택 →
//   투명 유지 리사이즈(긴 변 OUT_MAX_PX) → PNG dataURL 저장이 전부.
//
// 저장 형식: dataURL(image/png). member_profiles.sprite_url(text)에 그대로
//   저장(두상 photo_url 과 같은 방식, 파일 스토리지 없음).
//
// 안정성/용량:
//   · JPEG 와 달리 PNG 는 알파 보존을 위해 흰 배경 평탄화를 하지 않는다.
//   · 결과 dataURL 이 MAX_BYTES 초과면 onError 로 알리고 값 미반영.
//     (통일 규격 400×400 캐릭터는 보통 100KB 안팎이라 상한에 여유가 크다.)
//
// 반환: onChange(dataUrl) — 적용 시. onChange(null) — 제거 시.
//   ImageCropField 와 달리 "적용" 단계가 없다(크롭이 없으므로 파일 선택
//   즉시 인코딩해 onChange 호출).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/* 출력 규격: 통일 스프라이트 400×400. 긴 변 상한만 둔다(이미 규격에 맞으면 그대로). */
const OUT_MAX_PX = 400;
/* PNG dataURL 상한. 통일 규격은 ~100KB 라 넉넉히 잡되, 비정상 대용량은 거른다. */
const MAX_BYTES = 500_000; // ~0.5MB

type Props = {
  /** 현재 값(dataURL 또는 http URL). 미리보기용. */
  value?: string | null;
  /** 적용/제거 시 호출. dataURL 또는 null. */
  onChange: (dataUrl: string | null) => void;
  /** 처리 실패/용량초과 안내용. */
  onError?: (message: string) => void;
};

export default function SpriteUploadField({ value, onChange, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  // 언마운트 시 objectURL 정리.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  /* ── 파일 선택 → 투명 유지 리사이즈 → PNG dataURL ── */
  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        onError?.("이미지 파일을 선택해주십시오.");
        return;
      }
      setBusy(true);

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;

      const img = new Image();
      img.onload = () => {
        try {
          const natW = img.naturalWidth;
          const natH = img.naturalHeight;
          if (!natW || !natH) {
            onError?.("이미지를 읽을 수 없습니다.");
            setBusy(false);
            return;
          }

          // 긴 변을 OUT_MAX_PX 로 제한(비율 유지). 이미 규격 이하면 원본 크기.
          const scale = Math.min(1, OUT_MAX_PX / Math.max(natW, natH));
          const targetW = Math.round(natW * scale);
          const targetH = Math.round(natH * scale);

          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            onError?.("이미지 처리를 초기화하지 못했습니다.");
            setBusy(false);
            return;
          }
          // PNG : 흰 배경 평탄화를 하지 않아 투명 영역이 그대로 보존된다.
          ctx.clearRect(0, 0, targetW, targetH);
          ctx.drawImage(img, 0, 0, targetW, targetH);

          const dataUrl = canvas.toDataURL("image/png");
          if (dataUrl.length > MAX_BYTES) {
            onError?.(
              "이미지 용량이 너무 큽니다. 더 작은 파일을 사용해주십시오."
            );
            setBusy(false);
            return;
          }
          onChange(dataUrl);
        } catch {
          onError?.("이미지 처리 중 오류가 발생하였습니다.");
        } finally {
          setBusy(false);
          // 같은 파일을 다시 골라도 onChange 되도록 input 값 리셋.
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      };
      img.onerror = () => {
        onError?.("이미지 파일이 아니거나 손상되었습니다.");
        setBusy(false);
      };
      img.src = url;
    },
    [onChange, onError]
  );

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const clearSprite = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    onChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onChange]);

  const hasValue = !!value;

  return (
    <div style={colStyle}>
      {/* 미리보기 프레임 (투명 PNG → 체커보드 배경으로 투명 영역 인지) */}
      <div style={frameStyle}>
        {hasValue ? (
          <img
            src={value as string}
            alt=""
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              // 스프라이트는 하단 정렬(리듬게임 .sprite 와 동일 감각).
              objectPosition: "center bottom",
            }}
          />
        ) : (
          <span style={placeholderStyle}>스프라이트 없음</span>
        )}
      </div>

      {/* 숨긴 파일 input + 커스텀 버튼 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/*"
        onChange={(e) => handleFile(e.target.files?.[0])}
        style={{ display: "none" }}
      />

      <button
        type="button"
        onClick={openPicker}
        disabled={busy}
        style={replaceBtnStyle}
      >
        {busy ? "처리 중" : "이미지 교체"}
      </button>

      <button
        type="button"
        onClick={clearSprite}
        disabled={busy || !hasValue}
        style={{ ...clearBtnStyle, opacity: hasValue ? 1 : 0.5 }}
      >
        삭제
      </button>
    </div>
  );
}

/* ── 스타일(인라인, 디자인은 프론트 리뉴얼 때 정리) ──
 *  두상 칸(ImageCropField)과 같은 톤. 세로 정렬: 프레임 → 교체 → 삭제. */
const colStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  alignItems: "center",
};
const frameStyle: React.CSSProperties = {
  position: "relative",
  width: 210,
  height: 210,
  border: "5px solid #fff",
  boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
  // 투명 PNG 인지용 체커보드.
  backgroundColor: "#f4f6fb",
  backgroundImage:
    "linear-gradient(45deg,#e2e7f2 25%,transparent 25%,transparent 75%,#e2e7f2 75%)," +
    "linear-gradient(45deg,#e2e7f2 25%,transparent 25%,transparent 75%,#e2e7f2 75%)",
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0, 10px 10px",
  overflow: "hidden",
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
const replaceBtnStyle: React.CSSProperties = {
  padding: "7px 14px",
  border: 0,
  borderRadius: 8,
  background: "#3f88f9",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
  width: "100%",
};
const clearBtnStyle: React.CSSProperties = {
  padding: "7px 14px",
  border: "1.5px solid rgba(0,0,0,0.15)",
  borderRadius: 8,
  background: "#fff",
  color: "#555",
  fontSize: 13,
  cursor: "pointer",
  width: "100%",
};
