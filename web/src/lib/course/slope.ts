import type { SlopeProfile } from "./build";

/* 경사 프로필(점별 경사율 %)에서 화면이 쓰는 값을 뽑는다 — 구간 등급·방향, 높낮이 곡선, 왕복 겹침.
   등급 기준값은 임시 — 실제 코스로 보며 튜닝한다 */

export type SlopeClass = "flat" | "gentle" | "hill";
export type Dir = "up" | "down" | null;
/** from·to 는 코스 전체 거리에 대한 비율(0~1) */
export type Seg = { from: number; to: number; cls: SlopeClass; dir: Dir };

export type CourseSlope = {
  pts: [number, number][];
  /** 점마다 누적 비율 (길이 n) */
  f: number[];
  /** 구간(점 사이) 길이 m (길이 n-1) */
  len: number[];
  /** 점마다 등급 수준 0(평지)~2(언덕), 사이 값은 색이 섞이는 구간 (길이 n) */
  lv: number[];
  /** 구간이 어느 segs 에 속하는지 (길이 n-1) */
  segOf: number[];
  /** 점마다 상대 높이 m (길이 n). 경사율을 누적한 값이라 모양만 본다 */
  elev: number[];
  /** 같은 길을 오가는 구간인가 (길이 n-1) */
  over: boolean[];
  segs: Seg[];
  totalM: number;
  /** 같은 길 왕복 비율 % */
  overlapPct: number;
};

const SMOOTH_M = 50; // 경사율을 앞뒤 이만큼 평균 내 색이 잘게 떨리지 않게 한다 (원본이 이미 3점 이동평균이라 많이 깎지 않는다)
const MIN_SEG_M = 150; // 이보다 짧은 구간은 이웃에 합친다
const OVERLAP_M = 14; // 이 거리 안이면 같은 길로 본다
const OVERLAP_MIN_M = 100; // 겹침이 이보다 짧으면 출발·도착점 근처로 보고 버린다

/** |경사율 %| → 0~2. 1% 까지 평지, 3% 에서 완만(노랑), 6% 이상 언덕(빨강). 러너가 체감하는 기준에 맞춘 임시값 */
const levelOf = (g: number) => (g < 1 ? 0 : g < 3 ? (g - 1) / 2 : g < 6 ? 1 + (g - 3) / 3 : 2);
const classOf = (lv: number): SlopeClass => (lv < 0.5 ? "flat" : lv < 1.5 ? "gentle" : "hill");

export function analyzeSlope(profile: SlopeProfile): CourseSlope | null {
  const { pts, grade } = profile;
  const m = pts.length - 1;
  if (m < 2 || grade.length !== m) return null;

  const cos = Math.cos((pts[0][0] * Math.PI) / 180);
  const xy = pts.map(([lat, lng]) => [lng * cos * 111_320, lat * 110_540] as const);
  const len = Array.from({ length: m }, (_, i) => Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]));
  const dist = [0];
  len.forEach((l) => dist.push(dist[dist.length - 1] + l));
  const total = dist[m] || 1;
  const f = dist.map((d) => d / total);

  // 구간 중심 기준으로 ±SMOOTH_M 안의 경사율을 길이 가중 평균한다
  const mid = len.map((l, i) => dist[i] + l / 2);
  const sg = mid.map((c) => {
    let s = 0, w = 0;
    for (let j = 0; j < m; j++) {
      if (Math.abs(mid[j] - c) <= SMOOTH_M) { s += grade[j] * len[j]; w += len[j]; }
    }
    return w ? s / w : 0;
  });
  const segLv = sg.map((g) => levelOf(Math.abs(g)));

  // 같은 등급·방향이 이어지는 구간을 묶고, MIN_SEG_M 보다 짧으면 앞(없으면 뒤) 구간에 합친다
  type Run = { a: number; b: number; cls: SlopeClass; dir: Dir };
  const dirOf = (i: number, cls: SlopeClass): Dir => (cls === "flat" ? null : sg[i] > 0 ? "up" : "down");
  let runs: Run[] = [];
  for (let i = 0; i < m; i++) {
    const cls = classOf(segLv[i]), dir = dirOf(i, cls), last = runs[runs.length - 1];
    if (last && last.cls === cls && last.dir === dir) last.b = i + 1;
    else runs.push({ a: i, b: i + 1, cls, dir });
  }
  const runM = (r: Run) => dist[r.b] - dist[r.a];
  for (let k = 0; k < runs.length && runs.length > 1; ) {
    if (runM(runs[k]) >= MIN_SEG_M) { k++; continue; }
    const into = k > 0 ? k - 1 : 1;
    runs[into] = { ...runs[into], a: Math.min(runs[into].a, runs[k].a), b: Math.max(runs[into].b, runs[k].b) };
    runs.splice(k, 1);
    // 합친 뒤 같은 종류가 이웃하면 하나로 잇는다
    runs = runs.reduce<Run[]>((acc, r) => {
      const p = acc[acc.length - 1];
      if (p && p.cls === r.cls && p.dir === r.dir) p.b = r.b; else acc.push({ ...r });
      return acc;
    }, []);
    k = Math.max(0, into - 1);
  }
  const segOf = new Array<number>(m).fill(0);
  runs.forEach((r, k) => { for (let i = r.a; i < r.b; i++) segOf[i] = k; });
  const segs: Seg[] = runs.map((r) => ({ from: f[r.a], to: f[r.b], cls: r.cls, dir: r.dir }));

  // 점의 등급 수준: 양옆 구간 평균 (구간이 바뀌는 곳에서 색이 부드럽게 넘어간다)
  const lv = Array.from({ length: m + 1 }, (_, i) => (i === 0 ? segLv[0] : i === m ? segLv[m - 1] : (segLv[i - 1] + segLv[i]) / 2));

  const elev = [0];
  for (let i = 0; i < m; i++) elev.push(elev[i] + (grade[i] / 100) * len[i]);

  // 같은 길 왕복: 거리상 멀리 떨어진 두 점이 OVERLAP_M 안에 있으면 겹친 점
  const near = pts.map((_, j) => {
    for (let i = 0; i < j; i++) {
      if (dist[j] - dist[i] > 300 && Math.hypot(xy[j][0] - xy[i][0], xy[j][1] - xy[i][1]) < OVERLAP_M) return true;
    }
    for (let i = j + 1; i <= m; i++) {
      if (dist[i] - dist[j] > 300 && Math.hypot(xy[j][0] - xy[i][0], xy[j][1] - xy[i][1]) < OVERLAP_M) return true;
    }
    return false;
  });
  const over = len.map((_, i) => near[i] && near[i + 1]);
  for (let i = 0; i < m; ) {
    if (!over[i]) { i++; continue; }
    let j = i;
    while (j < m && over[j]) j++;
    if (dist[j] - dist[i] < OVERLAP_MIN_M) for (let q = i; q < j; q++) over[q] = false;
    i = j;
  }
  const overM = len.reduce((s, l, i) => s + (over[i] ? l : 0), 0);

  return { pts, f, len, lv, segOf, elev, over, segs, totalM: total, overlapPct: Math.round((overM / total) * 100) };
}

/** 비율 f 에 해당하는 구간 번호와 그 안의 위치 */
export function locate(a: CourseSlope, f: number) {
  const x = Math.min(1, Math.max(0, f));
  let i = a.f.findIndex((v) => v >= x) - 1;
  if (i < 0) i = 0;
  if (i > a.len.length - 1) i = a.len.length - 1;
  const t = (x - a.f[i]) / ((a.f[i + 1] - a.f[i]) || 1);
  return { i, t: Math.min(1, Math.max(0, t)) };
}

export function pointAt(a: CourseSlope, f: number): [number, number] {
  const { i, t } = locate(a, f);
  const p = a.pts[i], q = a.pts[i + 1];
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

export const segAt = (a: CourseSlope, f: number) => a.segs[a.segOf[locate(a, f).i]];

const CLS_TEXT: Record<SlopeClass, string> = { flat: "평지", gentle: "완만", hill: "언덕" };
export const gradeText = (s: Seg) => (s.cls === "flat" ? "평지" : `${CLS_TEXT[s.cls]} ${s.dir === "up" ? "▲" : "▼"}`);

/** 카드 안의 한 줄 요약 */
export function slopeSummary(a: CourseSlope): string {
  const hill = a.segs.some((s) => s.cls === "hill");
  const gentle = a.segs.some((s) => s.cls === "gentle");
  if (hill) return a.overlapPct >= 10 ? "중간에 언덕 구간이 있고, 같은 길로 오르내려요" : "중간에 언덕 구간이 있어요";
  if (gentle) return "완만하게 오르내리는 구간이 있어요";
  return "전체적으로 평탄해요";
}
