// app/privacy/page.tsx
//
// 개인정보 처리 안내 (정적 페이지).

export const metadata = {
  title: "개인정보 처리 안내 — flashmob",
};

export default function PrivacyPage() {
  return (
    <div style={pageStyle}>
      <main style={panelStyle}>
        <div style={tagStyle}>// PRIVACY</div>
        <h1 style={titleStyle}>개인정보 처리 안내</h1>

        <p style={pStyle}>
          본 사이트는 초대코드를 통해서만 가입할 수 있는 비영리 폐쇄형
          커뮤니티입니다. 운영에 필요한 최소한의 정보만 수집하며, 수집한
          정보를 커뮤니티 운영 외의 목적으로 사용하거나 제3자에게 제공하지
          않습니다.
        </p>

        <h2 style={h2Style}>수집하는 정보</h2>
        <p style={pStyle}>
          가입 시 이메일 주소와 비밀번호를 수집합니다. 비밀번호는 암호화(해시)된
          형태로만 저장되며 운영자를 포함해 누구도 원문을 볼 수 없습니다. 가입
          시 사용한 초대코드 기록, 그리고 서비스 이용 과정에서 만들어지는 활동
          기록(게시글, 채팅, 아이템·활동 데이터 등)이 함께 저장됩니다.
        </p>

        <h2 style={h2Style}>저장 위치</h2>
        <p style={pStyle}>
          회원 정보와 활동 기록은 클라우드 데이터베이스 서비스(Supabase)에
          저장됩니다. 
        </p>

        <h2 style={h2Style}>로그인 유지</h2>
        <p style={pStyle}>
          로그인 상태 유지를 위해 세션 토큰이 사용 중인 브라우저에 저장됩니다.
          별도의 광고·추적용 쿠키는 사용하지 않습니다.
        </p>

        <h2 style={h2Style}>보관 기간과 삭제</h2>
        <p style={pStyle}>
          수집한 정보는 계정이 유지되는 동안 보관되며, 계정 삭제(탈퇴) 시
          파기됩니다. 계정 삭제, 본인 정보의 열람·정정은 운영자(GM)에게
          커뮤니티 내 채널로 요청하면 처리됩니다.
        </p>

        <h2 style={h2Style}>비밀번호 재설정</h2>
        <p style={pStyle}>
          비밀번호를 잊은 경우 운영자가 임시 비밀번호를 발급합니다. 임시
          비밀번호는 서버에 별도 저장되지 않으며, 로그인 직후 반드시 새
          비밀번호로 변경하도록 안내됩니다.
        </p>

        <p style={dateStyle}>시행일: 2026-08-22</p>

        <div style={footerStyle}>
          <a href="/" style={linkStyle}>홈으로 돌아가기</a>
        </div>

        <div style={builtWithStyle}>Built with Claude</div>
      </main>
    </div>
  );
}

/* ===== 스타일 (login/register 페이지와 동일 톤) ===== */

const pageStyle: React.CSSProperties = {
  minHeight:      "100vh",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  padding:        "24px",
};

const panelStyle: React.CSSProperties = {
  width:        "100%",
  maxWidth:     "560px",
  padding:      "36px 32px",
  background:   "var(--panel-bg)",
  border:       "1px solid var(--panel-border)",
  borderRadius: "8px",
};

const tagStyle: React.CSSProperties = {
  fontFamily:    "var(--mono)",
  fontSize:      "var(--fs-xs)",
  color:         "var(--green)",
  letterSpacing: "0.15em",
  marginBottom:  "12px",
};

const titleStyle: React.CSSProperties = {
  fontFamily:   "var(--display)",
  fontSize:     "var(--fs-xl)",
  fontWeight:   800,
  color:        "var(--text)",
  marginBottom: "20px",
};

const h2Style: React.CSSProperties = {
  fontFamily:    "var(--mono)",
  fontSize:      "var(--fs-sm)",
  color:         "var(--text)",
  letterSpacing: "0.08em",
  marginTop:     "24px",
  marginBottom:  "8px",
};

const pStyle: React.CSSProperties = {
  fontSize:   "var(--fs-sm)",
  color:      "var(--text-mid)",
  lineHeight: 1.7,
  margin:     0,
};

const dateStyle: React.CSSProperties = {
  marginTop:  "28px",
  fontFamily: "var(--mono)",
  fontSize:   "var(--fs-xs)",
  color:      "var(--text-mid)",
};

const footerStyle: React.CSSProperties = {
  marginTop: "24px",
  fontSize:  "var(--fs-sm)",
  textAlign: "center",
};

const linkStyle: React.CSSProperties = {
  color:          "var(--green)",
  textDecoration: "none",
  fontWeight:     600,
};

const builtWithStyle: React.CSSProperties = {
  marginTop:     "16px",
  fontFamily:    "var(--mono)",
  fontSize:      "var(--fs-xs)",
  color:         "var(--text-mid)",
  textAlign:     "center",
  opacity:       0.6,
  letterSpacing: "0.08em",
};