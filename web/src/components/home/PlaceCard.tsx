"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { Place } from "./state";

const KIND_SUB: Record<Place["kind"], string> = { gps: "현재 위치", pin: "지도에서 고른 위치", search: "검색한 장소" };
const accText = (acc: "ok" | "low", accM: number | null) =>
  accM == null ? "" : acc === "low" ? `낮음 (±${accM}m)` : `약 ${accM}m`;

/** 출발·도착 카드. 위치 고르기 시트는 다음 단계에서 붙인다 */
export function PlaceCard({
  start,
  end,
  acc,
  accM,
  onRefresh,
  onEndClear,
  onOpen,
}: {
  start: Place;
  end: Place | null;
  acc: "ok" | "low";
  accM: number | null;
  onRefresh: () => void;
  onEndClear: () => void;
  onOpen: (t: "start" | "end") => void;
}) {
  const gps = start.kind === "gps";
  // 누를 때마다 회전 애니메이션을 다시 시작하려고 key 를 바꾼다
  const [spinKey, setSpinKey] = useState(0);

  return (
    <div className="pts">
      <div className="pt" data-kind={start.kind} data-acc={gps ? acc : "ok"}>
        <span className="mk s" />
        <button type="button" className="pt-main" aria-haspopup="dialog" data-pk-btn="sheet-start" onClick={() => onOpen("start")}>
          <small>출발</small>
          <b>{gps ? "현재 위치" : start.name}</b>
          <em>
            {gps
              ? accM == null
                ? "코스를 만들 때 위치를 확인해요"
                : `${start.name} · 정확도 ${accText(acc, accM)}`
              : KIND_SUB[start.kind]}
          </em>
        </button>
        {gps ? (
          <button
            key={spinKey}
            type="button"
            className={spinKey ? "icon-btn spin" : "icon-btn"}
            aria-label="위치 새로고침"
            onClick={() => {
              setSpinKey((k) => k + 1);
              onRefresh();
            }}
          >
            <Icon name="refresh" />
          </button>
        ) : (
          <span className="pt-chev" aria-hidden="true">
            <Icon name="chevR" />
          </span>
        )}
      </div>
      <div className="pt" data-set={!!end}>
        <span className="mk e" />
        <button type="button" className="pt-main" aria-haspopup="dialog" data-pk-btn="sheet-end" onClick={() => onOpen("end")}>
          <small>도착</small>
          <b>{end ? end.name : "도착지 따로 정하기"}</b>
          <em>
            {end
              ? `${KIND_SUB[end.kind]} · 편도 코스로 만들어요`
              : "선택 · 안 정하면 출발점으로 돌아오는 왕복이에요"}
          </em>
        </button>
        {end ? (
          <button type="button" className="icon-btn" aria-label="도착지 지우기" onClick={onEndClear}>
            <Icon name="x" />
          </button>
        ) : (
          <span className="pt-chev" aria-hidden="true">
            <Icon name="chevR" />
          </span>
        )}
      </div>
    </div>
  );
}
