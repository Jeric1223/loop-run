"use client";

import { useState, useSyncExternalStore, type Dispatch, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icon";
import { Alert } from "./controls";
import { DistanceGoal, PaceGoal } from "./GoalPanels";
import { HomeMap } from "./HomeMap";
import { PlaceCard } from "./PlaceCard";
import { PinPicker } from "./PinPicker";
import { PlaceSheet, type SheetTarget } from "./PlaceSheet";
import { KM_MAX, KM_MIN, targetM, type GoalMode, type Place, type HomeAction, type HomeState } from "./state";

const MODES: { mode: GoalMode; label: string }[] = [
  { mode: "dist", label: "거리" },
  { mode: "pace", label: "페이스·시간" },
];

const ll = (p: Place | null) => (p?.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null);

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function ThemeToggle() {
  const toggle = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("rl-theme", next);
    } catch {
      /* 저장 실패는 무시 */
    }
  };
  // 아이콘은 서버/클라이언트 불일치를 피하려고 둘 다 그리고 CSS 로 전환
  return (
    <button type="button" className="icon-btn" aria-label="화면 테마 바꾸기" onClick={toggle}>
      <Icon name="moon" className="theme-ic-moon" />
      <Icon name="sun" className="theme-ic-sun" />
    </button>
  );
}

/** 홈: 출발·도착 + 목표(거리 / 페이스·시간) → 코스 만들기. 상태는 Flow 가 들고 있다 */
export function Home({
  s,
  dispatch,
  onRefresh,
  onMake,
}: {
  s: HomeState;
  dispatch: Dispatch<HomeAction>;
  onRefresh: () => void;
  onMake: () => void;
}) {
  const online = useOnline();
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [picker, setPicker] = useState<SheetTarget | null>(null);

  const km = targetM(s) / 1000;
  const bad = s.mode === "pace" && (km < KM_MIN || km > KM_MAX);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !s.pk) return;
    const id = `pk-${s.pk}`;
    dispatch({ type: "closePk" });
    document.querySelector<HTMLElement>(`[data-pk-btn="${id}"]`)?.focus();
  };

  return (
    <section className="screen home" onKeyDown={onKeyDown}>
      <header className="topbar">
        <div className="logo">
          <Icon name="loop" />
          루프런<em>임시</em>
        </div>
        <ThemeToggle />
      </header>
      <div className="scroll">
        <h1 className="hero-title">
          오늘은 어디까지
          <br />
          달려볼까요?
        </h1>
        <div className="alerts">
          {!online && <Alert tone="danger" title="인터넷에 연결되어 있지 않아요" body="연결되면 코스를 만들 수 있어요." />}
          {s.start.kind === "gps" && s.acc === "low" && (
            <Alert
              tone="warn"
              title="위치 정확도가 낮아요"
              body="출발점이 실제 위치와 다를 수 있어요. 탁 트인 곳에서 다시 측정해 보세요."
              action={{ label: "다시 측정", onClick: onRefresh }}
            />
          )}
        </div>
        <PlaceCard
          start={s.start}
          end={s.end}
          acc={s.acc}
          accM={s.accM}
          onRefresh={onRefresh}
          onEndClear={() => dispatch({ type: "endClear" })}
          onOpen={setSheet}
        />
        <div className="seg" role="tablist" aria-label="목표 방식" data-mode={s.mode}>
          <span className="thumb" />
          {MODES.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={s.mode === mode}
              onClick={() => dispatch({ type: "mode", mode })}
            >
              {label}
            </button>
          ))}
        </div>
        {s.mode === "dist" ? <DistanceGoal s={s} dispatch={dispatch} /> : <PaceGoal s={s} dispatch={dispatch} />}
        <p className="source">
          <b>출처</b> 고도 데이터 · <span className="ph">출처 문구가 들어갈 자리</span> · 지도 카카오맵
        </p>
      </div>
      <div className="cta-bar">
        <button type="button" className="cta" disabled={bad} onClick={onMake}>
          코스 만들기
          <Icon name="arrowR" />
        </button>
      </div>
      <HomeMap start={ll(s.start)} end={ll(s.end)} />
      {sheet && (
        <PlaceSheet
          target={sheet}
          current={sheet === "start" ? s.start : s.end}
          onLocate={() => {
            setSheet(null);
            onRefresh();
          }}
          onPick={(place) => {
            dispatch({ type: "setPlace", target: sheet, place });
            setSheet(null);
          }}
          onRoundTrip={() => {
            dispatch({ type: "endClear" });
            setSheet(null);
          }}
          onPin={() => {
            setPicker(sheet);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {picker && (
        <PinPicker
          target={picker}
          origin={ll(picker === "start" ? s.start : s.end) ?? ll(s.start)}
          other={ll(picker === "start" ? s.end : s.start)}
          onPick={(place) => {
            dispatch({ type: "setPlace", target: picker, place });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}
