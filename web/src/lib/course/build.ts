import type { CacheStore } from "./cache";
import {
  type LatLng,
  type ParsedRoute,
  type Role,
  ROLE_LABEL,
  calcElevationGain,
  generateLoopWaypoints,
  generateOneWayWaypoints,
  overlapRatio,
  parseTmapRoute,
  pathLengthM,
  pickThree,
  resample,
  routeShape,
  scoreCourse,
  trimSpurs,
} from "./lib";
import { type CallCounter, UpstreamError, fetchElevations, tmapPedestrian } from "./providers";

const SAMPLE_STEP_M = 50;
const DEFAULT_POOL_SIZE = 6;
// 고도 조회 대상 후보 수 상한. Open-Meteo 분당 한도(429) 때문에 후보 전부를 조회하면 일부가 탈락한다
const MAX_ELEVATION_CANDIDATES = 6;
const LOOP_WAYPOINTS = 2; // 경유지가 적을수록 돌출(경유지까지 갔다 오는 구간)이 줄고 직진 구간이 길어진다

type Candidate = {
  heading: number;
  route: ParsedRoute;
  samples: LatLng[];
  distanceM: number;
  gainM: number;
  crossings: number;
  stairs: number;
  overlap: number;
  spur: number;
  turnsPerKm: number;
  straight: number;
  /** 진단용: 이 후보를 만든 보정계수와 경유지 폴리라인 길이 */
  k: number;
  polyM: number;
};

export type Slope = "flat" | "gentle" | "hill";

export type CourseResult = {
  role: Role;
  label: string;
  distanceM: number;
  gainM: number;
  slope: Slope;
  crossings: number;
  stairs: number;
  /** 페이스가 있을 때만 (거리 × 페이스) */
  estSec: number | null;
  /** [lat, lng][] */
  path: [number, number][];
  note: string | null;
};

export type BuildInput = {
  start: LatLng;
  /** null 이면 출발점으로 돌아오는 왕복 루프 */
  end: LatLng | null;
  targetM: number;
  paceSecPerKm: number | null;
};

/** 경사 3단계. 기준값(km당 상승 m)은 임시 — 실제 코스로 보며 튜닝한다 */
export function slopeOf(gainM: number, distanceM: number): Slope {
  const perKm = gainM / (distanceM / 1000);
  return perKm < 10 ? "flat" : perKm < 25 ? "gentle" : "hill";
}

// 시작 보정계수(= TMAP 거리 ÷ 경유지 폴리라인 길이 의 기대값). 임시값 — 지역별 실측으로 계속 맞춘다
//  - 편도: 서울 성수에서 TMAP 이 폴리라인의 1.6~2.1배로 돌아가 1.3 은 모두 너무 길게 나왔다
//  - 루프(경유지 2개 삼각형): 대전에서 폴리라인이 짧을수록(k=1.6) 0.85~1.53배, 목표에 가까울수록(k≈1.2) 약 1.0배
const START_K_ONE_WAY = 1.6;
const START_K_LOOP = 1.05;

async function buildCandidate(
  store: CacheStore,
  counter: CallCounter,
  input: BuildInput,
  heading: number,
): Promise<Candidate[]> {
  const { start, targetM } = input;
  const end = input.end ?? start;

  // TMAP 거리는 경유지 길이에 비례하지 않고 들쭉날쭉해서(실측 README 참고) 한 번의 선형 보정으로는 수렴하지 않는다.
  // 그래서 ① 보정은 제곱근으로 완화하고 ② 재시도까지 얻은 경로를 모두 후보로 남겨 pickThree 가 고르게 한다 (최대 2회 호출)
  let k = input.end ? START_K_ONE_WAY : START_K_LOOP;
  const routes: { route: ParsedRoute; k: number; polyM: number }[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const waypoints = input.end
      ? generateOneWayWaypoints(start, end, targetM, heading, k)
      : generateLoopWaypoints(start, targetM, heading, LOOP_WAYPOINTS, k);
    // 경유지를 찍고 돌아 나오는 왕복 돌출은 잘라낸 뒤 거리를 본다 (짧아진 만큼은 아래 재시도가 k 로 보충한다)
    const parsed = trimSpurs(parseTmapRoute(await tmapPedestrian(store, counter, start, end, waypoints)));
    if (parsed.path.length < 2) throw new UpstreamError("tmap", "TMAP 응답에 경로 좌표가 없습니다");
    routes.push({ route: parsed, k, polyM: pathLengthM([start, ...waypoints, end]) });
    if (Math.abs(parsed.distanceM - targetM) / targetM <= 0.1) break;
    if (input.end && waypoints.length === 0) break; // 직행이면 보정해도 같은 경로
    k *= Math.sqrt(parsed.distanceM / targetM);
  }

  // 고도(gainM)는 여기서 조회하지 않는다 — 뽑힐 후보가 정해진 뒤 buildCourses 가 채운다
  return routes.map(({ route, k, polyM }) => {
    const samples = resample(route.path, SAMPLE_STEP_M);
    const shape = routeShape(route.path);
    return {
      heading,
      route,
      samples,
      distanceM: route.distanceM,
      gainM: 0,
      crossings: route.crossings,
      stairs: route.stairs,
      overlap: overlapRatio(samples),
      spur: shape.spurRatio,
      turnsPerKm: shape.turnsPerKm,
      straight: shape.straightRatio,
      k,
      polyM,
    };
  });
}

/** 진단용 후보 풀 요약 (API 응답에는 싣지 않는다) */
export type PoolEntry = Pick<Candidate, "heading" | "distanceM" | "spur" | "turnsPerKm" | "straight" | "crossings" | "gainM" | "k" | "polyM">;

export type BuildOutput = { courses: CourseResult[]; usedTolerance: number; calls: CallCounter; pool: PoolEntry[] };

/** 방향별 후보를 병렬로 만들어 ① 종합 ② 경사 최소 ③ 횡단보도 최소 3개를 고른다 */
export async function buildCourses(
  store: CacheStore,
  input: BuildInput,
  poolSize = DEFAULT_POOL_SIZE,
): Promise<BuildOutput> {
  const counter: CallCounter = { tmap: 0, elevation: 0 };
  const headings = Array.from({ length: poolSize }, (_, i) => (i * 360) / poolSize);

  const settled = await Promise.allSettled(headings.map((h) => buildCandidate(store, counter, input, h)));
  // TMAP 이 같은 길을 돌려준 후보는 하나만 남긴다 (서로 다른 코스 3개를 고르기 위해)
  const seen = new Set<string>();
  const deduped = settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((c) => {
      const key = `${Math.round(c.distanceM)}:${c.crossings}:${c.route.path.length}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
  if (deduped.length === 0) {
    const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
    throw firstErr instanceof Error ? firstErr : new UpstreamError("tmap", "만들어진 후보가 없습니다");
  }

  // 고도는 뽑힐 가능성이 있는 후보(거리 ±20% 안, 고도 빼고 본 점수 상위)에만 조회한다
  const inRange = deduped.filter((c) => Math.abs(c.distanceM - input.targetM) / input.targetM <= 0.2);
  const preScore = (c: Candidate) => scoreCourse({ ...c, targetM: input.targetM }, "BALANCED");
  const finalists = [...(inRange.length >= 3 ? inRange : deduped)]
    .sort((a, b) => preScore(a) - preScore(b))
    .slice(0, MAX_ELEVATION_CANDIDATES);
  const withGain = await Promise.allSettled(
    finalists.map(async (c) => {
      const elevations = await fetchElevations(store, counter, c.samples);
      return { ...c, gainM: calcElevationGain(elevations, 2).gain };
    }),
  );
  const pool = withGain.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (pool.length === 0) {
    const firstErr = withGain.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
    throw firstErr instanceof Error ? firstErr : new UpstreamError("elevation", "고도를 조회한 후보가 없습니다");
  }

  const { picks, usedTolerance } = pickThree(pool, input.targetM, 0.1);
  const courses = picks.map<CourseResult>((p) => ({
    role: p.role,
    label: ROLE_LABEL[p.role],
    distanceM: Math.round(p.item.distanceM),
    gainM: Math.round(p.item.gainM),
    slope: slopeOf(p.item.gainM, p.item.distanceM),
    crossings: p.item.crossings,
    stairs: p.item.stairs,
    estSec: input.paceSecPerKm === null ? null : Math.round((p.item.distanceM / 1000) * input.paceSecPerKm),
    path: p.item.route.path.map((pt) => [pt.lat, pt.lng]),
    note: p.note,
  }));
  const summary = pool.map(({ heading, distanceM, spur, turnsPerKm, straight, crossings, gainM, k, polyM }) => ({ heading, distanceM, spur, turnsPerKm, straight, crossings, gainM, k, polyM }));
  return { courses, usedTolerance, calls: counter, pool: summary };
}
