// components/gm/users/BotLinkPanel.tsx
//
// 유저 ↔ 마스토돈 계정(봇) 연동 관리 패널.
//
// 방식:
//   · 유저는 이미 선택된 상태(profileId props). GM 은 마스토돈 계정 id(숫자)만 입력.
//     계정 id 는 마스토돈 관리자 패널 /admin/accounts/{숫자} URL 끝 숫자.
//   · acct(@user)는 참고용(선택 입력).
//   · 현재 매핑을 조회해 보여주고, 설정(UPSERT)·해제 가능.
//
// 서버 처리(RPC):
//   · gm_get_bot_link / gm_set_bot_link / gm_delete_bot_link (GM 검사 내장)
//   · 같은 마스토돈 id 가 다른 유저에 연결돼 있으면 거부(mastodon_id_taken).

"use client";

import { useState, useEffect, type CSSProperties, type ChangeEvent } from "react";
import {
  getGmBotLink,
  setGmBotLink,
  deleteGmBotLink,
  type BotLink,
} from "@/lib/gm-bot-link-helpers";

const JUA  = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

type Props = {
  profileId: string;
};

export default function BotLinkPanel({ profileId }: Props) {
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<string | null>(null);

  const [link,   setLink]   = useState<BotLink | null>(null);
  const [midInput,  setMidInput]  = useState("");   // 마스토돈 계정 id (숫자)
  const [acctInput, setAcctInput] = useState("");   // 참고용 acct

  // 최초 로드 + 유저 전환 시 현재 매핑 조회
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    getGmBotLink(profileId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setLink(res.data);
        setMidInput(res.data?.mastodonAccountId ?? "");
        setAcctInput(res.data?.mastodonAcct ?? "");
      } else {
        setError(res.message);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [profileId]);

  async function handleSave() {
    if (pending) return;
    const mid = midInput.replace(/\s/g, "");
    if (mid === "" || !/^[0-9]+$/.test(mid)) {
      setError("마스토돈 계정 ID는 숫자만 입력해주십시오.");
      setNotice(null);
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);

    const res = await setGmBotLink(profileId, mid, acctInput);
    if (res.ok) {
      // 저장 후 최신 상태 재조회
      const fresh = await getGmBotLink(profileId);
      if (fresh.ok) {
        setLink(fresh.data);
        setMidInput(fresh.data?.mastodonAccountId ?? "");
        setAcctInput(fresh.data?.mastodonAcct ?? "");
      }
      setNotice("연동을 저장했습니다.");
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function handleDelete() {
    if (pending || !link) return;
    setPending(true);
    setError(null);
    setNotice(null);

    const res = await deleteGmBotLink(profileId);
    if (res.ok) {
      setLink(null);
      setMidInput("");
      setAcctInput("");
      setNotice("연동을 해제했습니다.");
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  return (
    <div style={wrapStyle}>
      <div style={headerRowStyle}>
        <span style={sectionTitleStyle}>🤖 봇 계정 연동</span>
        <span style={statusStyle}>
          {loading
            ? "확인 중…"
            : link
              ? "연동됨 ✅"
              : "연동 안 됨"}
        </span>
      </div>

      {/* 마스토돈 계정 id */}
      <label style={fieldLabelStyle}>마스토돈 계정 ID (숫자)</label>
      <input
        value={midInput}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          setMidInput(e.target.value.replace(/[^\d]/g, ""))
        }
        placeholder="예: 117116553032013932"
        inputMode="numeric"
        disabled={pending || loading}
        style={inputStyle}
      />

      {/* 참고용 acct */}
      <label style={fieldLabelStyle}>acct (참고용, 선택)</label>
      <input
        value={acctInput}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setAcctInput(e.target.value)}
        placeholder="예: chise_haruyuki"
        maxLength={100}
        disabled={pending || loading}
        style={inputStyle}
      />

      <div style={buttonRowStyle}>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || loading || midInput.trim() === ""}
          style={{
            ...primaryButtonStyle,
            opacity: pending || loading || midInput.trim() === "" ? 0.4 : 1,
            cursor:  pending || loading || midInput.trim() === "" ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "처리 중" : link ? "연동 갱신" : "연동 저장"}
        </button>

        {link ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || loading}
            style={{
              ...dangerButtonStyle,
              opacity: pending || loading ? 0.4 : 1,
              cursor:  pending || loading ? "not-allowed" : "pointer",
            }}
          >
            연동 해제
          </button>
        ) : null}
      </div>

      {error  ? <div style={errorStyle}>{error}</div> : null}
      {notice ? <div style={noticeStyle}>{notice}</div> : null}

      <div style={hintStyle}>
        계정 ID는 마스토돈 관리자 페이지에서 해당 계정을 연 뒤, 주소창
        <br />
        /admin/accounts/<strong>숫자</strong> 의 끝 숫자입니다.
      </div>
    </div>
  );
}

/* ── 스타일 (MobilGrantPanel 톤에 맞춤) ── */

const wrapStyle: CSSProperties = {
  display:       "flex",
  flexDirection: "column",
  gap:           7,
  padding:       12,
  background:    "#fffdf5",
  border:        "1.5px solid #f0e4c0",
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
  color:      "#9a6b00",
};

const statusStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11.5,
  color:      "#7a6a3a",
};

const fieldLabelStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   11,
  color:      "#9a8c6a",
  marginTop:  2,
};

const inputStyle: CSSProperties = {
  height:       30,
  border:       "1.5px solid #ecdcb0",
  borderRadius: 8,
  padding:      "0 10px",
  fontFamily:   BODY,
  fontSize:     12,
  color:        "#4a4030",
  outline:      "none",
  background:   "#fff",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap:     6,
  marginTop: 2,
};

const primaryButtonStyle: CSSProperties = {
  height:       32,
  padding:      "0 16px",
  border:       0,
  borderRadius: 8,
  background:   "#e0a500",
  color:        "#fff",
  fontFamily:   JUA,
  fontSize:     12,
};

const dangerButtonStyle: CSSProperties = {
  height:       32,
  padding:      "0 14px",
  border:       "1.5px solid #f3c9b4",
  borderRadius: 8,
  background:   "#fff",
  color:        "#c2410c",
  fontFamily:   JUA,
  fontSize:     12,
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

const hintStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize:   10.5,
  color:      "#9a8c6a",
  lineHeight: 1.5,
};
