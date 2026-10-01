/* 카카오맵 JS SDK 의 services 라이브러리(장소 검색·역지오코딩)만 쓴다. JS 키는 도메인 제한이 걸린 공개 키 */

type KakaoPlace = { place_name: string; address_name: string; road_address_name: string; x: string; y: string };
type Status = "OK" | "ZERO_RESULT" | "ERROR";
export type KLatLng = { getLat: () => number; getLng: () => number };
export type KPoint = { x: number; y: number };
export type KOverlay = { setMap: (m: KMap | null) => void; setPosition?: (p: KLatLng) => void };
export type KPolyline = KOverlay & { setOptions: (o: object) => void };
export type KMap = {
  getCenter: () => KLatLng;
  setCenter: (c: KLatLng) => void;
  setBounds: (b: unknown, top?: number, right?: number, bottom?: number, left?: number) => void;
  relayout: () => void;
  panBy: (dx: number, dy: number) => void;
  setLevel: (level: number) => void;
  /** 위·경도 ↔ 지도 컨테이너 픽셀 — 줌과 상관없이 일정한 픽셀 간격을 띄울 때 쓴다 */
  getProjection: () => { containerPointFromCoords: (c: KLatLng) => KPoint; coordsFromContainerPoint: (p: KPoint) => KLatLng };
};
type Kakao = {
  maps: {
    load: (cb: () => void) => void;
    Map: new (el: HTMLElement, opt: { center: KLatLng; level: number }) => KMap;
    LatLng: new (lat: number, lng: number) => KLatLng;
    LatLngBounds: new () => { extend: (p: KLatLng) => void };
    Point: new (x: number, y: number) => KPoint;
    Polyline: new (opt: object) => KPolyline;
    CustomOverlay: new (opt: { position: KLatLng; content: HTMLElement; yAnchor?: number; zIndex?: number }) => KOverlay;
    event: { addListener: (t: unknown, name: string, cb: () => void) => void };
    services: {
      Status: { OK: Status };
      Places: new () => { keywordSearch: (q: string, cb: (r: KakaoPlace[], s: Status) => void, opt?: object) => void };
      Geocoder: new () => {
        coord2Address: (
          lng: number,
          lat: number,
          cb: (r: { address: { address_name: string }; road_address: { address_name: string; building_name: string } | null }[], s: Status) => void,
        ) => void;
      };
    };
  };
};

export type PlaceHit = { name: string; address: string; lat: number; lng: number };

let loading: Promise<Kakao> | null = null;

export function loadKakao(): Promise<Kakao> {
  if (loading) return loading;
  const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
  const p = new Promise<Kakao>((resolve, reject) => {
    if (!key) return reject(new Error("NEXT_PUBLIC_KAKAO_JS_KEY 없음"));
    const w = window as unknown as { kakao?: Kakao };
    const ready = () => w.kakao!.maps.load(() => resolve(w.kakao!));
    if (w.kakao?.maps) return ready();
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`;
    s.onload = ready;
    s.onerror = () => reject(new Error("카카오 SDK 로드 실패"));
    document.head.appendChild(s);
  });
  // 실패하면 다음 호출에서 다시 시도할 수 있게 캐시를 비운다
  loading = p.catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** 한국 내 장소·주소 검색. 결과가 없으면 빈 배열 */
export async function searchPlaces(query: string): Promise<PlaceHit[]> {
  const k = await loadKakao();
  return new Promise((resolve, reject) => {
    new k.maps.services.Places().keywordSearch(query, (r, status) => {
      if (status === k.maps.services.Status.OK) {
        resolve(r.map((p) => ({ name: p.place_name, address: p.road_address_name || p.address_name, lat: Number(p.y), lng: Number(p.x) })));
      } else if (status === "ZERO_RESULT") resolve([]);
      else reject(new Error("장소 검색 실패"));
    });
  });
}

/** 좌표 → 도로명/지번 주소. 못 찾으면 null */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const k = await loadKakao();
  return new Promise((resolve) => {
    new k.maps.services.Geocoder().coord2Address(lng, lat, (r, status) => {
      if (status !== k.maps.services.Status.OK || !r[0]) return resolve(null);
      resolve(r[0].road_address?.address_name || r[0].address.address_name);
    });
  });
}
