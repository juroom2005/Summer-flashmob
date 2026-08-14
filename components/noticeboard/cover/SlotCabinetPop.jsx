import React, { useEffect, useRef, useState } from 'react';

/**
 * SlotCabinetPop — 팝/스크린프린트 스타일 슬롯머신 (시안 2A · 화이트/블루)
 *
 * ── 2026-08 서버 연동 리팩터 ──
 *   판정·차감·지급은 전부 서버(spin_slot RPC)가 한다. 이 컴포넌트는 "연출"만.
 *   - 내부 크레딧/랜덤 판정 제거.
 *   - 버튼 클릭 → onSpin() (부모=SlotZone 이 락 판단·서버 호출) → 결과 반환
 *     · { jackpot } 이면 릴을 그 결과에 맞춰 멈춤 (잭팟=3릴 동일, 논잭팟=불일치)
 *     · null 이면 아무 연출 안 함 (락→모달 대기 / 부족 / 처리중)
 *   - CREDIT 자리에는 1회 비용(spinCost)을 표시.
 *
 * 폰트: Bungee / Baloo 2 / Silkscreen (전역 로드 시 동일하게 보임)
 */

const CELL = 84;
const L = 12;

const SYMS = {
  seven:   { glyph: '7',   color: '#e8402c', size: 52, stroke: '3px' },
  heart:   { glyph: '♥',   color: '#e8402c', size: 46, stroke: '3px' },
  star:    { glyph: '★',   color: '#ffe14d', size: 46, stroke: '3px' },
  diamond: { glyph: '◆',   color: '#1868E9', size: 42, stroke: '3px' },
  bar:     { glyph: 'BAR', color: '#fff',    size: 22, stroke: '2px' },
  bell:    { glyph: '♣',   color: '#1868E9', size: 44, stroke: '3px' },
};
const KEYS = Object.keys(SYMS);

const OUTLINE_CSS = `
@keyframes slot-pop{from{transform:translateY(0)}to{transform:translateY(-1008px)}}
@keyframes slot-twinkle{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes slot-ring-glow{0%,100%{opacity:.65;filter:drop-shadow(0 0 2px #ffe14d)}50%{opacity:1;filter:drop-shadow(0 0 7px #ffe14d)}}
@keyframes slot-dome-flash{0%,100%{opacity:.9}50%{opacity:.45}}
`;

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// -webkit-text-stroke helper (React는 카멜케이스)
const outline = (color, stroke) => ({
  color,
  WebkitTextStroke: `${stroke} #111`,
  paintOrder: 'stroke',
});

/**
 * @param {object}   props
 * @param {() => Promise<{jackpot: boolean} | null>} props.onSpin
 *        클릭 시 호출. 부모가 락 판단·서버 호출까지 하고,
 *        돌려도 되면 { jackpot } 반환, 막히면 null.
 * @param {number}   props.spinCost   1회 비용 (CREDIT 자리 표시용)
 * @param {boolean}  props.disabled   모빌 부족 등으로 아예 못 돌릴 때
 * @param {string=}  props.hint       하단 문구를 부모가 제어하고 싶을 때(옵션)
 */
export default function SlotCabinetPop({ onSpin, spinCost = 0, disabled = false, hint }) {
  const reelRefs = [useRef(null), useRef(null), useRef(null)];
  const leverRef = useRef(null);
  const timers = useRef([]);
  const reelKeys = useRef([0, 1, 2].map(() => [...KEYS, ...KEYS]));

  const [spinning, setSpinning] = useState(false);
  const [message, setMessage] = useState('PULL TO WIN');
  const [win, setWin] = useState(false);
  const [jackpot, setJackpot] = useState(false);

  // 전역 keyframes 1회 주입
  useEffect(() => {
    if (document.getElementById('slot-pop-css')) return;
    const el = document.createElement('style');
    el.id = 'slot-pop-css';
    el.textContent = OUTLINE_CSS;
    document.head.appendChild(el);
  }, []);

  // 마운트 후(클라이언트)에만: 릴 심볼 셔플 + 초기 위치 랜덤 (hydration 안전)
  useEffect(() => {
    reelKeys.current = [0, 1, 2].map(() => shuffle([...KEYS, ...KEYS]));
    reelRefs.forEach((r) => {
      if (!r.current) return;
      const top = Math.floor(Math.random() * L);
      r.current.style.transition = 'none';
      r.current.style.transform = `translateY(-${top * CELL}px)`;
    });
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pullLever = () => {
    const el = leverRef.current;
    if (!el) return;
    el.style.transition = 'transform .18s ease-in';
    el.style.transform = 'rotate(26deg)';
    timers.current.push(
      setTimeout(() => {
        el.style.transition = 'transform .45s cubic-bezier(.3,1.4,.5,1)';
        el.style.transform = 'rotate(0deg)';
      }, 200)
    );
  };

  // 서버 결과(jackpot)에 맞춰 각 릴의 목표 정지 인덱스를 계산
  const resolveTargets = (isJackpot) => {
    const reels = reelKeys.current;
    if (isJackpot) {
      // 세 릴 모두 같은 심볼이 창에 오게. (각 릴에 모든 심볼이 최소 1개 존재)
      const sym = KEYS[Math.floor(Math.random() * KEYS.length)];
      return reels.map((keys) => {
        const idx = keys.indexOf(sym);
        return idx >= 0 ? idx : Math.floor(Math.random() * L);
      });
    }
    // 논잭팟: 3개 일치가 안 나올 때까지 다시 뽑기
    for (let attempt = 0; attempt < 20; attempt++) {
      const t = [0, 1, 2].map(() => Math.floor(Math.random() * L));
      const s = t.map((idx, i) => reels[i][idx]);
      if (!(s[0] === s[1] && s[1] === s[2])) return t;
    }
    // 극히 드문 폴백: 마지막 릴만 강제로 다르게
    const t = [0, 1, 2].map(() => Math.floor(Math.random() * L));
    const s0 = reels[0][t[0]];
    if (reels[2][t[2]] === s0) t[2] = (t[2] + 1) % L;
    return t;
  };

  const runReels = (targets, isJackpot) => {
    // 회전 시작
    reelRefs.forEach((r, i) => {
      const el = r.current;
      if (!el) return;
      el.style.transition = 'none';
      el.style.animation = `slot-pop ${0.4 + i * 0.05}s linear infinite`;
    });

    const stopAt = [850, 1200, 1600];
    targets.forEach((T, i) => {
      timers.current.push(
        setTimeout(() => {
          const el = reelRefs[i].current;
          if (!el) return;
          const topIndex = ((T % L) + L) % L;
          el.style.animation = '';
          el.style.transition = 'transform .5s cubic-bezier(.18,.9,.28,1.25)';
          el.style.transform = `translateY(-${topIndex * CELL}px)`;
        }, stopAt[i])
      );
    });

    // 정지 후 결과 세팅
    timers.current.push(
      setTimeout(() => {
        setSpinning(false);
        setWin(true);              // 서버가 돌렸다는 건 유효 스핀 → 링 켜기
        setJackpot(isJackpot);
        setMessage(isJackpot ? 'JACKPOT!' : 'NICE!');
      }, stopAt[2] + 560)
    );
  };

  const handleSpinClick = async () => {
    if (spinning || disabled) return;

    // 부모(SlotZone)에 스핀 요청. 락이면 모달을 부모가 띄우고 null 반환.
    let outcome = null;
    try {
      outcome = await onSpin?.();
    } catch (e) {
      console.warn('[slot] onSpin threw:', e);
      outcome = null;
    }
    if (!outcome) return; // 막힘(락 대기/부족/처리중) — 연출 안 함

    // 유효 스핀 → 연출 시작
    timers.current.forEach(clearTimeout);
    timers.current = [];
    pullLever();
    setSpinning(true);
    setWin(false);
    setJackpot(false);
    setMessage('GOOD LUCK!');

    const targets = resolveTargets(outcome.jackpot);
    runReels(targets, outcome.jackpot);
  };

  const canSpin = !spinning && !disabled;
  const twinkleDur = spinning ? 0.5 : 1.6;
  const cursor = canSpin ? 'pointer' : 'not-allowed';
  const costPad = String(spinCost).padStart(3, '0');
  const stars = Array.from({ length: 9 }, (_, i) => i);
  const shownMessage = hint ?? message;

  const reels = reelKeys.current.map((keys, i) => {
    const strip = keys.concat(keys.slice(0, 1));
    return {
      ref: reelRefs[i],
      cells: strip.map((k) => ({
        glyph: SYMS[k].glyph,
        color: SYMS[k].color,
        size: SYMS[k].size,
        stroke: SYMS[k].stroke,
      })),
    };
  });

  return (
    <div style={{ position: 'relative', width: 400, paddingTop: 24, fontFamily: "'Baloo 2',cursive" }}>
      {/* machine column */}
      <div style={{ position: 'relative', width: 330, margin: '0 auto' }}>
        {/* finial */}
        <div style={{
          position: 'absolute', left: '50%', top: -14, transform: 'translateX(-50%)', zIndex: 5,
          width: 26, height: 22, borderRadius: '50% 50% 40% 40%', background: '#e8402c',
          border: '4px solid #111', boxShadow: '4px 4px 0 rgba(17,17,17,.25)',
        }} />

        {/* dome / marquee */}
        <div style={{
          position: 'relative', zIndex: 2, height: 112, borderRadius: '130px 130px 14px 14px',
          background: '#9fdcec', border: '5px solid #111', boxShadow: '6px 6px 0 #111',
          overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            position: 'absolute', left: '50%', top: '56%', transform: 'translate(-50%,-50%)',
            width: 520, height: 520,
            background: 'repeating-conic-gradient(from 0deg,#1868E9 0 11deg,#bdeaf5 11deg 22deg)',
            opacity: 0.9,
            animation: jackpot ? 'slot-dome-flash 0.35s steps(1) infinite' : 'none',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: '56%', transform: 'translate(-50%,-50%)',
            width: 230, height: 230, borderRadius: '50%',
            background: 'radial-gradient(circle,#eaf7fb 60%,transparent 61%)',
          }} />
          <div style={{ position: 'relative', zIndex: 2, marginTop: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 26, ...outline('#e8402c', '3px') }}>♥</span>
            <div style={{ fontFamily: "'Bungee',cursive", fontSize: 40, lineHeight: 1, ...outline('#e8402c', '4px'), textShadow: '5px 5px 0 rgba(17,17,17,.25)' }}>SLOT</div>
            <span style={{ fontSize: 26, ...outline('#ffe14d', '3px') }}>★</span>
          </div>
        </div>

        {/* body */}
        <div style={{
          position: 'relative', zIndex: 1, marginTop: 8, padding: 16, borderRadius: 20,
          border: '5px solid #111', boxShadow: '6px 6px 0 #111', backgroundColor: '#F9F9FA',
        }}>
          {/* WINS row */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', marginBottom: 12, borderRadius: 12, background: '#9fdcec', border: '4px solid #111',
          }}>
            <div style={{ fontFamily: "'Bungee',cursive", fontSize: 16, ...outline('#e8402c', '2px') }}>777</div>
            <div style={{ fontFamily: "'Bungee',cursive", fontSize: 20, ...outline('#fff', '2.5px') }}>WINS</div>
            <div style={{ fontFamily: "'Bungee',cursive", fontSize: 16, ...outline('#e8402c', '2px') }}>777</div>
          </div>

          {/* star strip */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px', marginBottom: 8 }}>
            {stars.map((i) => (
              <span
                key={i}
                style={{
                  fontSize: 12,
                  ...outline('#1868E9', '1.5px'),
                  animation: `slot-twinkle ${twinkleDur}s ease-in-out ${i * 0.12}s infinite`,
                }}
              >★</span>
            ))}
          </div>

          {/* reels housing */}
          <div style={{ position: 'relative', padding: 12, borderRadius: 14, border: '4px solid #111', backgroundColor: '#9AD1E4' }}>
            <div style={{ position: 'relative', display: 'flex', gap: 8, justifyContent: 'center' }}>
              {reels.map((reel, i) => (
                <div key={i} style={{
                  position: 'relative', width: 82, height: 84, overflow: 'hidden',
                  borderRadius: 8, background: '#fff', border: '4px solid #111',
                }}>
                  <div ref={reel.ref} style={{ position: 'absolute', left: 0, top: 0, width: '100%', willChange: 'transform' }}>
                    {reel.cells.map((c, j) => (
                      <div key={j} style={{
                        height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: c.size, userSelect: 'none', ...outline(c.color, c.stroke),
                      }}>{c.glyph}</div>
                    ))}
                  </div>
                </div>
              ))}
              {/* payline arrows */}
              <div style={{ position: 'absolute', left: -13, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: '12px solid #111' }} />
              <div style={{ position: 'absolute', right: -13, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderRight: '12px solid #111' }} />
              {/* win ring */}
              <div style={{
                position: 'absolute', left: -6, right: -6, top: -2, bottom: -2,
                borderRadius: 10, boxShadow: '0 0 0 3px #ffe14d inset',
                opacity: win ? 1 : 0, pointerEvents: 'none', transition: 'opacity .2s',
                animation: win ? 'slot-ring-glow 0.7s ease-in-out infinite' : 'none',
              }} />
            </div>
          </div>

          {/* star strip */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px', marginTop: 8 }}>
            {stars.map((i) => (
              <span
                key={i}
                style={{
                  fontSize: 12,
                  ...outline('#1868E9', '1.5px'),
                  animation: `slot-twinkle ${twinkleDur}s ease-in-out ${i * 0.12}s infinite`,
                }}
              >★</span>
            ))}
          </div>

          {/* result */}
          <div style={{
            textAlign: 'center', marginTop: 10, fontFamily: "'Silkscreen',monospace", fontSize: 11,
            letterSpacing: 1, height: 14,
            color: win ? '#ffe14d' : '#8a9bb5',
            WebkitTextStroke: win ? '1px #111' : '0 #111', paintOrder: 'stroke',
          }}>{shownMessage}</div>

          {/* bottom plates */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginTop: 10 }}>
            <div onClick={handleSpinClick} style={{ width: 56, borderRadius: 10, border: '4px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor, backgroundColor: '#1868E9', opacity: disabled ? 0.5 : 1 }}>
              <span style={{ fontFamily: "'Bungee',cursive", fontSize: 22, ...outline('#fff', '2.5px') }}>7</span>
            </div>
            <div style={{ flex: 1, borderRadius: 10, background: '#111', border: '4px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px' }}>
              <span style={{ fontFamily: "'Silkscreen',monospace", fontSize: 8, letterSpacing: 2, color: '#5fc6e3' }}>COST</span>
              <span style={{ fontFamily: "'Silkscreen',monospace", fontSize: 22, color: '#ffe14d' }}>{costPad}</span>
            </div>
            <div onClick={handleSpinClick} style={{ width: 56, borderRadius: 10, border: '4px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor, backgroundColor: '#1868E9', opacity: disabled ? 0.5 : 1 }}>
              <span style={{ fontSize: 24, ...outline('#fff', '2.5px') }}>♥</span>
            </div>
          </div>
        </div>

        {/* feet */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 26px', marginTop: -2 }}>
          <div style={{ width: 34, height: 14, border: '4px solid #111', borderTop: 'none', borderRadius: '0 0 8px 8px', backgroundColor: '#1868E9' }} />
          <div style={{ width: 34, height: 14, border: '4px solid #111', borderTop: 'none', borderRadius: '0 0 8px 8px', backgroundColor: '#1868E9' }} />
        </div>
      </div>

      {/* side lever */}
      <div onClick={handleSpinClick} style={{ position: 'absolute', right: 0, top: 150, width: 64, height: 180, cursor, zIndex: 3 }}>
        <div style={{ position: 'absolute', left: 0, top: 60, width: 26, height: 22, borderRadius: 6, background: '#e8402c', border: '4px solid #111' }} />
        <div ref={leverRef} style={{ position: 'absolute', left: 16, bottom: 100, transformOrigin: 'bottom center', willChange: 'transform' }}>
          <div style={{ width: 11, height: 100, margin: '0 auto', borderRadius: 6, background: '#c9c9c9', border: '3px solid #111' }} />
          <div style={{ position: 'absolute', left: '50%', top: -24, transform: 'translateX(-50%)', width: 34, height: 34, borderRadius: '50%', background: 'radial-gradient(circle at 34% 30%,#ff7a5f,#e8402c 70%)', border: '4px solid #111', boxShadow: '4px 4px 0 rgba(17,17,17,.25)' }} />
        </div>
      </div>
    </div>
  );
}