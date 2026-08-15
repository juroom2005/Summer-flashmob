// components/gm/users/AvatarSetPanel.tsx
//
// 학생증 두상(avatar) 이미지 설정 패널.
//
// 정책:
//   · 두상 이미지는 유저 본인이 못 넣고 GM 이 여기서 넣어준다.
//   · GM 이 로컬 파일을 첨부 → 브라우저에서 리사이즈·압축 → dataURL 로 변환 →
//     gm_set_user_avatar RPC 로 대상 유저 profiles.avatar_url 에 저장.
//   · 삭제(placeholder 복귀)도 여기서. RPC 에 null 을 넘긴다.
//
// 저장 방식(dataURL) 선택 이유:
//   · 프로젝트에 Supabase Storage 셋업이 없고, 기존 서명(signature_data)이
//     dataURL 을 text 컬럼에 직접 저장하는 검증된 패턴을 쓴다. 동일 패턴 채택.
//
// 용량 방어(중요):
//   · dataURL 은 원본보다 커지고 DB row 에 직접 들어가므로, 큰 이미지를 그대로
//     저장하면 프로필 조회가 무거워진다. → 업로드 시 캔버스로 리사이즈(최대
//     AVATAR_MAX_PX)하고 JPEG 품질로 압축해 용량을 억제한다.
//   · 압축 후에도 과대하면(AVATAR_MAX_BYTES 초과) 저장을 막고 안내한다.
//
// 안정성:
//   · 저장은 항상 RPC 반환을 확인하고 성공 시에만 미리보기를 확정 반영.
//   · 실패해도 이전 상태를 깨지 않는다(에러 배너만 표시).

"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import { getGmUserAvatar, setGmUserAvatar } from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** 리사이즈 최대 변(px). 학생증 두상 슬롯이 112×135라 512면 충분. */
const AVATAR_MAX_PX = 512;
/** JPEG 압축 품질(0~1). */
const AVATAR_JPEG_QUALITY = 0.82;
/** 압축 후 허용 최대 바이트(대략). dataURL 문자열 길이 기준 근사. */
const AVATAR_MAX_BYTES = 700_000; // ~0.7MB
/** 허용 입력 파일 타입. */
const ACCEPT = "image/png,image/jpeg,image/webp";

type Props = {
  profileId:   string;
  displayName: string;
};

/**
 * 파일 → 리사이즈/압축된 JPEG dataURL 로 변환.
 * 실패 시 reject.
 */
function fileToResizedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      const { width, height } = img;
      if (!width || !height) {
        reject(new Error("이미지를 읽을 수 없습니다."));
        return;
      }

      // 긴 변을 AVATAR_MAX_PX 로 맞추는 축소 비율(확대는 안 함).
      const scale = Math.min(1, AVATAR_MAX_PX / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("이미지 처리를 초기화하지 못했습니다."));
        return;
      }
      // 투명 PNG 대비 흰 배경으로 평탄화(JPEG 는 알파 미지원).
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", AVATAR_JPEG_QUALITY);
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 파일이 아니거나 손상되었습니다."));
    };

    img.src = url;
  });
}

export default function AvatarSetPanel({ profileId, displayName }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 저장 확정된 현재 두상(미리보기). null = 미설정.
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); // 초기 조회 중
  const [pending, setPending] = useState(false); // 저장/삭제 중
  const [error,   setError]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<string | null>(null);

  // 대상 유저가 바뀌면 현재 두상을 다시 불러온다.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setCurrent(null);

    getGmUserAvatar(profileId)
      .then((url) => {
        if (alive) setCurrent(url);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [profileId]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일 재선택도 트리거되도록 input 값 리셋.
    if (fileRef.current) fileRef.current.value = "";
    if (!file || pending) return;

    setError(null);
    setNotice(null);
    setPending(true);

    try {
      const dataUrl = await fileToResizedDataUrl(file);

      if (dataUrl.length > AVATAR_MAX_BYTES) {
        setError(
          "압축 후에도 용량이 큽니다. 더 작거나 단순한 이미지를 사용해주십시오."
        );
        setPending(false);
        return;
      }

      const res = await setGmUserAvatar(profileId, dataUrl);
      if (res.ok) {
        setCurrent(dataUrl);
        setNotice("두상 이미지를 저장했습니다.");
      } else {
        setError(res.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 처리에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function handleRemove() {
    if (pending || current === null) return;
    setError(null);
    setNotice(null);
    setPending(true);

    const res = await setGmUserAvatar(profileId, null);
    if (res.ok) {
      setCurrent(null);
      setNotice("두상 이미지를 삭제했습니다.");
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  return (
    <div style={wrapStyle}>
      <div style={headerRowStyle}>
        <span style={sectionTitleStyle}>🪪 학생증 두상</span>
        <span style={hintStyle}>{displayName}</span>
      </div>

      <div style={bodyRowStyle}>
        {/* 미리보기 (학생증 두상 슬롯과 동일 비율 112×135) */}
        <div style={previewBoxStyle}>
          {loading ? (
            <span style={previewTextStyle}>불러오는 중…</span>
          ) : current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt="두상 미리보기" style={previewImgStyle} />
          ) : (
            <span style={previewTextStyle}>
              두상
              <br />
              없음
            </span>
          )}
        </div>

        {/* 조작부 */}
        <div style={controlColStyle}>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={handleFile}
            disabled={pending || loading}
            style={{ display: "none" }}
          />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending || loading}
            style={{
              ...uploadButtonStyle,
              opacity: pending || loading ? 0.5 : 1,
              cursor:  pending || loading ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "처리 중…" : current ? "이미지 교체" : "이미지 첨부"}
          </button>

          <button
            type="button"
            onClick={handleRemove}
            disabled={pending || loading || current === null}
            style={{
              ...removeButtonStyle,
              opacity: pending || loading || current === null ? 0.4 : 1,
              cursor:
                pending || loading || current === null
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            삭제
          </button>

          <div style={noteStyle}>
            PNG·JPG·WebP. 첨부하면 자동으로 축소·압축되어 저장됩니다.
          </div>
        </div>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}
      {notice ? <div style={noticeStyle}>{notice}</div> : null}
    </div>
  );
}

/* ── 스타일 ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           8,
  padding:       12,
  background:    "#f6fbff",
  border:        "1.5px solid #d3e8f5",
  borderRadius:  10,
};

const headerRowStyle: CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  gap:            8,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize:   13,
  color:      "#0d6fa8",
};

const hintStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#6f90a6",
  overflow:      "hidden",
  textOverflow:  "ellipsis",
  whiteSpace:    "nowrap",
  maxWidth:      160,
};

const bodyRowStyle: CSSProperties = {
  display:    "flex",
  gap:        12,
  alignItems: "stretch",
};

const previewBoxStyle: CSSProperties = {
  width:          92,
  height:         111, // 112:135 비율 근사
  flexShrink:     0,
  background:     "#fff",
  border:         "2px solid #fff",
  boxShadow:      "0 2px 6px rgba(20,58,99,.18)",
  borderRadius:   8,
  overflow:       "hidden",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
};

const previewImgStyle: CSSProperties = {
  width:      "100%",
  height:     "100%",
  objectFit:  "cover",
  borderRadius: 6,
};

const previewTextStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   12,
  color:      "#a4b6cc",
  textAlign:  "center",
  lineHeight: 1.3,
};

const controlColStyle: CSSProperties = {
  flex:          1,
  minWidth:      0,
  display:       "flex",
  flexDirection: "column",
  gap:           6,
  justifyContent: "center",
};

const uploadButtonStyle: CSSProperties = {
  height:       32,
  border:       0,
  borderRadius: 8,
  background:   "#2ea3dd",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     12.5,
};

const removeButtonStyle: CSSProperties = {
  height:       28,
  border:       "1.5px solid #e2b4b4",
  borderRadius: 8,
  background:   "#fff",
  color:        "#c2410c",
  fontFamily:   JUA,
  fontSize:     11.5,
};

const noteStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#89a2b4",
  lineHeight: 1.4,
};

const errorStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#c2410c",
};

const noticeStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#0d6fa8",
};
