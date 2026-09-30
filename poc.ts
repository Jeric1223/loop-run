/**
 * 러닝 코스 PoC (1차)
 *
 * 모드 (--mode)
 *   rank (기본) : 3방향(0°/120°/240°) 후보를 만들어 점수 하나(--preset)로 줄세운다
 *   pick        : 후보 풀(기본 6방향)에서 서로 다른 3개를 고른다
 *                 ① 종합 추천  ② 경사 최소  ③ 횡단보도 최소
 *
 * 사용법
 *   export TMAP_APP_KEY='발급받은_키'
 *   npx tsx poc.ts <위도> <경도> --km 5                        # rank 모드, 프리셋 FLAT
 *   npx tsx poc.ts <위도> <경도> --km 5 --preset FEW_CROSSINGS # FLAT | HILL | FEW_CROSSINGS | BALANCED
 *   npx tsx poc.ts <위도> <경도> --pace 6:00 --min 40          # 페이스 × 시간 → 거리로 변환
 *   npx tsx poc.ts <위도> <경도> --km 5 --pace 6:00            # 거리 + 페이스 → 예상 시간 표시
 *   npx tsx poc.ts <위도> <경도> --km 5 --mode pick            # 종합/경사 최소/횡단보도 최소
 *   (예전 형식 `poc.ts <위도> <경도> 5 FLAT` 도 된다)
 *
 * 선택 환경 변수
 *   POOL_SIZE           pick 모드의 후보 방향 수 (기본 6, 3~8). 많을수록 고를 폭이 넓지만 TMAP 호출이 늘어난다
 *   TMAP_SEARCH_OPTION  TMAP searchOption 값 (기본 '0'). 계단 제외 등은 TMAP 문서에서 값 확인 후 지정
 *   END_OFFSET_M        출발지=도착지 좌표가 TMAP에서 에러 나면 도착점을 북쪽으로 이 값(m)만큼 띄움
 *   HEADING_OFFSET      후보 방향을 이 값(도)만큼 회전 (다른 후보를 보고 싶을 때)
 *
 * 요청·응답은 .cache/ 에 저장되어 같은 입력은 API를 다시 부르지 않는다 (TMAP 하루 1,000건 보호).
 * 결과는 out/result.geojson (보여준 3개, 색 구분) · out/pool.geojson (전체 후보, 회색)
 * → geojson.io 에 끌어다 놓으면 지도로 확인할 수 있다.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  type LatLng,
  type ParsedRoute,
  type Preset,
  type Role,
  type TmapResponse,
  PRESET_WEIGHTS,
  ROLE_LABEL,
  calcElevationGain,
  destinationPoint,
  generateLoopWaypoints,
  haversineM,
  overlapRatio,
  parseTmapRoute,
  pickThree,
  resample,
  scoreCourse,
  targetDistanceM,
} from './web/src/lib/course/lib';

const TMAP_URL = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1';
const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
const SAMPLE_STEP_M = 50;
const CACHE_DIR = '.cache';
const OUT_DIR = 'out';

const APP_KEY = process.env.TMAP_APP_KEY;
const SEARCH_OPTION = process.env.TMAP_SEARCH_OPTION ?? '0';
const END_OFFSET_M = Number(process.env.END_OFFSET_M ?? 0);
const HEADING_OFFSET = Number(process.env.HEADING_OFFSET ?? 0);
const POOL_SIZE = Math.min(8, Math.max(3, Number(process.env.POOL_SIZE ?? 6)));

let tmapNetworkCalls = 0;
let elevationNetworkCalls = 0;

// ───────────────────────── 파일 캐시 ─────────────────────────

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  const file = `${CACHE_DIR}/${hash}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  const data = await fetcher();
  writeFileSync(file, JSON.stringify(data));
  return data;
}

// ───────────────────────── 외부 API ─────────────────────────

const round6 = (n: number) => Number(n.toFixed(6));

async function tmapPedestrian(start: LatLng, end: LatLng, waypoints: LatLng[]): Promise<TmapResponse> {
  const body = {
    startX: round6(start.lng),
    startY: round6(start.lat),
    endX: round6(end.lng),
    endY: round6(end.lat),
    passList: waypoints.map((p) => `${round6(p.lng)},${round6(p.lat)}`).join('_'),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    startName: 'start',
    endName: 'end',
    searchOption: SEARCH_OPTION,
  };

  // 캐시 키에는 appKey를 넣지 않는다 (키가 파일에 남지 않게)
  return cached(`tmap:${JSON.stringify(body)}`, async () => {
    tmapNetworkCalls++;
    const res = await fetch(TMAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', appKey: APP_KEY! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`TMAP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as TmapResponse;
  });
}

/** 좌표 배열을 100개씩 끊어 고도(m) 조회. Open-Meteo는 호출당 최대 100좌표. */
async function fetchElevations(points: LatLng[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const lat = chunk.map((p) => p.lat.toFixed(5)).join(',');
    const lng = chunk.map((p) => p.lng.toFixed(5)).join(',');
    const url = `${ELEVATION_URL}?latitude=${lat}&longitude=${lng}`;

    const data = await cached<{ elevation: number[] }>(`elev:${url}`, async () => {
      elevationNetworkCalls++;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as { elevation: number[] };
    });
    if (!Array.isArray(data.elevation) || data.elevation.length !== chunk.length) {
      throw new Error('Open-Meteo 응답 형식이 예상과 다릅니다');
    }
    out.push(...data.elevation);
  }
  return out;
}

// ───────────────────────── 후보 생성 ─────────────────────────

type Candidate = {
  heading: number;
  route: ParsedRoute;
  samples: LatLng[];
  elevations: number[];
  distanceM: number;
  gainM: number;
  lossM: number;
  rawGainM: number;
  crossings: number;
  stairs: number;
  overpasses: number;
  overlap: number;
};

async function buildCandidate(start: LatLng, targetM: number, heading: number): Promise<Candidate> {
  const end = END_OFFSET_M > 0 ? destinationPoint(start, 0, END_OFFSET_M) : start;

  // 거리가 목표의 ±10%를 벗어나면 보정계수 k를 고쳐 1회 재시도, 더 가까운 쪽을 택한다
  let k = 1.3;
  let best: ParsedRoute | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const waypoints = generateLoopWaypoints(start, targetM, heading, 4, k);
    const parsed = parseTmapRoute(await tmapPedestrian(start, end, waypoints));
    if (parsed.path.length < 2) throw new Error('TMAP 응답에 경로 좌표가 없습니다');
    if (!best || Math.abs(parsed.distanceM - targetM) < Math.abs(best.distanceM - targetM)) best = parsed;
    if (Math.abs(parsed.distanceM - targetM) / targetM <= 0.1) break;
    k *= parsed.distanceM / targetM; // 너무 길면 k를 키워 반지름을 줄인다
  }
  const route = best!;

  const samples = resample(route.path, SAMPLE_STEP_M);
  const elevations = await fetchElevations(samples);
  const { gain, loss } = calcElevationGain(elevations, 2);
  const { gain: rawGain } = calcElevationGain(elevations, 0);

  return {
    heading,
    route,
    samples,
    elevations,
    distanceM: route.distanceM,
    gainM: gain,
    lossM: loss,
    rawGainM: rawGain,
    crossings: route.crossings,
    stairs: route.stairs,
    overpasses: route.overpasses,
    overlap: overlapRatio(samples),
  };
}

// ───────────────────────── 실행 ─────────────────────────

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`${a} 뒤에 값이 필요합니다`);
      flags[a.slice(2)] = v;
      i++;
    } else pos.push(a);
  }
  return { pos, flags };
}

const USAGE = `사용법:
  npx tsx poc.ts <위도> <경도> --km 5 [--preset FLAT|HILL|FEW_CROSSINGS|BALANCED]
  npx tsx poc.ts <위도> <경도> --pace 6:00 --min 40
  npx tsx poc.ts <위도> <경도> --km 5 --pace 6:00   (예상 시간도 표시)
  npx tsx poc.ts <위도> <경도> --km 5 --mode pick   (종합 / 경사 최소 / 횡단보도 최소)`;

const RANK_COLORS = ['#2b8a3e', '#1971c2', '#e03131'];
type Shown = { title: string; item: Candidate; note: string | null; color: string };

const CIRCLED = ['①', '②', '③'];
const ROLE_COLOR: Record<Role, string> = { BEST: '#2b8a3e', MIN_GAIN: '#1971c2', MIN_CROSSINGS: '#e03131' };

async function main() {
  if (!APP_KEY) return fail('환경 변수 TMAP_APP_KEY 가 없습니다. export TMAP_APP_KEY=... 후 다시 실행하세요.');

  const { pos, flags } = parseArgs(process.argv.slice(2));
  // 예전 형식도 받아준다: poc.ts <위도> <경도> 5 FLAT  (= --km 5 --preset FLAT)
  if (flags.km === undefined && flags.pace === undefined && pos[2] !== undefined && Number.isFinite(Number(pos[2]))) {
    flags.km = pos[2];
  }
  if (flags.preset === undefined && pos[3] !== undefined && pos[3] in PRESET_WEIGHTS) flags.preset = pos[3];

  const lat = Number(pos[0]);
  const lng = Number(pos[1]);
  if (pos.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lng)) return fail(USAGE);

  let target: { distanceM: number; paceSecPerKm: number | null };
  try {
    target = targetDistanceM({
      km: flags.km !== undefined ? Number(flags.km) : undefined,
      pace: flags.pace,
      minutes: flags.min !== undefined ? Number(flags.min) : undefined,
    });
  } catch (e) {
    return fail(`${(e as Error).message}\n\n${USAGE}`);
  }

  const mode = flags.mode ?? 'rank';
  if (mode !== 'rank' && mode !== 'pick') return fail(`--mode 는 rank | pick 중 하나\n\n${USAGE}`);
  const preset = (flags.preset ?? 'FLAT') as Preset;
  if (!(preset in PRESET_WEIGHTS)) return fail(`--preset 은 ${Object.keys(PRESET_WEIGHTS).join(' | ')} 중 하나`);

  const start: LatLng = { lat, lng };
  const targetM = target.distanceM;
  const poolSize = mode === 'rank' ? 3 : POOL_SIZE;
  const headings = Array.from({ length: poolSize }, (_, i) => ((i * 360) / poolSize + HEADING_OFFSET) % 360);
  const scoreOf = (c: Candidate, p: Preset) =>
    scoreCourse(
      { distanceM: c.distanceM, targetM, gainM: c.gainM, crossings: c.crossings, stairs: c.stairs, overlap: c.overlap },
      p,
    );

  console.log(
    `출발 ${lat}, ${lng} · 목표 ${(targetM / 1000).toFixed(2)}km` +
      (flags.min ? ` (페이스 ${flags.pace} × ${flags.min}분)` : '') +
      ` · 모드 ${mode}` +
      (mode === 'rank' ? ` (프리셋 ${preset})` : '') +
      ` · 후보 ${poolSize}방향 · searchOption ${SEARCH_OPTION}\n`,
  );

  const pool: Candidate[] = [];
  for (const h of headings) {
    try {
      pool.push(await buildCandidate(start, targetM, h));
      process.stdout.write(`  방향 ${String(h).padStart(3)}° 완료\n`);
    } catch (e) {
      console.error(`  방향 ${h}° 실패: ${(e as Error).message}`);
    }
  }
  if (pool.length === 0) return fail('만들어진 후보가 없습니다.');

  let shown: Shown[];
  if (mode === 'pick') {
    const { picks, usedTolerance } = pickThree(pool, targetM, 0.1);
    if (usedTolerance > 0.1) {
      console.log(
        `\n※ 목표 거리 ±10% 안의 후보가 부족해 ` +
          (Number.isFinite(usedTolerance) ? `±${usedTolerance * 100}%` : '전체') +
          `까지 넓혀서 골랐어요.`,
      );
    }
    shown = picks.map((p) => ({
      title: `${CIRCLED[picks.indexOf(p)]} ${ROLE_LABEL[p.role]}`,
      item: p.item,
      note: p.note,
      color: ROLE_COLOR[p.role],
    }));
  } else {
    shown = [...pool]
      .sort((a, b) => scoreOf(a, preset) - scoreOf(b, preset))
      .map((c, i) => ({ title: `${i + 1}위`, item: c, note: null, color: RANK_COLORS[i] ?? '#868e96' }));
  }

  const timeText = (c: Candidate) =>
    target.paceSecPerKm === null ? '' : ` · 예상 ${Math.round(((c.distanceM / 1000) * target.paceSecPerKm) / 60)}분`;

  console.log('');
  for (const sh of shown) {
    const c = sh.item;
    const dev = ((c.distanceM - targetM) / targetM) * 100;
    console.log(`${sh.title}   (방향 ${c.heading}°)`);
    console.log(
      `   ${(c.distanceM / 1000).toFixed(2)}km (목표 대비 ${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%)${timeText(c)}`,
    );
    console.log(
      `   상승 ${Math.round(c.gainM)}m · 하강 ${Math.round(c.lossM)}m · 횡단보도 ${c.crossings}개 · 계단 ${c.stairs}개` +
        ` · 육교/지하 ${c.overpasses}개 · 겹침 ${(c.overlap * 100).toFixed(0)}%`,
    );
    if (sh.note) console.log(`   ※ ${sh.note}`);
    console.log('');
  }

  // 전체 후보 (디버그·튜닝용)
  const scorePreset: Preset = mode === 'rank' ? preset : 'BALANCED';
  console.log(`[전체 후보 ${pool.length}개]  점수 = ${scorePreset} 가중치 (낮을수록 좋음)`);
  console.table(
    pool.map((c) => {
      const idx = shown.findIndex((sh) => sh.item === c);
      return {
        방향: `${c.heading}°`,
        '거리(m)': Math.round(c.distanceM),
        '목표대비': `${(((c.distanceM - targetM) / targetM) * 100).toFixed(1)}%`,
        '상승(m)': Math.round(c.gainM),
        '상승_필터전(m)': Math.round(c.rawGainM),
        횡단보도: c.crossings,
        계단: c.stairs,
        겹침: `${(c.overlap * 100).toFixed(0)}%`,
        점수: Number(scoreOf(c, scorePreset).toFixed(2)),
        표시: idx >= 0 ? shown[idx].title : '',
      };
    }),
  );

  // 진단: 고도 잡음 점검. 임계값을 키워도 상승이 거의 안 줄면 진짜 오르막, 크게 줄면 DEM 잡음 비중이 크다.
  console.log('\n[진단] 임계값별 누적 상승(m) — 임계값(m)을 키울 때 크게 줄수록 잡음이 많다는 뜻');
  console.table(
    shown.map((sh) => {
      const e = sh.item.elevations;
      const row: Record<string, string | number> = {
        후보: sh.title,
        방향: `${sh.item.heading}°`,
        '고도 범위(m)': `${Math.min(...e).toFixed(0)} ~ ${Math.max(...e).toFixed(0)}`,
      };
      for (const t of [0, 2, 4, 6, 8]) row[`${t}m 이상`] = Math.round(calcElevationGain(e, t).gain);
      return row;
    }),
  );
  mkdirSync(OUT_DIR, { recursive: true });
  for (const c of pool) {
    let dist = 0;
    const lines = ['dist_m,lat,lng,elev_m'];
    c.samples.forEach((p, i) => {
      if (i > 0) dist += haversineM(c.samples[i - 1], p);
      lines.push(`${dist.toFixed(0)},${p.lat.toFixed(6)},${p.lng.toFixed(6)},${c.elevations[i]}`);
    });
    writeFileSync(`${OUT_DIR}/elevation-${c.heading}.csv`, lines.join('\n'));
  }
  console.log(`고도 프로파일: ${OUT_DIR}/elevation-<방향>.csv (거리, 좌표, 고도)`);

  // 검증용: 응답에 실제로 어떤 turnType 이 나오는지 (횡단보도 카운트가 맞는지 확인)
  const first = shown[0].item.route;
  console.log('\n[검증] 첫 번째 후보의 turnType 분포 :', first.turnTypeCounts);
  console.log('[검증] 첫 번째 후보의 facilityType 분포:', first.facilityTypeCounts);
  console.log('       → turnType 211~217 이 횡단보도로 세어집니다. 지도와 비교해 맞는지 확인하세요.');

  mkdirSync(OUT_DIR, { recursive: true });
  const lineFeature = (c: Candidate, props: Record<string, unknown>) => ({
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: c.route.path.map((p) => [p.lng, p.lat]) },
  });
  writeFileSync(
    `${OUT_DIR}/result.geojson`,
    JSON.stringify({
      type: 'FeatureCollection',
      features: shown.map((sh) =>
        lineFeature(sh.item, {
          title: sh.title,
          stroke: sh.color,
          'stroke-width': 4,
          distanceM: Math.round(sh.item.distanceM),
          gainM: Math.round(sh.item.gainM),
          crossings: sh.item.crossings,
        }),
      ),
    }),
  );
  writeFileSync(
    `${OUT_DIR}/pool.geojson`,
    JSON.stringify({
      type: 'FeatureCollection',
      features: pool.map((c) => lineFeature(c, { title: `${c.heading}°`, stroke: '#adb5bd', 'stroke-width': 2 })),
    }),
  );
  console.log(`\n지도 확인: ${OUT_DIR}/result.geojson (보여준 3개, 초록·파랑·빨강 순) / ${OUT_DIR}/pool.geojson (전체, 회색)`);
  console.log(`이번 실행 네트워크 호출: TMAP ${tmapNetworkCalls}회 (하루 1,000건 중), Open-Meteo ${elevationNetworkCalls}회 (캐시 적중분 제외)`);
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
