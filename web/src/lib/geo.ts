export type Fix = { lat: number; lng: number; accuracy: number };
export type GeoFailure = "denied" | "unavailable" | "timeout";

/** 이 값(m)보다 넓으면 "정확도 낮음" 경고를 띄운다 */
export const LOW_ACCURACY_M = 50;

export function getPosition(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject("unavailable" satisfies GeoFailure);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject((e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable") satisfies GeoFailure),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

/** Permissions API 를 못 쓰는 브라우저(구형 Safari 등)는 "unsupported" */
export async function permissionState(): Promise<PermissionState | "unsupported"> {
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    return "unsupported";
  }
}
