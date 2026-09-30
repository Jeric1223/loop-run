/**
 * 네트워크 없이 lib.ts 핵심 함수를 검증한다.
 * 실행: npx tsx selftest.ts
 */
import assert from 'node:assert/strict';
import {
  type LatLng,
  type TmapResponse,
  calcElevationGain,
  destinationPoint,
  generateLoopWaypoints,
  generateOneWayWaypoints,
  generateTurnaroundPoint,
  bearingDeg,
  haversineM,
  outAndBack,
  overlapRatio,
  parsePace,
  parseTmapRoute,
  pathLengthM,
  pickThree,
  resample,
  routeShape,
  scoreCourse,
  targetDistanceM,
  trimSpurs,
  type ParsedRoute,
} from './web/src/lib/course/lib';

const daejeon: LatLng = { lat: 36.3504, lng: 127.3845 };
const near = (actual: number, expected: number, tol: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: 기대 ${expected}±${tol}, 실제 ${actual}`);

// 1) 거리 계산: 북쪽으로 1000m 이동한 점까지 거리는 1000m
const north = destinationPoint(daejeon, 0, 1000);
near(haversineM(daejeon, north), 1000, 1, 'destinationPoint/haversine');

// 2) 재샘플링: 1000m 직선을 50m 간격 → 21개, 간격 ≈ 50m
const line = [daejeon, north];
const sampled = resample(line, 50);
assert.equal(sampled.length, 21, `샘플 수 ${sampled.length}`);
for (let i = 1; i < sampled.length; i++) near(haversineM(sampled[i - 1], sampled[i]), 50, 0.5, `간격 ${i}`);
near(pathLengthM(sampled), 1000, 1, '재샘플 후 총 길이');

// 3) 고도: 노이즈는 무시, 실제 오르내림만 인정
assert.deepEqual(calcElevationGain([0, 1, 0, 1, 0, 1, 0]), { gain: 0, loss: 0 }); // 1m 출렁임 = 노이즈
assert.deepEqual(calcElevationGain([0, 5, 0]), { gain: 5, loss: 5 });
assert.deepEqual(calcElevationGain([0, 1, 2, 3, 4, 5]), { gain: 4, loss: 0 }); // 완만한 오르막은 누적됨
assert.deepEqual(calcElevationGain([]), { gain: 0, loss: 0 });
assert.ok(calcElevationGain([0, 1, 0, 1, 0, 1, 0], 0).gain > 0, '필터 끄면 노이즈가 잡혀야 함');

// 4) 루프 경유지: 개수, 폴리라인 길이 = 목표/k, 출발점에서 원의 지름(2r) 이내
const targetM = 5000;
const k = 1.3;
for (const n of [2, 4]) {
  const sides = n + 1;
  const r = targetM / k / (2 * sides * Math.sin(Math.PI / sides));
  const wps = generateLoopWaypoints(daejeon, targetM, 0, n, k);
  assert.equal(wps.length, n);
  near(pathLengthM([daejeon, ...wps, daejeon]), targetM / k, 15, `루프 폴리라인 길이(경유지 ${n})`);
  for (const w of wps) {
    const d = haversineM(daejeon, w);
    assert.ok(d > 100 && d <= 2 * r + 1, `경유지 거리 ${d.toFixed(0)}m (r=${r.toFixed(0)}m)`);
  }
}
assert.equal(generateLoopWaypoints(daejeon, targetM, 0).length, 2, '기본 경유지는 2개');
const r = targetM / k / (2 * 5 * Math.sin(Math.PI / 5)); // 아래 5) 겹침 테스트용 반지름

// 5) 겹침: 깨끗한 원은 거의 0, 왕복은 거의 1
const center = destinationPoint(daejeon, 0, r);
const circle: LatLng[] = [];
for (let a = 180; a <= 540; a += 2) circle.push(destinationPoint(center, a, r)); // 출발점에서 한 바퀴
const circleSamples = resample(circle, 50);
const circleOverlap = overlapRatio(circleSamples);
assert.ok(circleOverlap < 0.1, `원 겹침 ${circleOverlap}`);

// 왕복은 출발·도착 구간과 되돌아가는 지점 근처가 제외되어 100%가 아니라 60% 안팎이 나온다
const oabLine = [...line, ...line.slice().reverse()];
const oabOverlap = overlapRatio(resample(oabLine, 50));
assert.ok(oabOverlap > 0.5, `왕복 겹침 ${oabOverlap}`);
assert.ok(oabOverlap > circleOverlap + 0.4, `왕복(${oabOverlap})과 원(${circleOverlap})이 구분되어야 함`);

// 6) TMAP 응답 해석: 횡단보도(211~217), 계단(127), 육교/지하(125/126) 카운트
const pt = (turnType: number, extra: Record<string, unknown> = {}) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [127.38, 36.35] as [number, number] },
  properties: { turnType, ...extra },
});
const ln = (coords: [number, number][], facilityType = '11') => ({
  type: 'Feature' as const,
  geometry: { type: 'LineString' as const, coordinates: coords },
  properties: { facilityType },
});
const fake: TmapResponse = {
  type: 'FeatureCollection',
  features: [
    pt(200, { totalDistance: 1234, totalTime: 900 }),
    ln([[127.38, 36.35], [127.381, 36.35]]),
    pt(211),
    ln([[127.381, 36.35], [127.382, 36.35]], '15'),
    pt(213),
    pt(127),
    pt(126),
    pt(12), // 좌회전 — 어느 것에도 안 세짐
    ln([[127.382, 36.35], [127.383, 36.351]]),
    pt(201),
  ],
};
const parsed = parseTmapRoute(fake);
assert.equal(parsed.crossings, 2);
assert.equal(parsed.stairs, 1);
assert.equal(parsed.overpasses, 1);
assert.equal(parsed.distanceM, 1234);
assert.equal(parsed.durationSec, 900);
assert.equal(parsed.path.length, 4); // 선분 경계의 중복 좌표는 제거됨
assert.deepEqual(parsed.facilityTypeCounts, { '11': 2, '15': 1 });

// 7) 목표 거리: 거리 직접 입력, 페이스 × 시간, 잘못된 입력
assert.equal(parsePace('6:00'), 360);
assert.equal(parsePace('5:30'), 330);
assert.throws(() => parsePace('6'), /m:ss/);
assert.throws(() => parsePace('1:00'), /범위/);
near(targetDistanceM({ km: 5 }).distanceM, 5000, 0.001, '5km 직접 입력');
near(targetDistanceM({ pace: '6:00', minutes: 40 }).distanceM, 6666.67, 0.01, '6:00 × 40분'); // 40 ÷ 6 = 6.67km
assert.equal(targetDistanceM({ km: 5, pace: '6:00' }).paceSecPerKm, 360); // 거리 우선, 페이스는 시간 표시용
assert.throws(() => targetDistanceM({}), /입력하세요/);
assert.throws(() => targetDistanceM({ km: 100 }), /범위/);
assert.throws(() => targetDistanceM({ km: 0.1 }), /범위/);

// 8) 후보 3개 고르기
const mk = (id: string, gainM: number, crossings: number, distanceM = 5000, stairs = 0, overlap = 0) => ({
  id, distanceM, gainM, crossings, stairs, overlap,
});
// 균형점수(BALANCED) 손계산: 10·편차 + 0.06·상승 + 0.5·횡단보도 + 1.5·계단 + 3·겹침
//   A 3.6 / B 4.68 / C 2.2 / D 3.22  → 종합 1위 = C
const A = mk('A', 10, 6), B = mk('B', 3, 9), C = mk('C', 20, 2), D = mk('D', 12, 5);
const E = mk('E', 0, 0, 8000); // 거리 +60%: 후보에서 제외되어야 함
{
  const { picks, usedTolerance } = pickThree([A, B, C, D, E], 5000);
  assert.equal(usedTolerance, 0.1);
  assert.deepEqual(picks.map((p) => [p.role, p.item.id]), [
    ['BEST', 'C'],          // 종합 1위
    ['MIN_GAIN', 'B'],      // 상승 3m 최소
    ['MIN_CROSSINGS', 'D'], // 횡단보도 최소는 C(2)인데 이미 뽑혀서 차순위 D(5)
  ]);
  assert.equal(picks[0].note, null);
  assert.equal(picks[1].note, null);
  assert.ok(picks[2].note?.includes('차순위'), '차순위 안내 문구');
  assert.ok(!picks.some((p) => p.item.id === 'E'), '거리 벗어난 후보는 선택 불가');
  assert.equal(new Set(picks.map((p) => p.item.id)).size, 3, '3개 모두 서로 다른 코스');
}
{
  // 모든 후보가 목표 대비 +15% → ±10%로는 3개가 안 되니 ±20%로 넓힘
  const wide = [mk('a', 5, 3, 5750), mk('b', 8, 2, 5750), mk('c', 2, 6, 5750)];
  const { picks, usedTolerance } = pickThree(wide, 5000);
  assert.equal(usedTolerance, 0.2);
  assert.equal(picks.length, 3);
}
{
  // 후보가 3개보다 적으면 있는 만큼만
  assert.equal(pickThree([mk('x', 1, 1), mk('y', 2, 2)], 5000).picks.length, 2);
  assert.equal(pickThree([mk('x', 1, 1)], 5000).picks.length, 1);
  assert.equal(pickThree([] as ReturnType<typeof mk>[], 5000).picks.length, 0);
}
{
  // 한 코스가 세 기준 모두 1위여도 3개는 서로 달라야 한다
  const dominant = mk('dom', 1, 1);
  const others = [mk('o1', 10, 5), mk('o2', 12, 6)];
  const { picks } = pickThree([dominant, ...others], 5000);
  assert.equal(picks[0].item.id, 'dom');
  assert.equal(new Set(picks.map((p) => p.item.id)).size, 3);
  assert.ok(picks[1].note && picks[2].note, '2, 3번은 차순위 안내가 붙어야 함');
}

// 편도: 경유지를 지난 폴리라인 길이가 목표/보정계수와 맞고, 좌·우 방향이 서로 반대편이며, 여유가 없으면 직행
{
  const s0 = daejeon;
  const e0 = destinationPoint(daejeon, 90, 1500); // 동쪽 1.5km
  const target = 5000;
  const left = generateOneWayWaypoints(s0, e0, target, 0, 1.3);
  const right = generateOneWayWaypoints(s0, e0, target, 240, 1.3);
  assert.equal(left.length, 2);
  near(pathLengthM([s0, ...left, e0]), target / 1.3, 20, '편도 폴리라인 길이');
  near(pathLengthM([s0, ...right, e0]), target / 1.3, 20, '편도 폴리라인 길이(반대편)');
  // 동쪽으로 가는 축 기준, 왼쪽은 북쪽(+lat), 오른쪽은 남쪽(-lat)
  assert.ok(left[0].lat > s0.lat && right[0].lat < s0.lat, '좌·우 경유지가 반대편에 있어야 함');
  // 경유지 순서는 출발 쪽 → 도착 쪽
  assert.ok(left[0].lng < left[1].lng, '경유지 순서');
  assert.deepEqual(generateOneWayWaypoints(s0, e0, 1800, 0, 1.3), [], '목표가 직행과 비슷하면 직행');
  // 후보 방향 6개는 서로 다른 경유지 6세트여야 한다 (편도 후보가 전부 같은 코스로 나오던 문제)
  const sets = [0, 60, 120, 180, 240, 300].map((h) => generateOneWayWaypoints(s0, e0, target, h, 1.3));
  assert.equal(new Set(sets.map((w) => w.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|'))).size, 6, '편도 경유지 6세트가 모두 달라야 함');
  for (const w of sets) near(pathLengthM([s0, ...w, e0]), target / 1.3, 20, '편도 변형별 길이');
}

// 9) 경로 모양: 직선은 꺾임 0·직진 100%, 왕복은 돌출, 사각형은 회전 4
{
  const straight = resample([daejeon, destinationPoint(daejeon, 90, 2000)], 20);
  const sh = routeShape(straight);
  assert.equal(sh.turnsPerKm, 0);
  assert.ok(sh.straightRatio > 0.95 && sh.spurRatio === 0, `직선 ${JSON.stringify(sh)}`);

  // 루프 중간에 300m 갔다 오는 돌출
  const a = destinationPoint(daejeon, 90, 1000);
  const spurTip = destinationPoint(a, 0, 300);
  const withSpur = resample([daejeon, a, spurTip, a, destinationPoint(a, 90, 1000)], 20);
  const sp = routeShape(withSpur);
  near(sp.spurRatio, 600 / 2600, 0.05, '돌출 비율');
  assert.ok(routeShape(circle).spurRatio === 0, '원형 루프는 돌출이 아니다');

  // 한 변 500m 사각형 한 바퀴: 모서리 4개(출발점 제외 3개 + 닫힘)
  const c1 = destinationPoint(daejeon, 90, 500);
  const c2 = destinationPoint(c1, 0, 500);
  const c3 = destinationPoint(daejeon, 0, 500);
  const sq = routeShape(resample([daejeon, c1, c2, c3, daejeon], 20));
  assert.ok(sq.turnsPerKm >= 1 && sq.turnsPerKm <= 2.5, `사각형 회전 ${sq.turnsPerKm}/km`);
  assert.ok(sq.spurRatio === 0);

  // pickThree: 돌출 큰 후보는 3개가 남는 한 제외된다
  const spurry = { ...mk('S', 0, 0), spur: 0.3 };
  const okA = { ...mk('a', 10, 3), spur: 0 }, okB = { ...mk('b', 12, 4), spur: 0.02 }, okC = { ...mk('c', 14, 5), spur: 0.05 };
  const p1 = pickThree([spurry, okA, okB, okC], 5000).picks;
  assert.ok(!p1.some((x) => x.item.id === 'S'), '돌출 후보 제외');
  const p2 = pickThree([spurry, okA, okB], 5000).picks; // 깨끗한 후보가 3개 미만이면 돌출 후보도 쓴다
  assert.equal(p2.length, 3);
}

// 10) 돌출 잘라내기: 경로는 이어지고 거리·횡단보도가 줄어든다
{
  const a = destinationPoint(daejeon, 90, 1000);
  const tip = destinationPoint(a, 0, 300);
  const end = destinationPoint(a, 90, 1000);
  const path = resample([daejeon, a, tip, a, end], 20);
  const mk2 = (kind: 'crossing' | 'stairs', at: LatLng) => ({ kind, at });
  const route: ParsedRoute = {
    path,
    distanceM: 2700,
    durationSec: 1000,
    crossings: 2,
    stairs: 0,
    overpasses: 0,
    marks: [mk2('crossing', tip), mk2('crossing', destinationPoint(a, 90, 500))],
    calm: 0,
    poor: 0,
    turnTypeCounts: {},
    facilityTypeCounts: {},
  };
  const t = trimSpurs(route);
  near(pathLengthM(t.path), 2000, 40, '돌출 제거 후 길이');
  assert.equal(t.crossings, 1, '돌출 끝의 횡단보도는 빠지고 본 경로의 것만 남는다');
  assert.ok(t.distanceM < route.distanceM && t.distanceM > 1800, `거리 ${t.distanceM}`);
  assert.ok(routeShape(t.path).spurRatio < 0.02, '자른 뒤에는 돌출이 없다');
  for (let i = 1; i < t.path.length; i++) assert.ok(haversineM(t.path[i - 1], t.path[i]) < 60, '경로가 끊기지 않는다');
  // 돌출이 없으면 그대로, 전체가 왕복이면 자르지 않는다
  assert.equal(trimSpurs({ ...route, path: resample([daejeon, a], 20), marks: [] }).path.length, resample([daejeon, a], 20).length);
  const oab = { ...route, path: resample([daejeon, a, daejeon], 20), marks: [] };
  assert.equal(trimSpurs(oab), oab, '전체가 왕복이면 원본 유지');
}

// 11) 반환 코스: 편도 목적지는 목표의 절반 거리, 경로는 절반 지점에서 잘라 되돌아온다
{
  const tp = generateTurnaroundPoint(daejeon, 5000, 90);
  near(haversineM(daejeon, tp), 2500, 1, '편도 목적지 거리');
  near(bearingDeg(daejeon, tp), 90, 0.5, '편도 목적지 방향');

  // 폴리라인 3000m, TMAP 거리 3300m(비율 1.1) 인 편도 → 목표 5000m 이면 폴리라인 약 2273m 지점에서 반환
  const a = destinationPoint(daejeon, 90, 1500);
  const b = destinationPoint(a, 0, 1500);
  const path = resample([daejeon, a, b], 20);
  const route: ParsedRoute = {
    path,
    distanceM: 3300,
    durationSec: 2400,
    crossings: 2,
    stairs: 1,
    overpasses: 0,
    marks: [
      { kind: 'crossing', at: destinationPoint(daejeon, 90, 700) },
      { kind: 'stairs', at: destinationPoint(a, 0, 500) },
      { kind: 'crossing', at: destinationPoint(a, 0, 1400) }, // 반환점 너머 → 빠진다
    ],
    calm: 0,
    poor: 0,
    turnTypeCounts: {},
    facilityTypeCounts: {},
  };
  const o = outAndBack(route, 5000);
  near(o.distanceM, 5000, 5, '반환 코스 거리');
  near(o.durationSec, 2400 * (5000 / 3300), 5, '반환 코스 소요시간');
  assert.equal(o.crossings, 2, '반환점 앞 횡단보도 1개 × 왕복');
  assert.equal(o.stairs, 2, '반환점 앞 계단 1개 × 왕복');
  assert.equal(haversineM(o.path[0], daejeon), 0, '출발점에서 시작');
  assert.equal(haversineM(o.path[o.path.length - 1], daejeon), 0, '출발점으로 돌아온다');
  const tip = o.path[(o.path.length - 1) / 2];
  near(haversineM(a, tip), 2273 - 1500, 5, '반환점은 경로 위 절반 지점');
  for (let i = 1; i < o.path.length; i++) assert.ok(haversineM(o.path[i - 1], o.path[i]) < 25, '경로가 끊기지 않는다');
  // 편도가 목표 절반보다 짧으면 끝까지 갔다 온다
  near(outAndBack(route, 10000).distanceM, 6600, 5, '짧은 편도는 끝까지 왕복');
}

// 12) roadType: 23(차량 통행 불가)·24(쾌적하지 않음) 구간 비율, 점수 반영
{
  const rl = (coords: [number, number][], roadType: number) => ({
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: coords },
    properties: { facilityType: '11', roadType },
  });
  const r = parseTmapRoute({
    type: 'FeatureCollection',
    features: [
      rl([[127.38, 36.35], [127.381, 36.35]], 23), // 약 90m
      rl([[127.381, 36.35], [127.382, 36.35]], 21), // 약 90m
      rl([[127.382, 36.35], [127.383, 36.35]], 24), // 약 90m
      rl([[127.383, 36.35], [127.384, 36.35]], 23), // 약 90m
    ],
  });
  near(r.calm, 0.5, 0.01, 'calm 비율');
  near(r.poor, 0.25, 0.01, 'poor 비율');
  const base = { distanceM: 5000, targetM: 5000, gainM: 0, crossings: 0, stairs: 0, overlap: 0 };
  assert.ok(scoreCourse({ ...base, calm: 0.8 }, 'BALANCED') < scoreCourse(base, 'BALANCED'), '보행자도로가 많으면 점수가 낮다(좋다)');
  assert.ok(scoreCourse({ ...base, poor: 0.5 }, 'BALANCED') > scoreCourse(base, 'BALANCED'), '쾌적하지 않은 도로가 많으면 점수가 높다');
}

console.log('selftest 통과 ✔');
