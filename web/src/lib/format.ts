export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 초/km → "6:00" */
export const fmtPace = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** 초 → "40분" / "1시간 5분" */
export function fmtDur(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}

/** a부터 b까지 step 간격 (b 포함) */
export const range = (a: number, b: number, step: number) =>
  Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);
