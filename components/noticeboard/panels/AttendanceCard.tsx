// components/noticeboard/panels/AttendanceCard.tsx
// ═══════════════════════════════════════════════════════════════════
// 출석 커맨드 카드 (한마디 게시판 · 날짜 페이지 네비게이션)
// ═══════════════════════════════════════════════════════════════════
//
// 위치: NoticeBoard > BoardCover > 좌측 하단.
//
// 구조 (2026-08 시안 리뉴얼):
//   [ 오늘 N명 출석 배지 (우상단, 로그인 시) ]
//   [ 한 줄 입력(200자) + !출석 버튼 (가로 배치) ]
//   [ 한마디 리스트 (내부 스크롤만) ]
//   [ 날짜 네비게이션 (알약 · 오늘은 흰 pill) ]
//
// 동작 (기존과 동일):
//   - 마운트 시 오늘 출석 여부 + 오늘 인원수 + 이력 날짜 목록 조회
//   - selectedDate 기본값 : 오늘. 오늘에 이력 없어도 항상 페이지 존재.
//   - 날짜 알약 클릭 → 해당 날짜 페이지로 이동
//   - !출석 성공 → dates 재조회 + selectedDate 를 오늘로 되돌리고 messages 재조회
//   - profile-changed 이벤트 → 출석 여부 + 카운트 재조회
//
// 스티커 시스템은 후속 작업으로 남겨둠.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCurrentUser } from "@/components/shared/useCurrentUser";
import {
  attendToday,
  checkTodayAttended,
  countTodayAttendees,
  listAttendanceDates,
  listAttendanceMessages,
  type AttendanceDate,
  type AttendanceMessage,
} from "@/lib/attendance-helpers";
import BadgeRow from "@/components/shared/BadgeRow";
import { listBadgesForProfiles, type UserBadge } from "@/lib/badge-helpers";

// ────────────────────────────────────────────────────────────────────
// 폰트 상수 (NoticeBoard.tsx 와 일치)
// ────────────────────────────────────────────────────────────────────
const JUA = "'Jua', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";

// ────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────
const MAX_MESSAGE_LEN = 200;
const CARD_HEIGHT = 280;   
const FALLBACK_DISPLAY_NAME = "운영진";

// ────────────────────────────────────────────────────────────────────
// 문구 (문어체 · 완료체)
// ────────────────────────────────────────────────────────────────────
const MSG = {
  placeholderReady:  "오늘의 한마디를 남겨보세요. (선택)",
  placeholderDone:   "오늘 출석은 완료되었습니다.",
  placeholderAnon:   "로그인 후 이용할 수 있습니다.",

  btnAttend:         "!출석",
  btnDone:           "출석 완료",
  btnLoading:        "확인 중",
  btnProcessing:     "처리 중",
  btnLogin:          "로그인 후 출석",

  listEmpty:         "아직 남겨진 한마디가 없습니다.",
  listEmptyPast:     "이 날에는 남겨진 한마디가 없습니다.",
  listLoading:       "불러오는 중",
  listAnon:          "로그인 후 확인할 수 있습니다.",

  toastSuccess:      (n: number) => `출석이 완료되었습니다. 500 모빌이 지급되었습니다. (보유 ${n})`,
  toastAlready:      "오늘은 이미 출석 완료 상태입니다.",
  toastNoProfile:    "프로필을 찾을 수 없습니다. 관리자에게 문의해 주십시오.",
  toastError:        "출석 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주십시오.",
  toastNeedLogin:    "로그인 후 출석이 가능합니다.",
} as const;

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────
type Props = {
  onOpenLogin: () => void;
  onToast: (msg: string) => void;
};

// ────────────────────────────────────────────────────────────────────
// 유틸 : 오늘 KST 날짜 키 ("YYYY-MM-DD")
//   브라우저 로컬 시간대 기준. 프로젝트 대상은 한국이므로 KST 와 일치.
// ────────────────────────────────────────────────────────────────────
function getTodayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ────────────────────────────────────────────────────────────────────
// 유틸 : 시각만 표시 (HH:MM)
// ────────────────────────────────────────────────────────────────────
function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ────────────────────────────────────────────────────────────────────
// 유틸 : 날짜 파싱
// ────────────────────────────────────────────────────────────────────
type DateParts = { y: number; m: number; d: number } | null;

function parseDate(key: string): DateParts {
  const parts = key.split("-").map((s) => Number(s));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { y: parts[0], m: parts[1], d: parts[2] };
}

// ────────────────────────────────────────────────────────────────────
// 유틸 : 네비게이션 알약 라벨 (항상 월/일 표시)
// ────────────────────────────────────────────────────────────────────
function navLabel(key: string, _prevKey?: string | null): string {
  const p = parseDate(key);
  if (!p) return key;
  return `${p.m}/${p.d}`;   // 항상 월/일 표시
}

// ═══════════════════════════════════════════════════════════════════
// 본체
// ═══════════════════════════════════════════════════════════════════
export default function AttendanceCard({ onOpenLogin, onToast }: Props) {
  const { user, loading: userLoading } = useCurrentUser();

  const [message, setMessage] = useState("");
  const [attended, setAttended] = useState<boolean | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [messages, setMessages] = useState<AttendanceMessage[]>([]);
  const [badgeMap, setBadgeMap] = useState<Map<string, UserBadge[]>>(new Map());
  const [availableDates, setAvailableDates] = useState<AttendanceDate[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(getTodayKey);

  const [listLoading, setListLoading] = useState(false);
  const [listInitialized, setListInitialized] = useState(false);

  const [todayCount, setTodayCount] = useState<number | null>(null);

  // 언마운트 이후 setState 방지
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // ── 오늘 출석 여부 조회 ─────────────────────────────────────
  useEffect(() => {
    if (userLoading) return;

    if (!user) {
      setAttended(null);
      return;
    }

    let cancelled = false;
    setCheckingStatus(true);

    checkTodayAttended()
      .then((v: boolean) => {
        if (!cancelled && alive.current) setAttended(v);
      })
      .finally(() => {
        if (!cancelled && alive.current) setCheckingStatus(false);
      });

    return () => { cancelled = true; };
  }, [user, userLoading]);

  // ── 날짜 목록 + 오늘 인원 조회 ────────────────────────────
  const loadDatesAndCount = useCallback(async () => {
    if (!user) {
      setAvailableDates([]);
      setTodayCount(null);
      return;
    }
    const [dates, cnt] = await Promise.all([
      listAttendanceDates(),
      countTodayAttendees(),
    ]);
    if (!alive.current) return;
    setAvailableDates(dates);
    setTodayCount(cnt);
  }, [user]);

  // ── 특정 날짜의 messages 조회 ─────────────────────────────
  const loadMessages = useCallback(async (date: string) => {
    if (!user) {
      setMessages([]);
      setListInitialized(true);
      return;
    }
    setListLoading(true);
    try {
      const rows = await listAttendanceMessages({ date });
      if (alive.current) setMessages(rows);
        } finally {
      if (alive.current) {
        setListLoading(false);
        setListInitialized(true);
      }
    }
  }, [user]);

  useEffect(() => {
    const ids = messages.map((m) => m.profileId).filter(Boolean);
    if (ids.length === 0) {
      setBadgeMap(new Map());
      return;
    }
    let live = true;
    listBadgesForProfiles(ids).then((map) => {
      if (live) setBadgeMap(map);
    });
    return () => {
      live = false;
    };
  }, [messages]);

  // ── 초기 로드 ────────────────────────────────────────────
  useEffect(() => {
    if (userLoading) return;
    void loadDatesAndCount();
  }, [userLoading, loadDatesAndCount]);

  // ── selectedDate 변경 시 리스트 재조회 ────────────────────
  useEffect(() => {
    if (userLoading) return;
    void loadMessages(selectedDate);
  }, [userLoading, selectedDate, loadMessages]);

  // ── profile-changed 이벤트 : 다른 곳 변경 반영 ─────────────
  useEffect(() => {
    if (!user) return;
    const handler = () => {
      checkTodayAttended().then((v: boolean) => {
        if (alive.current) setAttended(v);
      });
      void loadDatesAndCount();
    };
    window.addEventListener("profile-changed", handler);
    return () => window.removeEventListener("profile-changed", handler);
  }, [user, loadDatesAndCount]);

  // ── 클릭 처리 ────────────────────────────────────────────────
  const handleAttendClick = useCallback(async () => {
    if (processing) return;

    if (!user) {
      onToast(MSG.toastNeedLogin);
      onOpenLogin();
      return;
    }

    if (attended === true) {
      onToast(MSG.toastAlready);
      return;
    }

    setProcessing(true);
    try {
      const r = await attendToday(message);

      if (!alive.current) return;

      if (r.ok) {
        setAttended(true);
        setMessage("");
        onToast(MSG.toastSuccess(r.newMobil));
        window.dispatchEvent(new CustomEvent("profile-changed"));
        // 방금 출석 → 오늘 페이지로 되돌리고 재조회
        const todayKey = getTodayKey();
        setSelectedDate(todayKey);
        void loadDatesAndCount();
        void loadMessages(todayKey);
        return;
      }

      switch (r.reason) {
        case "already_attended":
          setAttended(true);
          onToast(MSG.toastAlready);
          break;
        case "not_authenticated":
          onToast(MSG.toastNeedLogin);
          onOpenLogin();
          break;
        case "no_profile":
          onToast(MSG.toastNoProfile);
          break;
        default:
          onToast(MSG.toastError);
          break;
      }
    } catch (e) {
      console.warn("[AttendanceCard] attend failed:", e);
      if (alive.current) onToast(MSG.toastError);
    } finally {
      if (alive.current) setProcessing(false);
    }
  }, [attended, loadDatesAndCount, loadMessages, message, onOpenLogin, onToast, processing, user]);

  // ── 파생값 : 상태 플래그 ─────────────────────────────────────
  const isLoggedIn = !!user && !userLoading;
  const isChecking = checkingStatus || userLoading;
  const isDone     = isLoggedIn && attended === true;
  const isDisabled = isDone || isChecking || processing;

  const btnLabel = processing
    ? MSG.btnProcessing
    : isChecking
      ? MSG.btnLoading
      : !isLoggedIn
        ? MSG.btnLogin
        : isDone
          ? MSG.btnDone
          : MSG.btnAttend;

  const inputPlaceholder = !isLoggedIn
    ? MSG.placeholderAnon
    : isDone
      ? MSG.placeholderDone
      : MSG.placeholderReady;

  const inputDisabled = !isLoggedIn || isDone || processing;
  const remainingChars = MAX_MESSAGE_LEN - message.length;

  // ── 파생값 : 날짜 관련 ──────────────────────────────────────
  const todayKey = getTodayKey();

  // 네비게이션에 표시할 날짜 목록. 이력 있는 날짜 + 오늘 (없어도 포함).
  const navDates = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const d of availableDates) set.add(d.date);
    set.add(todayKey);
    return Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [availableDates, todayKey]);

  const isSelectedPast = selectedDate !== todayKey;

  // ── 렌더 ────────────────────────────────────────────────────
  return (
    <div style={cardStyle}>

      {/* 입력 + 버튼 (가로 배치) */}
      <div style={inputRowStyle}>
        <div style={inputWrapStyle}>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LEN))}
            placeholder={inputPlaceholder}
            maxLength={MAX_MESSAGE_LEN}
            disabled={inputDisabled}
            style={{
              ...inputStyle,
              background: inputDisabled ? "#eef4fb" : "#fff",
              cursor: inputDisabled ? "not-allowed" : "text",
            }}
          />
          {!inputDisabled ? (
            <div
              style={{
                ...counterStyle,
                color: remainingChars <= 20 ? "#c94a4a" : "#b6c4d8",
              }}
            >
              {remainingChars}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleAttendClick}
          disabled={isDisabled}
          style={{
            ...submitBtnStyle,
            background: isDone ? "#c3ccd9" : "#f5c518",
            color:      isDone ? "#7d8ba0" : "#6b4e00",
            boxShadow:  isDone ? "0 3px 0 #a7b2c2" : "0 3px 0 #d9a300",
            cursor: isDisabled ? "not-allowed" : "pointer",
            opacity: isChecking ? 0.75 : 1,
          }}
        >
          <span style={{ transform: "translateY(1px)" }}>{btnLabel}</span>
        </button>
      </div>

      {/* 한마디 리스트 (내부 스크롤만) */}
      <div style={listStyle}>
        {!isLoggedIn ? (
          <EmptyLine text={MSG.listAnon} />
        ) : !listInitialized || listLoading ? (
          <EmptyLine text={MSG.listLoading} />
        ) : messages.length === 0 ? (
          <EmptyLine text={isSelectedPast ? MSG.listEmptyPast : MSG.listEmpty} />
        ) : (
          <ul style={ulStyle}>
            {messages.map((m) => (
              <MessageRow key={m.id} item={m} badges={badgeMap.get(m.profileId) ?? []} />
            ))}
          </ul>
        )}
      </div>

      {/* 날짜 페이지 네비게이션 */}
      {isLoggedIn && navDates.length > 0 ? (
        <DateNav
          dates={navDates}
          selected={selectedDate}
          onSelect={setSelectedDate}
        />
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 날짜 네비게이션 (알약 형태 · 오늘/선택은 흰 pill)
// ═══════════════════════════════════════════════════════════════════
function DateNav({
  dates,
  selected,
  onSelect,
}: {
  dates: string[];
  selected: string;
  onSelect: (d: string) => void;
}) {
  return (
    <div style={navWrapStyle}>
      {dates.map((d, i) => {
        const label = navLabel(d, i > 0 ? dates[i - 1] : null);
        const isSelected = d === selected;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            style={{
              ...navPillStyle,
              background: isSelected ? "#fff" : "transparent",
              color:      isSelected ? "#2f6cf0" : "rgba(255,255,255,0.72)",
              boxShadow:  isSelected ? "0 2px 6px rgba(20,58,99,0.25)" : "none",
              cursor:     isSelected ? "default" : "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 빈 상태 라인
// ═══════════════════════════════════════════════════════════════════
function EmptyLine({ text }: { text: string }) {
  return (
    <div
      style={{
        fontFamily: BODY,
        fontSize: 13,
        color: "#a4b6cc",
        textAlign: "center",
        padding: "18px 0",
      }}
    >
      {text}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 한마디 한 줄 (색 사각 · 이름 · 본문 · 시각)
// ═══════════════════════════════════════════════════════════════════
function MessageRow({ item, badges }: { item: AttendanceMessage; badges: UserBadge[] }) {
  const name = item.displayName ?? FALLBACK_DISPLAY_NAME;
  const time = formatTime(item.createdAt);

  return (
    <li style={rowStyle}>
      <span style={squareStyle} />
      <span style={nameColStyle}>{name}</span>
      {badges.length > 0 && (
        <BadgeRow badges={badges} size={16} gap={2} titlePrefix={`${name} · `} />
      )}
      <span style={msgColStyle}>{item.message}</span>
      <span style={timeColStyle}>{time}</span>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────────
// 스타일 (시안 톤 · 1366×768 기준 px)
// ────────────────────────────────────────────────────────────────────

// ── 카드 (파란 컨테이너) ──
const cardStyle: CSSProperties = {
  height: CARD_HEIGHT,         
  boxSizing: "border-box",      
  display: "flex",
  flexDirection: "column",      
  background: "#3f6fe0",
  borderRadius: 20,
  padding: 14,
  boxShadow: "0 6px 16px rgba(20, 58, 99, 0.18)",
};


// ── 입력 + 버튼 줄 ──
const inputRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 10,
  marginBottom: 10,
};

const inputWrapStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  minWidth: 0,
};

const inputStyle: CSSProperties = {
  width: "100%",
  height: 46,
  boxSizing: "border-box",
  border: "none",
  borderRadius: 11,
  padding: "0 44px 0 14px",   // 우측은 글자수 카운터 여백
  fontFamily: BODY,
  fontSize: 14,
  color: "#1e4b6e",
  outline: "none",
  display: "block",
};

const counterStyle: CSSProperties = {
  position: "absolute",
  right: 12,
  top: "50%",
  transform: "translateY(-50%)",
  fontFamily: BODY,
  fontSize: 12,
  pointerEvents: "none",
};

const submitBtnStyle: CSSProperties = {
  minWidth: 74,
  height: 46,
  padding: "0 18px",
  border: 0,
  borderRadius: 11,
  fontFamily: JUA,
  fontSize: 15,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
  transition: "background 120ms ease, opacity 120ms ease",
};

// ── 한마디 리스트 (내부 스크롤만) ──
const listStyle: CSSProperties = {
  flex: 1,                 
  minHeight: 0,                
  overflowY: "auto",
  background: "#fff",
  borderRadius: 12,
  padding: "6px 12px",
};

const ulStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};

// ── 한마디 한 줄 ──
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "9px 0",
  borderBottom: "1px dashed #e2edf6",
};

const squareStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 2,
  background: "#f062c0",
  flexShrink: 0,
  marginTop: 4,
};

const nameColStyle: CSSProperties = {
  fontFamily: JUA,
  fontSize: 13,
  color: "#16357f",
  width: 96,
  flexShrink: 0,
  lineHeight: 1.35,
  wordBreak: "break-word",
};

const msgColStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize: 12.5,
  color: "#55617a",
  flex: 1,
  minWidth: 0,
  lineHeight: 1.5,
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
};

const timeColStyle: CSSProperties = {
  fontFamily: BODY,
  fontSize: 11,
  color: "#9aa7bd",
  flexShrink: 0,
  marginTop: 1,
  whiteSpace: "nowrap",
};

// ── 날짜 네비게이션 ──
const navWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 5,
  marginTop: 12,
};

const navPillStyle: CSSProperties = {
  minWidth: 30,
  height: 27,
  padding: "0 9px",
  border: 0,
  borderRadius: 999,
  fontFamily: JUA,
  fontSize: 12,
  transition: "background 120ms ease",
};