import { inflateSync } from "node:zlib";
import { cached, type CacheStore } from "./cache";
import type { LatLng, TmapResponse } from "./lib";

const TMAP_URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";
// AWS Open Data 의 Terrain Tiles (Terrarium 인코딩 PNG). 키·호출 한도가 없고 타일 단위라 캐시가 잘 먹는다
const TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const TERRAIN_ZOOM = 13; // 위도 36° 에서 픽셀당 약 15m, 타일 한 장이 약 3.9km
const TILE = 256;
const round6 = (n: number) => Number(n.toFixed(6));

/** 외부 API 호출 횟수 (캐시 적중분 제외). 한도 관리용 */
export type CallCounter = { tmap: number; elevation: number };

/** 사용자에게 보여줄 수 있는 원인 구분 */
export class UpstreamError extends Error {
  constructor(
    readonly kind: "tmap-quota" | "tmap" | "elevation" | "config",
    message: string,
  ) {
    super(message);
  }
}

export async function tmapPedestrian(
  store: CacheStore,
  counter: CallCounter,
  start: LatLng,
  end: LatLng,
  waypoints: LatLng[],
): Promise<TmapResponse> {
  const appKey = process.env.TMAP_APP_KEY;
  if (!appKey) throw new UpstreamError("config", "TMAP_APP_KEY 가 설정되지 않았어요");

  const body = {
    startX: round6(start.lng),
    startY: round6(start.lat),
    endX: round6(end.lng),
    endY: round6(end.lat),
    // 빈 문자열("")을 보내면 400(code 1100)이라 경유지가 없을 때는 필드를 뺀다
    ...(waypoints.length > 0 && { passList: waypoints.map((p) => `${round6(p.lng)},${round6(p.lat)}`).join("_") }),
    reqCoordType: "WGS84GEO",
    resCoordType: "WGS84GEO",
    startName: "start",
    endName: "end",
    searchOption: process.env.TMAP_SEARCH_OPTION ?? "0",
  };

  // 캐시 키에 appKey 를 넣지 않는다
  return cached(store, `tmap:${JSON.stringify(body)}`, async () => {
    counter.tmap++;
    const res = await fetch(TMAP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", appKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) throw new UpstreamError("tmap-quota", "TMAP 호출 한도를 넘었어요");
    if (!res.ok) throw new UpstreamError("tmap", `TMAP ${res.status}`);
    // 장소명 등에 JSON 에 넣을 수 없는 제어문자가 섞여 오는 경우가 있어 제거 후 파싱한다
    return JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, " ")) as TmapResponse;
  });
}

/** 좌표별 고도(m). 필요한 타일만 받아 픽셀을 쌍선형 보간한다 */
export async function fetchElevations(_store: CacheStore, counter: CallCounter, points: LatLng[]): Promise<number[]> {
  const n = 2 ** TERRAIN_ZOOM;
  const px = points.map((p) => ({
    x: ((p.lng + 180) / 360) * n * TILE,
    y: ((1 - Math.asinh(Math.tan((p.lat * Math.PI) / 180)) / Math.PI) / 2) * n * TILE,
  }));
  // 보간에 쓰는 이웃 픽셀이 옆 타일에 걸칠 수 있어 x+1, y+1 쪽 타일까지 모은다
  const keys = new Set<string>();
  for (const { x, y } of px) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      keys.add(`${Math.floor((Math.floor(x) + dx) / TILE)}/${Math.floor((Math.floor(y) + dy) / TILE)}`);
    }
  }
  const tiles = new Map(await Promise.all([...keys].map(async (k) => [k, await terrainTile(counter, k)] as const)));

  const at = (ix: number, iy: number) => {
    const tile = tiles.get(`${Math.floor(ix / TILE)}/${Math.floor(iy / TILE)}`)!;
    return tile[(iy % TILE) * TILE + (ix % TILE)];
  };
  return px.map(({ x, y }) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  });
}

// 디코딩한 타일은 JSON 캐시(CacheStore)에 넣기엔 커서(6.5만 값) 프로세스 메모리에만 둔다. 한 장 약 256KB
const TILE_CACHE_MAX = 64;
const tileCache = new Map<string, Promise<Float32Array>>();

function terrainTile(counter: CallCounter, key: string): Promise<Float32Array> {
  const hit = tileCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    counter.elevation++;
    // 후보를 병렬로 만들 때 순간 호출이 몰려 가끔 실패하므로 한 번만 더 시도한다
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${TERRAIN_URL}/${TERRAIN_ZOOM}/${key}.png`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (res?.ok) return decodeTerrarium(Buffer.from(await res.arrayBuffer()));
      if (attempt === 1) throw new UpstreamError("elevation", `Terrain tile ${res ? res.status : "network"}`);
      await new Promise((r) => setTimeout(r, 600));
    }
  })();
  if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value!);
  tileCache.set(key, p);
  p.catch(() => tileCache.delete(key)); // 실패한 타일은 다음 요청에서 다시 받는다
  return p;
}

/** Terrarium PNG(256×256, 8bit RGB) → 고도 = R×256 + G + B/256 − 32768 */
function decodeTerrarium(png: Buffer): Float32Array {
  let pos = 8; // PNG 시그니처
  let width = 0;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      // 비트 깊이 8, 컬러 타입 2(RGB), 인터레이스 없음만 지원
      if (width !== TILE || data.readUInt32BE(4) !== TILE || data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        throw new UpstreamError("elevation", "Terrain tile 형식이 예상과 다릅니다");
      }
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (width === 0) throw new UpstreamError("elevation", "Terrain tile 형식이 예상과 다릅니다");

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = TILE * bpp;
  const out = new Float32Array(TILE * TILE);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < TILE; y++) {
    const filter = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) line[i] += a;
      else if (filter === 2) line[i] += b;
      else if (filter === 3) line[i] += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
    }
    for (let x = 0; x < TILE; x++) {
      out[y * TILE + x] = line[x * 3] * 256 + line[x * 3 + 1] + line[x * 3 + 2] / 256 - 32768;
    }
    prev = line;
  }
  return out;
}
