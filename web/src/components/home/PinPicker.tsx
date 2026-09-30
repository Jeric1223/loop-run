"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { getPosition } from "@/lib/geo";
import { loadKakao, reverseGeocode, type KMap } from "@/lib/kakao";
import type { Place } from "./state";
import type { SheetTarget } from "./PlaceSheet";

type LL = { lat: number; lng: number };
const SEOUL: LL = { lat: 37.5665, lng: 126.978 };

/** 지도를 움직여 가운데 핀에 맞춘 위치를 고른다. 지도가 멈출 때마다 주소를 다시 조회한다 */
export function PinPicker({
  target,
  origin,
  other,
  onPick,
  onClose,
}: {
  target: SheetTarget;
  /** 처음 지도 중심 (현재 출발점 등). 없으면 서울 시청 */
  origin: LL | null;
  /** 반대편 지점(출발을 고를 땐 도착, 도착을 고를 땐 출발). 지도에 함께 보여준다 */
  other: LL | null;
  onPick: (p: Place) => void;
  onClose: () => void;
}) {
  const isStart = target === "start";
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KMap | null>(null);
  const home = useRef<LL>(origin ?? SEOUL);
  const center = useRef<LL>(origin ?? SEOUL);
  const seq = useRef(0);
  const [addr, setAddr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 다이얼로그가 열려 있는 동안 뒤 화면은 탭·스크린리더 대상에서 제외
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    const rest = [...(el?.parentElement?.children ?? [])].filter((c): c is HTMLElement => c !== el && c instanceof HTMLElement);
    rest.forEach((c) => (c.inert = true));
    return () => rest.forEach((c) => (c.inert = false));
  }, []);

  useEffect(() => {
    let dead = false;
    const lookup = async () => {
      const id = ++seq.current;
      setBusy(true);
      const { lat, lng } = center.current;
      const name = await reverseGeocode(lat, lng).catch(() => null);
      if (dead || id !== seq.current) return;
      setAddr(name);
      setBusy(false);
    };
    loadKakao()
      .then((k) => {
        if (dead || !box.current) return;
        const o = center.current;
        const map = new k.maps.Map(box.current, { center: new k.maps.LatLng(o.lat, o.lng), level: 3 });
        mapRef.current = map;
        if (other) {
          const el = document.createElement("div");
          el.className = isStart ? "kpt kpt-e" : "kpt kpt-s";
          el.textContent = isStart ? "도착" : "출발";
          new k.maps.CustomOverlay({ position: new k.maps.LatLng(other.lat, other.lng), content: el, yAnchor: 1, zIndex: 1 }).setMap(map);
        }
        const move = () => {
          const c = map.getCenter();
          center.current = { lat: c.getLat(), lng: c.getLng() };
        };
        k.maps.event.addListener(map, "dragstart", () => setDragging(true));
        k.maps.event.addListener(map, "idle", () => {
          setDragging(false);
          move();
          void lookup();
        });
        void lookup();
        // 출발점을 아직 못 쟀으면(기준 좌표 없음) 현재 위치로 옮긴다. 실패하면 서울시청에 그대로 둔다
        if (!origin) {
          getPosition()
            .then((fix) => {
              if (dead) return;
              home.current = { lat: fix.lat, lng: fix.lng };
              map.setCenter(new k.maps.LatLng(fix.lat, fix.lng));
            })
            .catch(() => {});
        }
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
    };
  // 지도는 열릴 때 한 번만 만든다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recenter = () => {
    const m = mapRef.current;
    if (!m) return;
    const { lat, lng } = home.current;
    loadKakao().then((k) => m.setCenter(new k.maps.LatLng(lat, lng)));
  };

  const pick = () => {
    const { lat, lng } = center.current;
    onPick({ kind: "pin", name: addr ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng });
  };

  return (
    <div
      ref={root}
      className={`picker${dragging ? " dragging" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${isStart ? "출발" : "도착"}지 핀 정하기`}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        ref={box}
        className="pk-map"
        tabIndex={0}
        aria-label="지도. 끌어서 움직이거나 방향키로 움직여요"
        onKeyDown={(e) => {
          const d = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] }[e.key];
          if (!d) return;
          e.preventDefault();
          mapRef.current?.panBy(d[0], d[1]);
        }}
      />
      <div className="pk-pin" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 22.5s-8-6.6-8-12.6a8 8 0 0 1 16 0c0 6-8 12.6-8 12.6Z" />
          <circle cx="12" cy="9.6" r="3" />
        </svg>
        <i />
      </div>
      <button type="button" className="fab" onClick={onClose}>
        <Icon name="chevL" />
        취소
      </button>
      <button type="button" className="fab fab-r" aria-label="처음 위치로 돌아가기" onClick={recenter}>
        <Icon name="locate" />
      </button>
      <div className="pk-card">
        <small>{isStart ? "출발" : "도착"}지 정하기</small>
        <b className={busy ? "busy" : ""} aria-live="polite">
          {failed ? "지도를 불러오지 못했어요" : busy ? "위치를 확인하고 있어요" : (addr ?? "주소를 찾지 못한 곳이에요")}
        </b>
        <p className="hint">지도를 움직여 핀을 원하는 곳에 맞춰요</p>
        <button type="button" className="cta" disabled={failed || busy} onClick={pick}>
          여기로 정할게요
        </button>
      </div>
    </div>
  );
}
