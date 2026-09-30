import type { CourseResult } from "./build";

/* 지도 SDK 연동 전까지 쓰는 임시 투영 — 좌표를 390×400 SVG 안에 맞춰 넣는다 */
export const MAP_W = 390;
export const MAP_H = 400;
// 위쪽은 버튼(목표 바꾸기·목표 칩), 아래는 시트에 가려지므로 여백을 더 둔다
const PAD = { top: 76, bottom: 64, x: 40 };

type LL = { lat: number; lng: number };
export type Projected = {
  paths: string[];
  pins: [number, number][];
  start: [number, number];
  end: [number, number] | null;
};

export function projectCourses(courses: CourseResult[], start: LL, end: LL | null): Projected {
  const cos = Math.cos((start.lat * Math.PI) / 180);
  // 위도·경도를 미터에 가깝게 맞춘 평면 좌표 (x 동쪽+, y 북쪽+)
  const plane = (lat: number, lng: number): [number, number] => [(lng - start.lng) * cos * 111_320, (lat - start.lat) * 110_540];

  const pts = courses.map((c) => c.path.map(([lat, lng]) => plane(lat, lng)));
  const startP = plane(start.lat, start.lng);
  const endP = end ? plane(end.lat, end.lng) : null;
  const all = [...pts.flat(), startP, ...(endP ? [endP] : [])];

  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
  const availW = MAP_W - PAD.x * 2, availH = MAP_H - PAD.top - PAD.bottom;
  const k = Math.min(availW / w, availH / h);
  const offX = PAD.x + (availW - w * k) / 2;
  const offY = PAD.top + (availH - h * k) / 2;
  const toXY = (p: [number, number]): [number, number] => [
    Math.round((offX + (p[0] - minX) * k) * 10) / 10,
    Math.round((offY + (maxY - p[1]) * k) * 10) / 10, // SVG 의 y 는 아래로 커진다
  ];

  const xy = pts.map((path) => path.map(toXY));
  return {
    paths: xy.map((path) => path.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("")),
    // 핀은 코스마다 다른 지점에 둬서 겹치지 않게 한다
    pins: xy.map((path, i) => path[Math.min(path.length - 1, Math.floor(path.length * (0.22 + i * 0.28)))]),
    start: toXY(startP),
    end: endP ? toXY(endP) : null,
  };
}
