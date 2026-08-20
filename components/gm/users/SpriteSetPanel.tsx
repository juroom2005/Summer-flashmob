// components/gm/users/SpriteSetPanel.tsx
//
// 리듬게임 캐릭터 스프라이트 설정 패널.
//
// 정책:
//   · 스프라이트 이미지는 유저 본인이 못 넣고 GM 이 여기서 넣어준다.
//   · GM 이 로컬 파일을 첨부 → 브라우저에서 리사이즈 → PNG dataURL 로 변환 →
//     gm_set_user_sprite RPC 로 대상 유저 profiles.sprite_url 에 저장.
//   · 삭제도 여기서. RPC 에 null 을 넘긴다.
//
// 두상(AvatarSetPanel)과의 차이:
//   · 스프라이트는 투명 PNG 라 흰 배경 평탄화를 하지 않는다(알파 보존).
//     → toDataURL("image/png") 로 인코딩(JPEG 아님).
//   · 리듬게임 .sprite 슬롯이 정사각(400×400)이라 미리보기도 정사각.
//
// 저장 방식(dataURL) 선택 이유:
//   · 두상과 동일. 프로젝트에 파일 스토리지 셋업이 없고, dataURL 을 text
//     컬럼에 직접 저장하는 검증된 패턴을 그대로 쓴다.
//
// 용량 방어:
//   · 업로드 시 캔버스로 리사이즈(최대 SPRITE_MAX_PX)해 용량을 억제.
//     PNG 는 JPEG 처럼 품질 압축이 없지만, 통일 규격 400×400 캐릭터는
//     보통 100KB 안팎이라 상한(SPRITE_MAX_BYTES)에 여유가 크다.
//   · 상한 초과면 저장을 막고 안내한다.
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
import { getGmUserSprite, setGmUserSprite } from "@/lib/gm-user-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

/** 리사이즈 최대 변(px). 리듬게임 .sprite 슬롯이 400×400 이라 400 이면 충분. */
const SPRITE_MAX_PX = 400;
/** dataURL 허용 최대 바이트(대략). 통일 규격은 ~100KB 라 넉넉히 잡되 비정상 대용량은 차단. */
const SPRITE_MAX_BYTES = 500_000; // ~0.5MB
/** 허용 입력 파일 타입. 투명 PNG 권장. */
const ACCEPT = "image/png,image/webp,image/jpeg";

type Props = {
  profileId:   string;
  displayName: string;
};

/**
 * 파일 → 리사이즈된 PNG dataURL 로 변환 (투명 보존).
 * 실패 시 reject.
 */
function fileToResizedPngDataUrl(file: File): Promise<string> {
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

      // 긴 변을 SPRITE_MAX_PX 로 맞추는 축소 비율(확대는 안 함).
      const scale = Math.min(1, SPRITE_MAX_PX / Math.max(width, height));
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
      // PNG : 흰 배경 평탄화를 하지 않아 투명 영역이 그대로 보존된다.
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/png");
      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 파일이 아니거나 손상되었습니다."));
    };

    img.src = url;
  });
}

export default function SpriteSetPanel({ profileId, displayName }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 저장 확정된 현재 스프라이트(미리보기). null = 미설정.
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); // 초기 조회 중
  const [pending, setPending] = useState(false); // 저장/삭제 중
  const [error,   setError]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<string | null>(null);

  // 대상 유저가 바뀌면 현재 스프라이트를 다시 불러온다.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setCurrent(null);

    getGmUserSprite(profileId)
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
      const dataUrl = await fileToResizedPngDataUrl(file);

      if (dataUrl.length > SPRITE_MAX_BYTES) {
        setError(
          "용량이 큽니다. 더 작거나 단순한 이미지를 사용해주십시오."
        );
        setPending(false);
        return;
      }

      const res = await setGmUserSprite(profileId, dataUrl);
      if (res.ok) {
        setCurrent(dataUrl);
        setNotice("스프라이트 이미지를 저장했습니다.");
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

    const res = await setGmUserSprite(profileId, null);
    if (res.ok) {
      setCurrent(null);
      setNotice("스프라이트 이미지를 삭제했습니다.");
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  return (
    <div style={wrapStyle}>
      <div style={headerRowStyle}>
        <span style={sectionTitleStyle}>🕺 리듬게임 스프라이트</span>
        <span style={hintStyle}>{displayName}</span>
      </div>

      <div style={bodyRowStyle}>
        {/* 미리보기 (리듬게임 .sprite 슬롯과 동일 정사각 + 투명 체커보드) */}
        <div style={previewBoxStyle}>
          {loading ? (
            <span style={previewTextStyle}>불러오는 중…</span>
          ) : current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt="스프라이트 미리보기" style={previewImgStyle} />
          ) : (
            <span style={previewTextStyle}>
              스프라이트
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
            투명 PNG 권장. 첨부하면 자동으로 축소되어 저장됩니다.
          </div>
        </div>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}
      {notice ? <div style={noticeStyle}>{notice}</div> : null}
    </div>
  );
}

/* ── 스타일 (AvatarSetPanel 과 동일 톤, 미리보기만 정사각+투명 체커) ── */

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
  width:          104,
  height:         104, // 정사각(리듬게임 .sprite 400×400 비율)
  flexShrink:     0,
  // 투명 PNG 인지용 체커보드.
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg,#e2e7f2 25%,transparent 25%,transparent 75%,#e2e7f2 75%)," +
    "linear-gradient(45deg,#e2e7f2 25%,transparent 25%,transparent 75%,#e2e7f2 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 8px 8px",
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
  objectFit:  "contain",
  objectPosition: "center bottom",
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
