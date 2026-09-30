/** 경사율(%)별 색 기준점. 내리막 파랑 → 평지 초록 → 오르막 노랑·주황·빨강. 임시값 — 실제 코스로 보며 튜닝한다 */
export const SLOPE_STOPS: [number, string][] = [
  [-8, "#2563eb"],
  [-3, "#38bdf8"],
  [0, "#22c55e"],
  [3, "#eab308"],
  [6, "#f97316"],
  [10, "#dc2626"],
];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 기준점 사이를 RGB 로 섞어 연속적인 색을 만든다 */
export function slopeColor(grade: number): string {
  const first = SLOPE_STOPS[0];
  const last = SLOPE_STOPS[SLOPE_STOPS.length - 1];
  if (grade <= first[0]) return first[1];
  if (grade >= last[0]) return last[1];
  const i = SLOPE_STOPS.findIndex(([g]) => g > grade);
  const [g0, c0] = SLOPE_STOPS[i - 1];
  const [g1, c1] = SLOPE_STOPS[i];
  const t = (grade - g0) / (g1 - g0);
  const a = rgb(c0);
  const b = rgb(c1);
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** 범례 막대용 CSS linear-gradient */
export const SLOPE_GRADIENT = `linear-gradient(90deg, ${SLOPE_STOPS.map(([g, c]) => `${c} ${(((g - SLOPE_STOPS[0][0]) / (SLOPE_STOPS[SLOPE_STOPS.length - 1][0] - SLOPE_STOPS[0][0])) * 100).toFixed(0)}%`).join(", ")})`;
