// components/noticeboard/panels/AttendanceCard.tsx
// ═══════════════════════════════════════════════════════════════════
// 출석 커맨드 카드 (한마디 게시판 · 날짜 페이지 네비게이션)
// ═══════════════════════════════════════════════════════════════════
//
// 위치: NoticeBoard > NoticePanel > 좌측 하단.
//
// 구조:
//   [ 헤더 : 커맨드 안내  ·  오늘 N명 출석 배지 ]
//   [ textarea + !출석 버튼 (가로 배치) ]
//   ─────────────────────
//   [ 리스트 헤더 : 📮 한마디 게시판  ·  선택 날짜 개수 ]
//   [ 스크롤 리스트 (선택된 날짜의 한마디만) ]
//   [ 날짜 네비게이션 (알약 형태 · 오늘은 노란색) ]
//
// 동작:
//   - 마운트 시 오늘 출석 여부 + 오늘 인원수 + 이력 날짜 목록 조회
//   - selectedDate 기본값 : 오늘. 오늘에 이력 없어도 항상 페이지 존재.
//   - 날짜 알약 클릭 → 해당 날짜 페이지로 이동
//   - !출석 성공 → dates 재조회 + selectedDate 를 오늘로 되돌리고 messages 재조회
//   - profile-changed 이벤트 → 출석 여부 + 카운트 재조회
//
// 스티커 시스템은 후속 작업으로 남겨둠.
// ═══════════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ────────────────────────────────────────────────────────────────────
// 폰트 상수 (NoticeBoard.tsx 와 일치)
// ────────────────────────────────────────────────────────────────────
const JUA = "'Jua', sans-serif";
const GAEGU = "'Gaegu', cursive";
const BODY = "'Gowun Dodum', sans-serif";

// ────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────
const MAX_MESSAGE_LEN = 200;
const LIST_MAX_HEIGHT = 180;      // 리스트 스크롤 영역 최대 높이(px)
const FALLBACK_DISPLAY_NAME = "운영진";

// ────────────────────────────────────────────────────────────────────
// 문구 (문어체 · 완료체)
// ────────────────────────────────────────────────────────────────────
const MSG = {
  headerDone:        "오늘 출석은 완료되었습니다. 자정이 지나면 다시 가능합니다.",

  placeholderReady:  "오늘의 한마디를 남겨보세요. (선택)",
  placeholderDone:   "오늘 출석은 완료되었습니다.",
  placeholderAnon:   "로그인 후 이용할 수 있습니다.",

  btnAttend:         "!출석",
  btnDone:           "출석 완료",
  btnLoading:        "확인 중",
  btnProcessing:     "처리 중",
  btnLogin:          "로그인 후 출석",

  listHeader:        "한마디 게시판",
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
// 유틸 : 페이지 라벨 (리스트 헤더 우측에 표시)
//   "오늘 (7/23)" / "어제 (7/22)" / "7/21 (일)"
// ────────────────────────────────────────────────────────────────────
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

function pageLabel(key: string, todayKey: string, yesterdayKey: string): string {
  const p = parseDate(key);
  if (!p) return key;
  if (key === todayKey) return `오늘 (${p.m}/${p.d})`;
  if (key === yesterdayKey) return `어제 (${p.m}/${p.d})`;
  const dt = new Date(p.y, p.m - 1, p.d);
  return `${p.m}/${p.d} (${WEEKDAY_KO[dt.getDay()]})`;
}

// ────────────────────────────────────────────────────────────────────
// 유틸 : 네비게이션 알약 라벨
//   앞 페이지와 월이 같으면 D 만, 다르면 M/D 로 표시.
// ────────────────────────────────────────────────────────────────────
function navLabel(key: string, prevKey: string | null): string {
  const p = parseDate(key);
  if (!p) return key;
  if (!prevKey) return `${p.m}/${p.d}`;
  const prev = parseDate(prevKey);
  if (!prev) return `${p.m}/${p.d}`;
  return p.m !== prev.m ? `${p.m}/${p.d}` : `${p.d}`;
}

// ────────────────────────────────────────────────────────────────────
// 유틸 : 어제 KST 날짜 키
// ────────────────────────────────────────────────────────────────────
function getYesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

  const textareaPlaceholder = !isLoggedIn
    ? MSG.placeholderAnon
    : isDone
      ? MSG.placeholderDone
      : MSG.placeholderReady;

  const textareaDisabled = !isLoggedIn || isDone || processing;
  const remainingChars = MAX_MESSAGE_LEN - message.length;

  // ── 파생값 : 날짜 관련 ──────────────────────────────────────
  const todayKey = getTodayKey();
  const yesterdayKey = getYesterdayKey();

  // 네비게이션에 표시할 날짜 목록. 이력 있는 날짜 + 오늘 (없어도 포함).
  const navDates = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const d of availableDates) set.add(d.date);
    set.add(todayKey);
    return Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [availableDates, todayKey]);

  const selectedLabel = pageLabel(selectedDate, todayKey, yesterdayKey);
  const isSelectedPast = selectedDate !== todayKey;

  // ── 렌더 ────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: "#e8f7ff",
        border: "2px solid #a8dcf5",
        borderRadius: 14,
        padding: "13px 16px",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontFamily: JUA,
            fontSize: 15,
            color: "#0d6fa8",
            lineHeight: 1.5,
            flex: 1,
            minWidth: 0,
          }}
        >
          ⌨️ 출석 커맨드 —{" "}
          {isDone ? (
            <span
              style={{
                fontFamily: GAEGU,
                fontWeight: 700,
                fontSize: 14,
                color: "#6a97b1",
              }}
            >
              {MSG.headerDone}
            </span>
          ) : (
            <code style={{ background: "#fff2a8", padding: "1px 6px", borderRadius: 4 }}>
              !출석
            </code>
          )}
        </div>

        {isLoggedIn && todayCount !== null ? (
          <div
            style={{
              fontFamily: JUA,
              fontSize: 13,
              color: "#0d6fa8",
              background: "#cdeeff",
              borderRadius: 999,
              padding: "3px 10px",
              whiteSpace: "nowrap",
            }}
          >
            오늘 {todayCount}명 출석
          </div>
        ) : null}
      </div>

      {/* textarea + 버튼 (가로 배치) */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LEN))}
            placeholder={textareaPlaceholder}
            maxLength={MAX_MESSAGE_LEN}
            rows={2}
            disabled={textareaDisabled}
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "2px solid #bfe4f7",
              borderRadius: 10,
              padding: "8px 12px",
              fontFamily: BODY,
              fontSize: 14,
              color: "#1e4b6e",
              outline: "none",
              background: textareaDisabled ? "#f5f9fc" : "#fff",
              resize: "none",
              lineHeight: 1.4,
              display: "block",
            }}
          />
          {!textareaDisabled ? (
            <div
              style={{
                position: "absolute",
                right: 10,
                bottom: 6,
                fontFamily: BODY,
                fontSize: 11,
                color: remainingChars <= 20 ? "#c94a4a" : "#8fbdd8",
                pointerEvents: "none",
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
            minWidth: 88,
            padding: "0 18px",
            border: 0,
            borderRadius: 10,
            background: isDone ? "#8fbdd8" : "#1a9edb",
            color: "#fff",
            fontFamily: JUA,
            fontSize: 15,
            cursor: isDisabled ? "not-allowed" : "pointer",
            boxShadow: isDone ? "0 3px 0 #6a97b1" : "0 3px 0 #0d6fa8",
            opacity: isChecking ? 0.7 : 1,
            transition: "background 120ms ease, opacity 120ms ease",
            alignSelf: "stretch",
          }}
        >
          {btnLabel}
        </button>
      </div>

      {/* ─── 구분선 ─── */}
      <div style={{ borderTop: "1.5px dashed #a8dcf5", marginTop: 8, marginBottom: 6 }} />

      {/* 리스트 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <div style={{ fontFamily: JUA, fontSize: 14, color: "#0d6fa8" }}>
          {MSG.listHeader}
        </div>
        {isLoggedIn ? (
          <div
            style={{
              fontFamily: BODY,
              fontSize: 12,
              color: isSelectedPast ? "#5a8db8" : "#8a7410",
              background: isSelectedPast ? "#e8f4fc" : "#fff2a8",
              borderRadius: 999,
              padding: "2px 10px",
              whiteSpace: "nowrap",
            }}
          >
            {selectedLabel}
            {listInitialized && !listLoading && messages.length > 0
              ? ` · ${messages.length}`
              : null}
          </div>
        ) : null}
      </div>

      {/* 리스트 스크롤 영역 */}
      <div
        style={{
          maxHeight: LIST_MAX_HEIGHT,
          overflowY: "auto",
          background: "#fff",
          border: "1.5px solid #d4ecfa",
          borderRadius: 10,
          padding: "8px 10px",
        }}
      >
        {!isLoggedIn ? (
          <EmptyLine text={MSG.listAnon} />
        ) : !listInitialized || listLoading ? (
          <EmptyLine text={MSG.listLoading} />
        ) : messages.length === 0 ? (
          <EmptyLine text={isSelectedPast ? MSG.listEmptyPast : MSG.listEmpty} />
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {messages.map((m) => (
              <MessageRow key={m.id} item={m} />
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
// 서브 : 날짜 네비게이션 (알약 형태)
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
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 5,
        marginTop: 10,
        paddingTop: 8,
        borderTop: "1px dashed #d4ecfa",
      }}
    >
      {dates.map((d, i) => {
        const label = navLabel(d, i > 0 ? dates[i - 1] : null);
        const isSelected = d === selected;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            style={{
              minWidth: 26,
              height: 26,
              padding: "0 8px",
              border: 0,
              borderRadius: 999,
              background: isSelected ? "#fff2a8" : "#e8f4fc",
              color: isSelected ? "#8a7410" : "#5a8db8",
              fontFamily: JUA,
              fontSize: 12,
              cursor: isSelected ? "default" : "pointer",
              boxShadow: isSelected ? "0 1px 0 #d9c565 inset" : "none",
              transition: "background 120ms ease",
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
        padding: "16px 0",
      }}
    >
      {text}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 서브 : 한마디 한 줄
// ═══════════════════════════════════════════════════════════════════
function MessageRow({ item }: { item: AttendanceMessage }) {
  const name = item.displayName ?? FALLBACK_DISPLAY_NAME;
  const time = formatTime(item.createdAt);

  return (
    <li
      style={{
        borderBottom: "1px dashed #e0f0f9",
        paddingBottom: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 2,
        }}
      >
        <span style={{ fontFamily: JUA, fontSize: 13, color: "#1656b8" }}>
          {name}
        </span>
        <span style={{ fontFamily: BODY, fontSize: 11, color: "#8fbdd8" }}>
          {time}
        </span>
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontSize: 13,
          color: "#1e4b6e",
          lineHeight: 1.45,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {item.message}
      </div>
    </li>
  );
}