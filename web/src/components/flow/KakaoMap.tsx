"use client";

import { useEffect, useRef, useState } from "react";
import type { CourseResult } from "@/lib/course/build";
import { loadKakao, type KLatLng, type KMap, type KOverlay, type KPolyline } from "@/lib/kakao";
import { pointAt, type CourseSlope } from "@/lib/course/slope";
import { levelHex, readRamp } from "./slopeColor";

type LL = { lat: number; lng: number };

/** CSS 색(oklch 등)을 카카오가 받는 #rrggbb 로 바꾼다 — canvas 가 파싱해 준다 */
function cssColor(varName: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const SUBDIV = 4; // 구간 하나를 이만큼 쪼개 색을 이어 붙인다 (그라데이션처럼 보이게)
const OFFSET_PX = 4; // 같은 길을 오가는 구간은 진행 방향 오른쪽으로 이만큼 비켜 두 줄로 그린다
const CHEVRON_M = 260; // 방향 화살표 간격 — 촘촘하면 지저분해 보여서 드문드문
const CHEVRON_SVG = '<svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><path d="M1.2 5.6 4 2.4l2.8 3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const STYLES = ["solid", "shortdash", "dot"] as const; // ① 실선 ② 파선 ③ 점선

function badge(cls: string, text: string, onClick?: () => void) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

/** 결과 지도: 코스 경로 3개(선택 안 된 것은 회색) + 번호 핀 + 출발/도착.
   선택된 코스는 경사 색 그라데이션·진행 방향 화살표·왕복 겹침 이중선·언덕 배지를 얹는다.
   SDK 로드에 실패하면 onFail 로 알려 SVG 지도로 대체한다 */
export function KakaoCourseMap({
  courses,
  slopes,
  start,
  end,
  sel,
  scrub,
  onSelect,
  onFail,
}: {
  courses: CourseResult[];
  slopes: (CourseSlope | null)[];
  start: LL;
  end: LL | null;
  sel: number;
  scrub: number | null;
  onSelect: (i: number) => void;
  onFail: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const lines = useRef<KPolyline[]>([]);
  const casings = useRef<KPolyline[]>([]);
  const pins = useRef<HTMLElement[]>([]);
  const dot = useRef<KOverlay | null>(null);
  const kakao = useRef<Awaited<ReturnType<typeof loadKakao>> | null>(null);
  const mapRef = useRef<KMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const onFailRef = useRef(onFail);
  const [ready, setReady] = useState(false);
  // 줌·테마가 바뀌면 올 때마다 올려서 경사 오버레이를 다시 그린다
  const [tick, setTick] = useState(0);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onFailRef.current = onFail;
  });

  useEffect(() => {
    let dead = false;
    const made: { setMap: (m: null) => void }[] = [];
    loadKakao()
      .then((k) => {
        if (dead || !box.current) return;
        const pt = (p: LL) => new k.maps.LatLng(p.lat, p.lng);
        const map: KMap = new k.maps.Map(box.current, { center: pt(start), level: 5 });
        kakao.current = k;
        mapRef.current = map;
        const bounds = new k.maps.LatLngBounds();
        bounds.extend(pt(start));
        if (end) bounds.extend(pt(end));

        courses.forEach((c, i) => {
          const path = c.path.map(([lat, lng]) => pt({ lat, lng }));
          path.forEach((p) => bounds.extend(p));
          // 흰 테두리를 먼저 깔아 지도 위에서 경로가 또렷하게 보이게 한다
          const casing = new k.maps.Polyline({ map, path, strokeWeight: 9, strokeColor: cssColor("--map-casing"), strokeOpacity: 0.7, zIndex: 0 });
          casings.current.push(casing);
          made.push(casing);
          const line = new k.maps.Polyline({ map, path, strokeWeight: 5, strokeColor: cssColor("--map-unsel"), strokeOpacity: 0.85, strokeStyle: STYLES[i], zIndex: 1 });
          lines.current.push(line);
          made.push(line);
          const at = c.path[Math.min(c.path.length - 1, Math.floor(c.path.length * (0.35 + i * 0.22)))];
          const el = badge("kpin", String(i + 1), () => onSelectRef.current(i));
          pins.current.push(el);
          const ov = new k.maps.CustomOverlay({ position: pt({ lat: at[0], lng: at[1] }), content: el, zIndex: 8 });
          ov.setMap(map);
          made.push(ov);
        });
        const mk = (p: LL, cls: string, text: string, z: number) => {
          const ov = new k.maps.CustomOverlay({ position: pt(p), content: badge(cls, text), yAnchor: 1, zIndex: z });
          ov.setMap(map);
          made.push(ov);
        };
        // 왕복 코스는 출발점이 곧 도착점이라 한 배지로 합친다
        mk(start, "kpt kpt-s", end ? "출발" : "출발 · 도착", 9);
        if (end) mk(end, "kpt kpt-e", "도착", 9);
        k.maps.event.addListener(map, "zoom_changed", () => setTick((t) => t + 1));
        // 지도 영역은 시트 위쪽만 차지하므로 위쪽 버튼·아래 칩에 가리지 않을 여백만 둔다
        map.setBounds(bounds, 84, 32, 72, 32);
        setReady(true);
      })
      .catch(() => !dead && onFailRef.current());
    return () => {
      dead = true;
      made.forEach((o) => o.setMap(null));
      dot.current?.setMap(null);
      dot.current = null;
      lines.current = [];
      casings.current = [];
      pins.current = [];
    };
    // 코스가 바뀌면 컴포넌트를 새로 마운트한다 (Result 의 key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 테마(라이트/다크)가 바뀌면 토큰에서 색을 다시 읽도록 다시 그린다
  useEffect(() => {
    if (!ready) return;
    const mo = new MutationObserver(() => setTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, [ready]);

  // 선택 강조: 선택된 경로는 굵게 경사 색으로, 나머지는 회색으로 물린다
  useEffect(() => {
    if (!ready) return;
    const k = kakao.current;
    const map = mapRef.current;
    if (!k || !map) return;
    const a = slopes[sel];
    const made: KOverlay[] = [];
    const proj = map.getProjection();
    const px = (p: [number, number]) => proj.containerPointFromCoords(new k.maps.LatLng(p[0], p[1]));
    const back = (p: { x: number; y: number }): KLatLng => proj.coordsFromContainerPoint(new k.maps.Point(p.x, p.y));

    if (a) {
      const ramp = readRamp();
      const m = a.len.length;
      // 구간 i 의 위치 t(0~1) — 겹친 구간은 픽셀 공간에서 오른쪽으로 비킨다
      const shift = (i: number) => {
        const p0 = px(a.pts[i]), p1 = px(a.pts[i + 1]);
        const dx = p1.x - p0.x, dy = p1.y - p0.y, n = Math.hypot(dx, dy) || 1;
        return { p0, dx, dy, nx: (-dy / n) * OFFSET_PX, ny: (dx / n) * OFFSET_PX };
      };
      const at = (i: number, t: number): KLatLng => {
        if (!a.over[i]) return new k.maps.LatLng(a.pts[i][0] + (a.pts[i + 1][0] - a.pts[i][0]) * t, a.pts[i][1] + (a.pts[i + 1][1] - a.pts[i][1]) * t);
        const { p0, dx, dy, nx, ny } = shift(i);
        return back({ x: p0.x + dx * t + nx, y: p0.y + dy * t + ny });
      };
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < SUBDIV; j++) {
          const t0 = j / SUBDIV, t1 = (j + 1) / SUBDIV;
          const lv = a.lv[i] + (a.lv[i + 1] - a.lv[i]) * ((t0 + t1) / 2);
          made.push(new k.maps.Polyline({ map, path: [at(i, t0), at(i, t1)], strokeWeight: a.over[i] ? 5 : 8, strokeColor: levelHex(ramp, lv), strokeOpacity: 1, zIndex: 4 }));
        }
      }
      // 가장 긴 언덕 구간 — 배지를 달고, 화살표는 그 근처를 비켜 간다
      const hill = a.segs.filter((s) => s.cls === "hill").sort((x, y) => y.to - y.from - (x.to - x.from))[0];
      const hm = hill ? (hill.from + hill.to) / 2 : -1;
      // 진행 방향 화살표: 선 안쪽에 들어가는 작은 ›. 노랑 구간만 어두운 색
      for (let d = CHEVRON_M / 2; d < a.totalM - 60; d += CHEVRON_M) {
        const f = d / a.totalM;
        if (Math.abs(f - hm) < 0.06) continue;
        let i = a.f.findIndex((v) => v >= f) - 1;
        i = Math.min(m - 1, Math.max(0, i));
        const t = (f - a.f[i]) / (a.f[i + 1] - a.f[i] || 1);
        const lv = a.lv[i] + (a.lv[i + 1] - a.lv[i]) * t;
        const { dx, dy } = shift(i);
        const el = document.createElement("div");
        el.className = lv > 0.5 && lv < 1.5 ? "kchev dk" : "kchev";
        el.innerHTML = CHEVRON_SVG;
        el.style.transform = `rotate(${(Math.atan2(dx, -dy) * 180) / Math.PI}deg)`;
        made.push(new k.maps.CustomOverlay({ position: at(i, t), content: el, zIndex: 6 }));
      }
      if (hill) {
        const [lat, lng] = pointAt(a, hm);
        // 출발 라벨(점 위쪽)과 겹치지 않게, 출발점 가까이에서는 아래쪽에 단다
        const nearStart = Math.hypot(lat - start.lat, (lng - start.lng) * 0.8) < 0.0016;
        made.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(lat, lng), content: badge("khill", `언덕 ${hill.dir === "down" ? "▼" : "▲"}`), yAnchor: nearStart ? -0.5 : 1.5, zIndex: 7 }));
      }
      made.forEach((o) => o.setMap(map));
    }

    const hasSlope = !!a;
    const unsel = cssColor("--map-unsel");
    const casing = cssColor("--map-casing");
    lines.current.forEach((l, i) =>
      l.setOptions(i === sel ? { strokeColor: cssColor("--fg"), strokeWeight: 8, strokeOpacity: hasSlope ? 0 : 1, zIndex: 3 } : { strokeColor: unsel, strokeWeight: 5, strokeOpacity: 0.85, zIndex: 1 }),
    );
    casings.current.forEach((c, i) => c.setOptions({ strokeColor: casing, strokeWeight: i === sel ? 13 : 9, strokeOpacity: i === sel ? 0.95 : 0.7, zIndex: i === sel ? 2 : 0 }));
    pins.current.forEach((el, i) => el.setAttribute("data-sel", String(i === sel)));
    return () => made.forEach((o) => o.setMap(null));
  }, [sel, ready, slopes, tick]);

  // 차트를 긁는 동안 지도에 현재 위치 점을 보여준다
  useEffect(() => {
    const k = kakao.current;
    const map = mapRef.current;
    const a = slopes[sel];
    if (!ready || !k || !map) return;
    if (scrub == null || !a) return dot.current?.setMap(null);
    const [lat, lng] = pointAt(a, scrub);
    const pos = new k.maps.LatLng(lat, lng);
    if (!dot.current) dot.current = new k.maps.CustomOverlay({ position: pos, content: badge("kdot", ""), zIndex: 8 });
    dot.current.setPosition?.(pos);
    dot.current.setMap(map);
  }, [scrub, sel, slopes, ready]);

  return <div ref={box} className="kmap" />;
}
