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
  pickThree,
  resample,
} from "./lib";
import { type CallCounter, UpstreamError, fetchElevations, tmapPedestrian } from "./providers";

const SAMPLE_STEP_M = 50;
const DEFAULT_POOL_SIZE = 6;

type Candidate = {
  heading: number;
  route: ParsedRoute;
  distanceM: number;
  gainM: number;
  crossings: number;
  stairs: number;
  overlap: number;
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

// 시작 보정계수. 실측(서울 성수, 편도)에서 TMAP 이 경유지 폴리라인의 1.6~2.1배로 돌아가 1.3 은 모두 너무 길게 나왔다
const START_K = 1.6;

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
  let k = START_K;
  const routes: ParsedRoute[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const waypoints = input.end
      ? generateOneWayWaypoints(start, end, targetM, heading, k)
      : generateLoopWaypoints(start, targetM, heading, 4, k);
    const parsed = parseTmapRoute(await tmapPedestrian(store, counter, start, end, waypoints));
    if (parsed.path.length < 2) throw new UpstreamError("tmap", "TMAP 응답에 경로 좌표가 없습니다");
    routes.push(parsed);
    if (Math.abs(parsed.distanceM - targetM) / targetM <= 0.1) break;
    if (input.end && waypoints.length === 0) break; // 직행이면 보정해도 같은 경로
    k *= Math.sqrt(parsed.distanceM / targetM);
  }

  return Promise.all(
    routes.map(async (route) => {
      const samples = resample(route.path, SAMPLE_STEP_M);
      const elevations = await fetchElevations(store, counter, samples);
      const { gain } = calcElevationGain(elevations, 2);
      return {
        heading,
        route,
        distanceM: route.distanceM,
        gainM: gain,
        crossings: route.crossings,
        stairs: route.stairs,
        overlap: overlapRatio(samples),
      };
    }),
  );
}

export type BuildOutput = { courses: CourseResult[]; usedTolerance: number; calls: CallCounter };

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
  const pool = settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((c) => {
      const key = `${Math.round(c.distanceM)}:${c.crossings}:${c.route.path.length}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
  if (pool.length === 0) {
    const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
    throw firstErr instanceof Error ? firstErr : new UpstreamError("tmap", "만들어진 후보가 없습니다");
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
  return { courses, usedTolerance, calls: counter };
}
