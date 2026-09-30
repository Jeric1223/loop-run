import type { Projected } from "@/lib/course/project";
import { MAP_H, MAP_W } from "@/lib/course/project";

const ROADS = (
  <>
    <path d="M0 60 390 92" strokeWidth={10} />
    <path d="M0 152 390 138" strokeWidth={7} />
    <path d="M0 252 390 282" strokeWidth={10} />
    <path d="M0 342 390 330" strokeWidth={7} />
    <path d="M70 0 92 400" strokeWidth={9} />
    <path d="M170 0 158 400" strokeWidth={7} />
    <path d="M262 0 282 400" strokeWidth={10} />
    <path d="M352 0 340 400" strokeWidth={7} />
    <path d="M0 400 390 190" strokeWidth={6} />
  </>
);

/** 데스크톱의 넓은 지도까지 채우려고 도로 한 장을 거울 반사로 타일링한다 (가짜 배경 — 실제 지도 아님) */
export function Roads() {
  return (
    <>
      <defs>
        <pattern id="rt" width="780" height="800" patternUnits="userSpaceOnUse">
          <g className="roads">{ROADS}</g>
          <g className="roads" transform="translate(780 0) scale(-1 1)">{ROADS}</g>
          <g className="roads" transform="translate(0 800) scale(1 -1)">{ROADS}</g>
          <g className="roads" transform="translate(780 800) scale(-1 -1)">{ROADS}</g>
        </pattern>
      </defs>
      <rect x={-2400} y={-2400} width={5200} height={5200} fill="url(#rt)" />
    </>
  );
}

/** 결과 지도: 코스 3개의 경로·핀·출발/도착 표시 */
export function RouteMap({
  proj,
  sel,
  onSelect,
}: {
  proj: Projected;
  sel: number;
  onSelect: (i: number) => void;
}) {
  const [sx, sy] = proj.start;
  return (
    <svg className="map-svg" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <Roads />
      <defs>
        {proj.paths.map((d, i) => (
          <g key={i}>
            <path id={`rp${i}`} d={d} fill="none" />
            <mask id={`mk${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={MAP_W} height={MAP_H}>
              <path className="mk-draw" pathLength={1} d={d} style={{ "--dl": `${i * 0.25}s` } as React.CSSProperties} />
            </mask>
          </g>
        ))}
      </defs>
      {proj.paths.map((_, i) => (
        <g key={i} className={`route r${i}`} data-sel={i === sel} mask={`url(#mk${i})`} onClick={() => onSelect(i)}>
          <use href={`#rp${i}`} className="casing" />
          <use href={`#rp${i}`} className="line" />
          <use href={`#rp${i}`} className="hit" />
        </g>
      ))}
      {proj.end && (
        <g className="end-mk" transform={`translate(${proj.end[0]} ${proj.end[1]})`}>
          <circle className="end-dot" r={8} />
          <g transform="translate(0 -30)">
            <rect x={-20} y={-11} width={40} height={22} rx={11} />
            <text>도착</text>
          </g>
        </g>
      )}
      <g transform={`translate(${sx} ${sy})`}>
        <circle className="ripple" r={12} />
        <circle className="ripple b" r={12} />
        <circle className="start-dot" r={8} />
      </g>
      <g className="start-lbl" transform={`translate(${sx} ${sy - 30})`}>
        <rect x={-20} y={-11} width={40} height={22} rx={11} />
        <text>출발</text>
      </g>
      {proj.pins.map(([x, y], i) => (
        <g key={i} className={`pin r${i}`} data-sel={i === sel} transform={`translate(${x} ${y})`} style={{ cursor: "pointer" }} onClick={() => onSelect(i)}>
          <g className="pin-in">
            <circle r={13} />
            <text>{i + 1}</text>
          </g>
        </g>
      ))}
    </svg>
  );
}
