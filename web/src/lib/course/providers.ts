import { cached, type CacheStore } from "./cache";
import type { LatLng, TmapResponse } from "./lib";

const TMAP_URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";
const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
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
    passList: waypoints.map((p) => `${round6(p.lng)},${round6(p.lat)}`).join("_"),
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
    return (await res.json()) as TmapResponse;
  });
}

/** 좌표를 100개씩 끊어 고도(m) 조회. Open-Meteo 는 호출당 최대 100좌표 */
export async function fetchElevations(store: CacheStore, counter: CallCounter, points: LatLng[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const lat = chunk.map((p) => p.lat.toFixed(5)).join(",");
    const lng = chunk.map((p) => p.lng.toFixed(5)).join(",");
    const url = `${ELEVATION_URL}?latitude=${lat}&longitude=${lng}`;

    const data = await cached<{ elevation: number[] }>(store, `elev:${url}`, async () => {
      counter.elevation++;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new UpstreamError("elevation", `Open-Meteo ${res.status}`);
      return (await res.json()) as { elevation: number[] };
    });
    if (!Array.isArray(data.elevation) || data.elevation.length !== chunk.length) {
      throw new UpstreamError("elevation", "Open-Meteo 응답 형식이 예상과 다릅니다");
    }
    out.push(...data.elevation);
  }
  return out;
}
