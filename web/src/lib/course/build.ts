import type { CacheStore } from "./cache";
import {
  type LatLng,
  type ParsedRoute,
  type Role,
  ROLE_LABEL,
  calcElevationGain,
  gradeProfile,
  generateLoopWaypoints,
  generateOneWayWaypoints,
  generateTurnaroundPoint,
  outAndBack,
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

const SAMPLE_STEP_M = 50; // 겹침 계산용
// 고도 조회용 간격. DEM 해상도(90m)보다 촘촘하게 찍어도 정보가 늘지 않고 Open-Meteo 한도만 쓴다
const ELEVATION_STEP_M = 100;
const DEFAULT_POOL_SIZE = 6;
// 고도 조회 대상 후보 수 상한. Open-Meteo 는 분·시간 단위 한도(429)가 있어 조회량을 줄인다
const MAX_ELEVATION_CANDIDATES = 4;
const TURNAROUND_COUNT = 2; // 루프 모드 후보 중 반환 코스 수
const LOOP_WAYPOINTS = 2; // 경유지가 적을수록 돌출(경유지까지 갔다 오는 구간)이 줄고 직진 구간이 길어진다

type Candidate = {
  heading: number;
  route: ParsedRoute;
  samples: LatLng[];
  /** 같은 길로 돌아오는 반환 코스 (의도된 왕복이라 돌출·겹침으로 감점하지 않는다) */
  turnaround: boolean;
  distanceM: number;
  gainM: number;
  crossings: number;
  stairs: number;
  overlap: number;
  spur: number;
  turnsPerKm: number;
  straight: number;
  calm: number;
  poor: number;
  /** 구간별 경사율 (고도를 조회한 후보만) */
  profile: SlopeProfile | null;
  /** 진단용: 이 후보를 만든 보정계수와 경유지 폴리라인 길이 */
  k: number;
  polyM: number;
};

/** 지도 경사 색칠용: pts[i]→pts[i+1] 구간의 경사율(%)이 grade[i] */
export type SlopeProfile = { pts: [number, number][]; grade: number[] };

export type Slope = "flat" | "gentle" | "hill";

export type CourseResult = {
  role: Role;
  label: string;
  distanceM: number;
  /** 고도 조회에 실패하면 null (경사 칩을 숨긴다) */
  gainM: number | null;
  slope: Slope | null;
  /** 고도 조회에 실패하면 null (지도는 경사 색 없이 그린다) */
  profile: SlopeProfile | null;
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
  kind: "loop" | "turnaround",
): Promise<Candidate[]> {
  const { start, targetM } = input;
  const end = input.end ?? start;
  const turnaround = kind === "turnaround";

  // 반환 코스: 편도 1회 호출 → 목표 절반 지점에서 잘라 되돌아온다. 거리가 목표와 거의 같아 재시도가 없다
  if (turnaround) {
    const far = generateTurnaroundPoint(start, targetM, heading);
    const oneWay = trimSpurs(parseTmapRoute(await tmapPedestrian(store, counter, start, far, [])));
    if (oneWay.path.length < 2) throw new UpstreamError("tmap", "TMAP 응답에 경로 좌표가 없습니다");
    return [toCandidate(outAndBack(oneWay, targetM), heading, true, 0, pathLengthM([start, far]))];
  }

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

  return routes.map(({ route, k, polyM }) => toCandidate(route, heading, false, k, polyM));
}

// 고도(gainM)는 여기서 조회하지 않는다 — 뽑힐 후보가 정해진 뒤 buildCourses 가 채운다
function toCandidate(route: ParsedRoute, heading: number, turnaround: boolean, k: number, polyM: number): Candidate {
  const samples = resample(route.path, SAMPLE_STEP_M);
  const shape = routeShape(route.path);
  return {
    heading,
    route,
    samples,
    turnaround,
    distanceM: route.distanceM,
    gainM: 0,
    crossings: route.crossings,
    stairs: route.stairs,
    // 반환 코스의 왕복은 의도된 것이라 겹침·돌출로 감점하지 않는다
    overlap: turnaround ? 0 : overlapRatio(samples),
    spur: turnaround ? 0 : shape.spurRatio,
    turnsPerKm: shape.turnsPerKm,
    straight: shape.straightRatio,
    calm: route.calm,
    poor: route.poor,
    profile: null,
    k,
    polyM,
  };
}

function noteOf(role: Role, turnaround: boolean, note: string | null, noElevation: boolean): string | null {
  if (noElevation && role === "MIN_GAIN") return "고도 정보를 불러오지 못해 경사는 비교하지 못했어요";
  if (turnaround) return "같은 길로 돌아오는 반환 코스예요";
  return note;
}

/** 진단용 후보 풀 요약 (API 응답에는 싣지 않는다) */
export type PoolEntry = Pick<Candidate, "heading" | "distanceM" | "spur" | "turnsPerKm" | "straight" | "crossings" | "gainM" | "k" | "polyM" | "turnaround">;

export type BuildOutput = { courses: CourseResult[]; usedTolerance: number; calls: CallCounter; pool: PoolEntry[] };

/** 방향별 후보를 병렬로 만들어 ① 종합 ② 경사 최소 ③ 횡단보도 최소 3개를 고른다 */
export async function buildCourses(
  store: CacheStore,
  input: BuildInput,
  poolSize = DEFAULT_POOL_SIZE,
): Promise<BuildOutput> {
  const counter: CallCounter = { tmap: 0, elevation: 0 };
  // 루프 모드: 일부 방향은 "같은 길로 돌아오는 반환 코스"로 만든다. 일자로 쭉 뛰는 코스를 후보에 섞기 위함
  const turnarounds = !input.end && poolSize >= 4 ? TURNAROUND_COUNT : 0;
  const loops = poolSize - turnarounds;
  const plans: { heading: number; kind: "loop" | "turnaround" }[] = [
    ...Array.from({ length: loops }, (_, i) => ({ heading: (i * 360) / loops, kind: "loop" as const })),
    // 루프 방향 사이사이에 놓아 서로 다른 길이 되게 한다
    ...Array.from({ length: turnarounds }, (_, i) => ({ heading: 360 / loops / 2 + (i * 360) / turnarounds, kind: "turnaround" as const })),
  ];

  const settled = await Promise.allSettled(plans.map((p) => buildCandidate(store, counter, input, p.heading, p.kind)));
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
    finalists.map(async (c): Promise<Candidate> => {
      const pts = resample(c.route.path, ELEVATION_STEP_M);
      const elevations = await fetchElevations(store, counter, pts);
      const profile: SlopeProfile = {
        pts: pts.map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))]),
        grade: gradeProfile(pts, elevations).map((g) => Number(g.toFixed(1))),
      };
      return { ...c, gainM: calcElevationGain(elevations, 2).gain, profile };
    }),
  );
  let pool = withGain.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  // 고도를 하나도 못 받으면 요청을 실패시키지 않고 경사 없이 코스를 보여준다
  const noElevation = pool.length === 0;
  if (noElevation) {
    const reason = withGain.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
    console.warn("[buildCourses] 고도 조회 실패, 경사 없이 진행", reason instanceof Error ? reason.message : reason);
    pool = finalists;
  }

  const { picks, usedTolerance } = pickThree(pool, input.targetM, 0.1);
  const courses = picks.map<CourseResult>((p) => ({
    role: p.role,
    label: ROLE_LABEL[p.role],
    distanceM: Math.round(p.item.distanceM),
    gainM: noElevation ? null : Math.round(p.item.gainM),
    slope: noElevation ? null : slopeOf(p.item.gainM, p.item.distanceM),
    profile: noElevation ? null : p.item.profile,
    crossings: p.item.crossings,
    stairs: p.item.stairs,
    estSec: input.paceSecPerKm === null ? null : Math.round((p.item.distanceM / 1000) * input.paceSecPerKm),
    path: p.item.route.path.map((pt) => [pt.lat, pt.lng]),
    note: noteOf(p.role, p.item.turnaround, p.note, noElevation),
  }));
  const summary = pool.map(({ heading, distanceM, spur, turnsPerKm, straight, crossings, gainM, k, polyM, turnaround }) => ({ heading, distanceM, spur, turnsPerKm, straight, crossings, gainM, k, polyM, turnaround }));
  return { courses, usedTolerance, calls: counter, pool: summary };
}
