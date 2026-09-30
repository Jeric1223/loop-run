/**
 * lib.ts — 러닝 코스 생성 핵심 로직 (네트워크 호출 없음)
 * 나중에 Next.js Route Handler로 그대로 옮겨 쓴다.
 */

export type LatLng = { lat: number; lng: number };

export type TmapFeature = {
  type: 'Feature';
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: [number, number][] };
  properties: Record<string, unknown>;
};
export type TmapResponse = { type: 'FeatureCollection'; features: TmapFeature[] };

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

// ───────────────────────── 지리 계산 ─────────────────────────

/** 두 좌표 사이 거리(m) */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** origin에서 bearing(도, 북=0 시계방향) 방향으로 distance(m) 이동한 좌표 */
export function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const angular = distanceM / EARTH_RADIUS_M;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

export function pathLengthM(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineM(path[i - 1], path[i]);
  return total;
}

// ───────────────────────── 루프 경유지 생성 ─────────────────────────

/**
 * 출발점을 지나는 원 위에 경유지를 배치한다.
 * 반지름 r = D / (2π·k), k = 도로 굴곡 보정계수(직선 대비 실제 도로가 길어지는 비율).
 * 출발 → 경유지들 → 출발 순으로 TMAP에 요청하면 루프가 된다.
 */
export function generateLoopWaypoints(
  start: LatLng,
  targetDistanceM: number,
  headingDeg: number,
  waypointCount = 4,
  detourFactor = 1.3,
): LatLng[] {
  const radius = targetDistanceM / (2 * Math.PI * detourFactor);
  const center = destinationPoint(start, headingDeg, radius);
  const startAngle = (headingDeg + 180) % 360; // 원의 중심에서 출발점을 바라본 방향

  const waypoints: LatLng[] = [];
  for (let i = 1; i <= waypointCount; i++) {
    const angle = startAngle + (360 / (waypointCount + 1)) * i;
    waypoints.push(destinationPoint(center, angle, radius));
  }
  return waypoints;
}

/** a에서 b를 바라본 방위(도, 북=0 시계방향) */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 타원 호 위 경유지 각도(도). 작을수록 출발 쪽. [가운데, 출발 쪽으로 치우침, 도착 쪽으로 치우침]
const ONE_WAY_THETAS = [
  [45, 90, 135],
  [25, 60, 100],
  [80, 120, 155],
];

/**
 * 출발 ≠ 도착(편도)일 때 경유지를 만든다.
 * 출발·도착을 두 초점으로 하는 타원의 한쪽 호 위에 경유지를 놓고,
 * 출발 → 경유지들 → 도착 폴리라인 길이가 targetDistanceM / detourFactor 가 되도록 타원 크기를 이분 탐색한다.
 * 후보 다양화: headingDeg < 180 이면 진행 방향 왼쪽, 아니면 오른쪽으로 부풀리고,
 * headingDeg % 180 에 따라 부푼 위치가 출발 쪽 / 가운데 / 도착 쪽으로 달라진다.
 * 목표가 직선거리 × detourFactor 이하면 우회할 여유가 없으므로 빈 배열(직행)을 돌려준다.
 */
export function generateOneWayWaypoints(
  start: LatLng,
  end: LatLng,
  targetDistanceM: number,
  headingDeg: number,
  detourFactor = 1.3,
): LatLng[] {
  const direct = haversineM(start, end);
  const want = targetDistanceM / detourFactor; // 폴리라인(직선 구간 합) 목표 길이
  if (want <= direct * 1.05) return [];

  const axis = bearingDeg(start, end);
  const side = headingDeg < 180 ? -1 : 1; // -1: 진행 방향 왼쪽(axis-90), 1: 오른쪽
  const variant = Math.min(2, Math.floor((headingDeg % 180) / 60));
  const thetas = ONE_WAY_THETAS[variant].map(toRad); // 출발 쪽 → 도착 쪽
  const c = direct / 2;
  const mid = destinationPoint(start, axis, c);

  const build = (a: number): LatLng[] => {
    const b = Math.sqrt(Math.max(a * a - c * c, 0));
    return thetas.map((t) => {
      const along = destinationPoint(mid, axis + 180, a * Math.cos(t)); // θ 작을수록 출발 쪽
      return destinationPoint(along, axis + side * 90, b * Math.sin(t));
    });
  };
  const len = (a: number) => pathLengthM([start, ...build(a), end]);

  let lo = c;
  let hi = want; // 폴리라인 길이 ≥ 2a 이므로 a = want 면 충분히 크다
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (len(m) < want) lo = m;
    else hi = m;
  }
  return build((lo + hi) / 2);
}

// ───────────────────────── TMAP 응답 해석 ─────────────────────────

// TMAP 보행자 경로안내 turnType (공식 목록 기준)
export const CROSSING_TURN_TYPES = new Set([211, 212, 213, 214, 215, 216, 217]); // 횡단보도
export const STAIRS_TURN_TYPES = new Set([127, 129]); // 계단 진입, 계단+경사로 진입
export const OVERPASS_TURN_TYPES = new Set([125, 126]); // 육교, 지하보도

export type ParsedRoute = {
  path: LatLng[];
  distanceM: number;
  durationSec: number;
  crossings: number;
  stairs: number;
  overpasses: number;
  /** 디버그용: 응답에 실제로 나온 turnType / facilityType 분포 */
  turnTypeCounts: Record<string, number>;
  facilityTypeCounts: Record<string, number>;
};

export function parseTmapRoute(res: TmapResponse): ParsedRoute {
  const path: LatLng[] = [];
  const turnTypeCounts: Record<string, number> = {};
  const facilityTypeCounts: Record<string, number> = {};
  const bump = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };

  let apiDistanceM: number | null = null;
  let durationSec = 0;
  let crossings = 0;
  let stairs = 0;
  let overpasses = 0;

  for (const f of res.features) {
    const p = f.properties;
    if (f.geometry.type === 'Point') {
      if (typeof p.totalDistance === 'number') apiDistanceM = p.totalDistance;
      if (typeof p.totalTime === 'number') durationSec = p.totalTime;
      const t = Number(p.turnType);
      if (Number.isFinite(t)) {
        bump(turnTypeCounts, String(t));
        if (CROSSING_TURN_TYPES.has(t)) crossings++;
        else if (STAIRS_TURN_TYPES.has(t)) stairs++;
        else if (OVERPASS_TURN_TYPES.has(t)) overpasses++;
      }
    } else {
      if (p.facilityType !== undefined) bump(facilityTypeCounts, String(p.facilityType));
      for (const [lng, lat] of f.geometry.coordinates) {
        const last = path[path.length - 1];
        if (!last || last.lat !== lat || last.lng !== lng) path.push({ lat, lng });
      }
    }
  }

  return {
    path,
    distanceM: apiDistanceM ?? pathLengthM(path),
    durationSec,
    crossings,
    stairs,
    overpasses,
    turnTypeCounts,
    facilityTypeCounts,
  };
}

// ───────────────────────── 샘플링 · 고도 · 겹침 ─────────────────────────

/** 경로를 stepM(m) 간격으로 다시 찍는다. 첫 점과 끝 점은 항상 포함. */
export function resample(path: LatLng[], stepM = 50): LatLng[] {
  if (path.length < 2) return path.slice();
  const out: LatLng[] = [path[0]];
  let carried = 0; // 마지막 샘플 이후 지나온 거리 (항상 stepM 미만)

  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1];
    const b = path[i];
    let segLen = haversineM(a, b);
    while (carried + segLen >= stepM) {
      const t = (stepM - carried) / segLen;
      const p = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      out.push(p);
      a = p;
      segLen = haversineM(a, b);
      carried = 0;
    }
    carried += segLen;
  }

  const last = path[path.length - 1];
  if (haversineM(out[out.length - 1], last) > 1) out.push(last);
  return out;
}

/**
 * 누적 상승·하강 고도(m).
 * 기준 고도보다 thresholdM 이상 변해야 인정한다 (DEM 상대 오차 ≈ 2m 노이즈 제거).
 * thresholdM = 0 이면 노이즈를 거르지 않은 원본 값.
 */
export function calcElevationGain(
  elevations: number[],
  thresholdM = 2,
): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  if (elevations.length === 0) return { gain, loss };
  let ref = elevations[0];
  for (const e of elevations.slice(1)) {
    if (e - ref >= thresholdM) {
      gain += e - ref;
      ref = e;
    } else if (ref - e >= thresholdM) {
      loss += ref - e;
      ref = e;
    }
  }
  return { gain, loss };
}

/**
 * 같은 길을 되돌아온 비율(0~1). 샘플 점이 경로상 멀리 떨어진 다른 샘플과
 * 같은 위치(약 30m 격자, 주변 포함)에 있으면 겹침으로 센다.
 * 루프의 출발점·도착점은 원래 같은 위치라서 제외한다.
 * 그래서 순수 왕복 코스도 100%가 아니라 60% 안팎이 나온다 (깨끗한 원은 거의 0%).
 * 절대값보다 후보끼리의 상대 비교용으로 쓰고, 가중치는 그 기준으로 튜닝한다.
 */
export function overlapRatio(samples: LatLng[], minIndexGap = 6): number {
  const n = samples.length;
  if (n < 2) return 0;

  const cellLat = 0.00027; // ≈ 30m
  const cellLng = cellLat / Math.cos(toRad(samples[0].lat));
  const cellOf = (p: LatLng): [number, number] => [
    Math.floor(p.lat / cellLat),
    Math.floor(p.lng / cellLng),
  ];

  const cells = new Map<string, number[]>();
  samples.forEach((p, i) => {
    const [cy, cx] = cellOf(p);
    const key = `${cy}:${cx}`;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  });

  const nearEnds = (i: number, j: number) =>
    (i < 5 && j >= n - 5) || (j < 5 && i >= n - 5);

  let overlapped = 0;
  samples.forEach((p, i) => {
    const [cy, cx] = cellOf(p);
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) {
      for (let dx = -1; dx <= 1 && !hit; dx++) {
        const list = cells.get(`${cy + dy}:${cx + dx}`);
        if (list && list.some((j) => Math.abs(j - i) > minIndexGap && !nearEnds(i, j))) hit = true;
      }
    }
    if (hit) overlapped++;
  });
  return overlapped / n;
}

// ───────────────────────── 점수 ─────────────────────────

export type Preset = 'BALANCED' | 'FLAT' | 'HILL' | 'FEW_CROSSINGS';
type Weights = { deviation: number; gain: number; crossings: number; stairs: number; overlap: number };

/** 초기값(임시). 실제 코스로 돌려보며 튜닝한다. */
export const PRESET_WEIGHTS: Record<Preset, Weights> = {
  // 종합 추천용(pick 모드의 ①): 경사·횡단보도·계단·겹침을 골고루 본다
  BALANCED: { deviation: 10, gain: 0.06, crossings: 0.5, stairs: 1.5, overlap: 3 },
  // rank 모드에서 고르는 프리셋
  FLAT: { deviation: 10, gain: 0.1, crossings: 0.3, stairs: 1.5, overlap: 3 }, // 평지 선호
  HILL: { deviation: 10, gain: -0.05, crossings: 0.3, stairs: 1.5, overlap: 3 }, // 언덕 훈련: 오르막이 많을수록 가점
  FEW_CROSSINGS: { deviation: 10, gain: 0.03, crossings: 1.0, stairs: 1.5, overlap: 3 }, // 신호 적게
};

/** 낮을수록 좋은 코스 */
export function scoreCourse(
  m: { distanceM: number; targetM: number; gainM: number; crossings: number; stairs: number; overlap: number },
  preset: Preset,
): number {
  const w = PRESET_WEIGHTS[preset];
  const deviation = Math.abs(m.distanceM - m.targetM) / m.targetM;
  return (
    w.deviation * deviation +
    w.gain * m.gainM +
    w.crossings * m.crossings +
    w.stairs * m.stairs +
    w.overlap * m.overlap
  );
}

// ───────────────────────── 목표 거리 (거리 또는 페이스×시간) ─────────────────────────

/** "6:00" → 360 (초/km) */
export function parsePace(text: string): number {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!m) throw new Error(`페이스는 m:ss 형식으로 입력하세요 (예: 6:00). 입력값: ${text}`);
  const sec = Number(m[1]) * 60 + Number(m[2]);
  if (sec < 150 || sec > 1200) throw new Error('페이스는 2:30 ~ 20:00 (분/km) 범위로 입력하세요');
  return sec;
}

/**
 * 거리(km) 또는 페이스+시간(분)을 목표 거리(m)로 바꾼다.
 * 거리와 페이스를 같이 주면 거리를 쓰고, 페이스는 예상 시간 계산에만 쓴다.
 */
export function targetDistanceM(input: { km?: number; pace?: string; minutes?: number }): {
  distanceM: number;
  paceSecPerKm: number | null;
} {
  const paceSecPerKm = input.pace ? parsePace(input.pace) : null;
  let distanceM: number;
  if (input.km !== undefined) {
    distanceM = input.km * 1000;
  } else if (paceSecPerKm !== null && input.minutes !== undefined) {
    distanceM = ((input.minutes * 60) / paceSecPerKm) * 1000;
  } else {
    throw new Error('거리(--km) 또는 페이스+시간(--pace, --min)을 입력하세요');
  }
  if (!Number.isFinite(distanceM) || distanceM < 500 || distanceM > 30_000) {
    throw new Error(`목표 거리는 0.5 ~ 30km 범위여야 합니다 (계산된 값: ${(distanceM / 1000).toFixed(2)}km)`);
  }
  return { distanceM, paceSecPerKm };
}

// ───────────────────────── 후보 3개 고르기 ─────────────────────────

export type Role = 'BEST' | 'MIN_GAIN' | 'MIN_CROSSINGS';
export const ROLE_LABEL: Record<Role, string> = {
  BEST: '종합 추천',
  MIN_GAIN: '경사 최소',
  MIN_CROSSINGS: '횡단보도 최소',
};

export type Rankable = { distanceM: number; gainM: number; crossings: number; stairs: number; overlap: number };
export type Pick<T> = { role: Role; item: T; score: number; note: string | null };

/**
 * 후보 풀에서 서로 다른 코스 3개를 고른다.
 *   ① 종합 추천     : 균형 점수(BALANCED)가 가장 낮은 코스
 *   ② 경사 최소     : 누적 상승고도가 가장 낮은 코스
 *   ③ 횡단보도 최소 : 횡단보도 수가 가장 적은 코스
 * 같은 코스가 여러 기준의 1위면 앞선 슬롯이 가져가고, 다음 슬롯은 차순위를 고른다.
 * 목표 거리 ±tolerance 안의 후보만 대상으로 하고, 부족하면 ±20% → 전체 순으로 넓힌다.
 */
export function pickThree<T extends Rankable>(
  items: T[],
  targetM: number,
  tolerance = 0.1,
): { picks: Pick<T>[]; usedTolerance: number } {
  const want = Math.min(3, items.length);
  const dev = (it: T) => Math.abs(it.distanceM - targetM) / targetM;

  let used = Number.POSITIVE_INFINITY;
  for (const tol of [tolerance, 0.2, Number.POSITIVE_INFINITY]) {
    if (items.filter((it) => dev(it) <= tol).length >= want) {
      used = tol;
      break;
    }
  }

  const scored = items
    .filter((it) => dev(it) <= used)
    .map((item) => ({
      item,
      score: scoreCourse(
        { distanceM: item.distanceM, targetM, gainM: item.gainM, crossings: item.crossings, stairs: item.stairs, overlap: item.overlap },
        'BALANCED',
      ),
    }));

  type Scored = (typeof scored)[number];
  const order: Record<Role, (a: Scored, b: Scored) => number> = {
    BEST: (a, b) => a.score - b.score,
    MIN_GAIN: (a, b) => a.item.gainM - b.item.gainM || a.score - b.score,
    MIN_CROSSINGS: (a, b) => a.item.crossings - b.item.crossings || a.score - b.score,
  };

  const picks: Pick<T>[] = [];
  const taken = new Set<Scored>();
  for (const role of ['BEST', 'MIN_GAIN', 'MIN_CROSSINGS'] as Role[]) {
    const sorted = [...scored].sort(order[role]);
    const chosen = sorted.find((s) => !taken.has(s));
    if (!chosen) break;
    taken.add(chosen);
    const note =
      sorted[0] !== chosen ? `${ROLE_LABEL[role]} 1위는 앞선 추천과 같은 코스라 차순위를 보여줍니다` : null;
    picks.push({ role, item: chosen.item, score: chosen.score, note });
  }
  return { picks, usedTolerance: used };
}
