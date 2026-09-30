"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { searchPlaces, type PlaceHit } from "@/lib/kakao";
import type { Place } from "./state";

export type SheetTarget = "start" | "end";

function Opt({ icon, title, desc, on, onClick }: { icon: IconName; title: string; desc: string; on: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="o" role="menuitemradio" aria-checked={on} onClick={onClick}>
        <span className="o-ic">
          <Icon name={icon} />
        </span>
        <span className="o-tx">
          <b>{title}</b>
          <small>{desc}</small>
        </span>
        {on && (
          <span className="o-ck">
            <Icon name="check" />
          </span>
        )}
      </button>
    </li>
  );
}

type Search = { status: "idle" | "loading" | "done" | "error"; hits: PlaceHit[] };

/** 출발/도착 위치 고르기 시트 */
export function PlaceSheet({
  target,
  current,
  onLocate,
  onPick,
  onRoundTrip,
  onPin,
  onClose,
}: {
  target: SheetTarget;
  current: Place | null;
  onLocate: () => void;
  onPick: (p: Place) => void;
  onRoundTrip: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const isStart = target === "start";
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Search>({ status: "idle", hits: [] });
  const seq = useRef(0);

  // 입력이 멈춘 뒤에만 검색한다 (카카오 호출 절약). 늦게 도착한 이전 응답은 버린다
  useEffect(() => {
    const text = q.trim();
    const id = ++seq.current;
    if (!text) return;
    const t = setTimeout(async () => {
      setRes((r) => ({ ...r, status: "loading" }));
      try {
        const hits = await searchPlaces(text);
        if (id === seq.current) setRes({ status: "done", hits });
      } catch {
        if (id === seq.current) setRes({ status: "error", hits: [] });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const shown = q.trim() ? res : { status: "idle" as const, hits: [] };

  return (
    <div className="psheet" role="dialog" aria-modal="true" aria-label={`${isStart ? "출발" : "도착"} 위치 정하기`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="scrim" onClick={onClose} />
      <div className="ps-body">
        <div className="grab" />
        <div className="ps-head">
          {searching && (
            <button type="button" className="icon-btn" aria-label="뒤로" onClick={() => setSearching(false)}>
              <Icon name="chevL" />
            </button>
          )}
          <h2>{isStart ? "출발 위치" : "도착 위치"}</h2>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {searching ? (
          <>
            <label className="srch">
              <Icon name="search" />
              <input
                type="search"
                autoFocus
                placeholder="장소나 주소를 검색해요"
                autoComplete="off"
                aria-label="장소 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <ul className="opts" aria-live="polite">
              {shown.status === "loading" && <li className="ps-empty">찾고 있어요</li>}
              {shown.status === "error" && <li className="ps-empty">검색하지 못했어요. 잠시 뒤에 다시 시도해 주세요.</li>}
              {shown.status === "done" && shown.hits.length === 0 && <li className="ps-empty">검색 결과가 없어요. 다른 이름으로 찾아보세요.</li>}
              {shown.hits.map((h, i) => (
                <li key={`${h.lat},${h.lng},${i}`}>
                  <button type="button" className="o" onClick={() => onPick({ kind: "search", name: h.name, lat: h.lat, lng: h.lng })}>
                    <span className="o-ic">
                      <Icon name="pin" />
                    </span>
                    <span className="o-tx">
                      <b>{h.name}</b>
                      <small>{h.address}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="opts">
            {isStart ? (
              <Opt icon="target" title="현재 위치" desc="지금 있는 곳에서 출발해요" on={current?.kind === "gps"} onClick={onLocate} />
            ) : (
              <Opt icon="loop" title="출발지로 돌아와요" desc="왕복 코스로 만들어요" on={!current} onClick={onRoundTrip} />
            )}
            <Opt icon="pin" title="지도에서 핀으로 정하기" desc="지도를 움직여 정확한 위치에 맞춰요" on={current?.kind === "pin"} onClick={onPin} />
            <Opt icon="search" title="주소·장소 검색" desc="역 이름이나 공원 이름으로 찾아요" on={current?.kind === "search"} onClick={() => setSearching(true)} />
          </ul>
        )}
      </div>
    </div>
  );
}
