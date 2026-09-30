import { clamp } from "@/lib/format";

/* 홈 화면 상태 — docs/design/shared/core.js 의 S 객체·act() 중 홈에 해당하는 부분 */

export type GoalMode = "dist" | "pace";
export type PickerKey = "pace" | "pp" | "min";
export type Place = { kind: "gps" | "pin" | "search"; name: string; lat?: number; lng?: number };

export type HomeState = {
  mode: GoalMode;
  /** 거리 모드 목표 (km, 0.5 단위) */
  km: number;
  /** 거리 모드의 선택 입력 페이스 (초/km). null 이면 예상 시간 숨김 */
  pace: number | null;
  /** 페이스·시간 모드 페이스 (초/km) */
  pPace: number;
  /** 페이스·시간 모드 시간 (분) */
  min: number;
  /** 열려 있는 숫자 목록 */
  pk: PickerKey | null;
  start: Place;
  /** null 이면 출발점으로 돌아오는 왕복 */
  end: Place | null;
  /** GPS 정확도 등급 */
  acc: "ok" | "low";
  /** GPS 정확도 반경 (m). 측정 전이면 null */
  accM: number | null;
};

export const KM_MIN = 0.5;
export const KM_MAX = 30;
const PACE_MIN = 150;
const PACE_MAX = 1200;
const DEFAULT_PACE = 360;

export const initialHomeState: HomeState = {
  mode: "dist",
  km: 5,
  pace: null,
  pPace: 270,
  min: 30,
  pk: null,
  // 좌표가 없으면 아직 위치를 측정하지 않은 상태 (코스 만들기 때 측정)
  start: { kind: "gps", name: "" },
  end: null,
  acc: "ok",
  accM: null,
};

export type HomeAction =
  | { type: "km"; delta: number }
  | { type: "setKm"; km: number }
  | { type: "pace"; delta: number }
  | { type: "pPace"; delta: number }
  | { type: "min"; delta: number }
  | { type: "mode"; mode: GoalMode }
  | { type: "paceOn" }
  | { type: "paceOff" }
  | { type: "togglePk"; pk: PickerKey }
  | { type: "closePk" }
  | { type: "pickValue"; pk: PickerKey; value: number }
  | { type: "endClear" }
  | { type: "setPlace"; target: "start" | "end"; place: Place }
  | { type: "startName"; name: string }
  | { type: "setLocation"; lat: number; lng: number; accuracy: number; low: boolean };

const clampPace = (v: number) => clamp(v, PACE_MIN, PACE_MAX);

export function homeReducer(s: HomeState, a: HomeAction): HomeState {
  switch (a.type) {
    case "km":
      return { ...s, km: clamp(Math.round((s.km + a.delta) * 2) / 2, KM_MIN, KM_MAX) };
    case "setKm":
      return { ...s, km: clamp(a.km, KM_MIN, KM_MAX) };
    case "pace":
      return s.pace == null ? s : { ...s, pace: clampPace(s.pace + a.delta) };
    case "pPace":
      return { ...s, pPace: clampPace(s.pPace + a.delta) };
    case "min":
      return { ...s, min: clamp(s.min + a.delta, 5, 300) };
    case "mode":
      return { ...s, mode: a.mode, pk: null };
    case "paceOn":
      return { ...s, pace: DEFAULT_PACE };
    case "paceOff":
      return { ...s, pace: null, pk: null };
    case "togglePk":
      return { ...s, pk: s.pk === a.pk ? null : a.pk };
    case "closePk":
      return { ...s, pk: null };
    case "pickValue":
      if (a.pk === "pace") return { ...s, pace: a.value, pk: null };
      if (a.pk === "pp") return { ...s, pPace: a.value, pk: null };
      return { ...s, min: a.value, pk: null };
    case "setPlace":
      return a.target === "start" ? { ...s, start: a.place, acc: "ok", accM: null } : { ...s, end: a.place };
    case "startName":
      return s.start.kind === "gps" ? { ...s, start: { ...s.start, name: a.name } } : s;
    case "endClear":
      return { ...s, end: null };
    case "setLocation":
      return {
        ...s,
        start: { kind: "gps", name: `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}`, lat: a.lat, lng: a.lng },
        acc: a.low ? "low" : "ok",
        accM: Math.round(a.accuracy),
      };
  }
}

/** 목표 거리 (m) */
export const targetM = (s: HomeState) => (s.mode === "pace" ? ((s.min * 60) / s.pPace) * 1000 : s.km * 1000);

/** 서버에 보낼 페이스 (초/km). 거리 모드에선 선택 입력, 페이스·시간 모드에선 항상 있음 */
export const activePace = (s: HomeState) => (s.mode === "pace" ? s.pPace : s.pace);
