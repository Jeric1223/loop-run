"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { gradeText, locate, segAt, type CourseSlope } from "@/lib/course/slope";
import { levelCss } from "./slopeColor";

const W = 300;
const H = 88;
const PAD_TOP = 8;
const NS = 100; // 차트를 이만큼 잘게 쪼개 칠한다 — 지도 선과 같은 색 흐름
const MIN_RANGE_M = 8; // 거의 평평한 코스가 과장돼 보이지 않게 최소 높이 범위

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 고도 변화 차트. 긁으면(또는 방향키) scrub 이 바뀌고 지도에 위치 점이 따라간다 */
export function ElevChart({ a, scrub, onScrub }: { a: CourseSlope; scrub: number | null; onScrub: (f: number | null) => void }) {
  const box = useRef<HTMLDivElement>(null);

  const at = (f: number) => {
    const { i, t } = locate(a, f);
    return { e: lerp(a.elev[i], a.elev[i + 1], t), lv: lerp(a.lv[i], a.lv[i + 1], t) };
  };
  const lo = Math.min(...a.elev);
  const range = Math.max(MIN_RANGE_M, Math.max(...a.elev) - lo);
  const y = (e: number) => PAD_TOP + (1 - (e - lo) / range) * (H - PAD_TOP - 4);
  const x = (f: number) => f * W;

  const slices = Array.from({ length: NS }, (_, n) => {
    const f0 = n / NS, f1 = (n + 1) / NS;
    return { f0, f1, y0: y(at(f0).e), y1: y(at(f1).e), lv: at((f0 + f1) / 2).lv };
  });
  const ridge = slices.map((s, n) => `${n ? "L" : "M"}${x(s.f0).toFixed(1)} ${s.y0.toFixed(1)}`).join("") + `L${W} ${slices[NS - 1].y1.toFixed(1)}`;

  const seg = scrub != null ? segAt(a, scrub) : null;
  const cur = scrub != null ? at(scrub) : null;

  const fromPointer = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    onScrub(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const now = scrub ?? 0;
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? now + step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? now - step : e.key === "Home" ? 0 : e.key === "End" ? 1 : null;
    if (e.key === "Escape") return onScrub(null);
    if (next == null) return;
    e.preventDefault();
    onScrub(Math.min(1, Math.max(0, next)));
  };

  return (
    <div className="elev">
      <div className="elev-head">
        <h3>고도 변화</h3>
        <span className="elev-read" aria-live="polite">
          {seg && scrub != null ? `${((scrub * a.totalM) / 1000).toFixed(2)}km · ${gradeText(seg)}` : "차트를 눌러 구간별 경사를 확인하세요"}
        </span>
      </div>
      <div
        ref={box}
        className="elev-plot"
        role="slider"
        tabIndex={0}
        aria-label="코스 위치별 경사"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((scrub ?? 0) * 100)}
        aria-valuetext={seg && scrub != null ? `${((scrub * a.totalM) / 1000).toFixed(2)}킬로미터, ${gradeText(seg)}` : undefined}
        onKeyDown={onKey}
        onBlur={() => onScrub(null)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => e.buttons && fromPointer(e)}
        onPointerUp={() => onScrub(null)}
        onPointerCancel={() => onScrub(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {slices.map((s, n) => {
            const mid = (s.f0 + s.f1) / 2;
            const dim = seg && !(mid >= seg.from && mid <= seg.to);
            return <path key={n} className="ar" style={{ fill: levelCss(s.lv), opacity: dim ? 0.3 : 1 }} d={`M${x(s.f0).toFixed(1)} ${s.y0.toFixed(1)}L${x(s.f1).toFixed(1)} ${s.y1.toFixed(1)}V${H}H${x(s.f0).toFixed(1)}Z`} />;
          })}
          <path className="ridge" d={ridge} />
          {cur && scrub != null && <line className="cur" x1={x(scrub)} x2={x(scrub)} y1={0} y2={H} />}
        </svg>
        {cur && scrub != null && <i className="cur-dot" style={{ left: `${scrub * 100}%`, top: `${(y(cur.e) / H) * 100}%` }} />}
      </div>
      <div className="elev-axis" aria-hidden="true">
        <span>출발</span>
        <span>{(a.totalM / 1000).toFixed(1)}km</span>
      </div>
    </div>
  );
}
