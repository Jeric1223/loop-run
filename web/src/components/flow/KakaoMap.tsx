"use client";

import { useEffect, useRef, useState } from "react";
import type { CourseResult } from "@/lib/course/build";
import { loadKakao, type KMap, type KPolyline } from "@/lib/kakao";
import { slopeColor } from "./slopeColor";

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

const STYLES = ["solid", "shortdash", "dot"] as const; // ① 실선 ② 파선 ③ 점선

function badge(cls: string, text: string, onClick?: () => void) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

/** 결과 지도: 코스 경로 3개 + 번호 핀 + 출발/도착. SDK 로드에 실패하면 onFail 로 알려 SVG 지도로 대체한다 */
export function KakaoCourseMap({
  courses,
  start,
  end,
  sel,
  onSelect,
  onFail,
}: {
  courses: CourseResult[];
  start: LL;
  end: LL | null;
  sel: number;
  onSelect: (i: number) => void;
  onFail: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const lines = useRef<KPolyline[]>([]);
  const casings = useRef<KPolyline[]>([]);
  const pins = useRef<HTMLElement[]>([]);
  const colors = useRef<string[]>([]);
  const kakao = useRef<Awaited<ReturnType<typeof loadKakao>> | null>(null);
  const mapRef = useRef<KMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const onFailRef = useRef(onFail);
  const [ready, setReady] = useState(false);

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
        colors.current = ["--c1", "--c2", "--c3"].map(cssColor);

        courses.forEach((c, i) => {
          const path = c.path.map(([lat, lng]) => pt({ lat, lng }));
          path.forEach((p) => bounds.extend(p));
          // 흰 테두리를 먼저 깔아 지도 위에서 경로가 또렷하게 보이게 한다
          const casing = new k.maps.Polyline({ map, path, strokeWeight: 9, strokeColor: cssColor("--map-casing"), strokeOpacity: 0.7, zIndex: 0 });
          casings.current.push(casing);
          made.push(casing);
          const line = new k.maps.Polyline({ map, path, strokeWeight: 5, strokeColor: colors.current[i], strokeOpacity: 0.55, strokeStyle: STYLES[i], zIndex: 1 });
          lines.current.push(line);
          made.push(line);
          const at = c.path[Math.min(c.path.length - 1, Math.floor(c.path.length * (0.35 + i * 0.22)))];
          const el = badge(`kpin r${i}`, String(i + 1), () => onSelectRef.current(i));
          pins.current.push(el);
          const ov = new k.maps.CustomOverlay({ position: pt({ lat: at[0], lng: at[1] }), content: el, zIndex: 5 });
          ov.setMap(map);
          made.push(ov);
        });
        const mk = (p: LL, cls: string, text: string, z: number) => {
          const ov = new k.maps.CustomOverlay({ position: pt(p), content: badge(cls, text), yAnchor: 1, zIndex: z });
          ov.setMap(map);
          made.push(ov);
        };
        mk(start, "kpt kpt-s", "출발", 9);
        if (end) mk(end, "kpt kpt-e", "도착", 9);
        // 지도 영역은 시트 위쪽만 차지하므로 위쪽 버튼·아래 칩에 가리지 않을 여백만 둔다
        map.setBounds(bounds, 84, 32, 72, 32);
        setReady(true);
      })
      .catch(() => !dead && onFailRef.current());
    return () => {
      dead = true;
      made.forEach((o) => o.setMap(null));
      lines.current = [];
      casings.current = [];
      pins.current = [];
    };
    // 코스가 바뀌면 컴포넌트를 새로 마운트한다 (Result 의 key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 테마(라이트/다크)가 바뀌면 경로·테두리 색을 토큰에서 다시 읽는다
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      colors.current = ["--c1", "--c2", "--c3"].map(cssColor);
      const casing = cssColor("--map-casing");
      lines.current.forEach((l, i) => l.setOptions({ strokeColor: colors.current[i] }));
      casings.current.forEach((c) => c.setOptions({ strokeColor: casing }));
    };
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, [ready]);

  // 선택 강조: 선택된 경로는 굵고 불투명하게, 핀은 키운다
  // 경사 정보가 있으면 선택된 경로 위에 경사율 색을 이어 칠하고, 원래 선은 숨긴다
  useEffect(() => {
    if (!ready) return;
    const profile = courses[sel]?.profile;
    const k = kakao.current;
    const map = mapRef.current;
    const overlays: KPolyline[] = [];
    if (profile && k && map && profile.pts.length > 1) {
      const { pts, grade } = profile;
      // 점마다 앞뒤 구간 경사율의 평균을 두고, 구간 안에서는 양 끝 값을 선형으로 섞는다
      const at = (i: number) => (i === 0 ? grade[0] : i === grade.length ? grade[grade.length - 1] : (grade[i - 1] + grade[i]) / 2);
      for (let i = 0; i < pts.length - 1; i++) {
        for (let j = 0; j < SUBDIV; j++) {
          const t0 = j / SUBDIV;
          const t1 = (j + 1) / SUBDIV;
          const lerp = (t: number) => new k.maps.LatLng(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t);
          const g = at(i) + (at(i + 1) - at(i)) * ((t0 + t1) / 2);
          overlays.push(new k.maps.Polyline({ map, path: [lerp(t0), lerp(t1)], strokeWeight: 8, strokeColor: slopeColor(g), strokeOpacity: 1, zIndex: 4 }));
        }
      }
    }
    lines.current.forEach((l, i) =>
      l.setOptions({ strokeWeight: i === sel ? 8 : 5, strokeOpacity: i === sel ? (overlays.length ? 0 : 1) : 0.55, zIndex: i === sel ? 3 : 1 }),
    );
    casings.current.forEach((c, i) => c.setOptions({ strokeWeight: i === sel ? 13 : 9, strokeOpacity: i === sel ? 0.95 : 0.7, zIndex: i === sel ? 2 : 0 }));
    pins.current.forEach((el, i) => el.setAttribute("data-sel", String(i === sel)));
    return () => overlays.forEach((o) => o.setMap(null));
  }, [sel, ready, courses]);

  return <div ref={box} className="kmap" />;
}
