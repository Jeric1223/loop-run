"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadKakao, type KMap } from "@/lib/kakao";

type LL = { lat: number; lng: number };
const SEOUL: LL = { lat: 37.5665, lng: 126.978 };

const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia("(min-width:1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia("(min-width:1024px)").matches,
    () => false,
  );

/** 데스크톱 홈의 오른쪽 지도. 출발·도착 위치를 보여준다 (모바일에서는 불러오지 않는다) */
export function HomeMap({ start, end }: { start: LL | null; end: LL | null }) {
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // 부모가 렌더마다 새 객체를 넘기므로 좌표 숫자로 비교한다
  const [sLat, sLng, eLat, eLng] = [start?.lat, start?.lng, end?.lat, end?.lng];
  const overlays = useRef<{ setMap: (m: null) => void }[]>([]);

  useEffect(() => {
    if (!wide) return;
    let dead = false;
    loadKakao()
      .then((k) => {
        if (dead || !box.current) return;
        const o = start ?? SEOUL;
        mapRef.current = new k.maps.Map(box.current, { center: new k.maps.LatLng(o.lat, o.lng), level: start ? 4 : 7 });
        setReady(true);
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
      mapRef.current = null;
      setReady(false);
    };
    // 지도는 데스크톱 폭이 될 때 한 번만 만든다. 위치 변화는 아래 effect 가 반영한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);

  // 출발·도착이 바뀔 때 마커를 다시 그리고 화면을 맞춘다
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let dead = false;
    loadKakao().then((k) => {
      if (dead) return;
      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
      const pt = (p: LL) => new k.maps.LatLng(p.lat, p.lng);
      const mark = (p: LL, cls: string, text: string) => {
        const el = document.createElement("div");
        el.className = cls;
        el.textContent = text;
        const ov = new k.maps.CustomOverlay({ position: pt(p), content: el, yAnchor: 1, zIndex: 5 });
        ov.setMap(map);
        overlays.current.push(ov);
      };
      const a = sLat != null && sLng != null ? { lat: sLat, lng: sLng } : null;
      const z = eLat != null && eLng != null ? { lat: eLat, lng: eLng } : null;
      if (a) mark(a, "kpt kpt-s", "출발");
      if (z) mark(z, "kpt kpt-e", "도착");
      if (a && z) {
        const b = new k.maps.LatLngBounds();
        b.extend(pt(a));
        b.extend(pt(z));
        map.setBounds(b, 120, 120, 120, 120);
      } else if (a || z) {
        map.setLevel(4);
        map.setCenter(pt((a ?? z)!));
      }
    });
    return () => {
      dead = true;
    };
  }, [ready, sLat, sLng, eLat, eLng]);

  return (
    <div className="dmap" aria-hidden="true">
      {wide && <div ref={box} className="kmap" />}
      {failed && <span className="map-tag">지도를 불러오지 못했어요</span>}
    </div>
  );
}
