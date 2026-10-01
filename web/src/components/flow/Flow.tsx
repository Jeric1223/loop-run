"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { Home } from "@/components/home/Home";
import { activePace, homeReducer, initialHomeState, targetM, type Place } from "@/components/home/state";
import type { CourseResult } from "@/lib/course/build";
import { CourseRequestError, requestCourses } from "@/lib/course/client";
import { reverseGeocode } from "@/lib/kakao";
import { LOW_ACCURACY_M, getPosition, permissionState, type Fix } from "@/lib/geo";
import { Loading } from "./Loading";
import type { SavedCourse } from "@/lib/course/saved";
import { Result, type ResultGoal, type ToastFn } from "./Result";
import { SavedList } from "./SavedList";
import { StateScreen, type StateAction, type StateName } from "./StateScreen";

type View = { name: "home" } | { name: "loading" } | { name: "result"; courses: CourseResult[]; goal: ResultGoal; fromSaved?: boolean } | { name: "saved" } | { name: StateName };

const coordsOf = (p: Place | null) => (p && p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null);

/** 홈 → 로딩 → 결과, 그리고 위치 권한·실패·한도·오프라인 상태 화면을 오가는 컨테이너 */
export function Flow() {
  const [s, dispatch] = useReducer(homeReducer, initialHomeState);
  const [view, setView] = useState<View>({ name: "home" });
  const [toast, setToast] = useState<{ id: number; msg: string; action?: { label: string; onClick: () => void } } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const showToast: ToastFn = (msg, action) => {
    const id = Date.now();
    setToast({ id, msg, action });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), action ? 4400 : 2700);
  };

  /** 위치를 측정해 홈 상태에 반영한다. 실패하면 null */
  const locate = async (): Promise<Fix | null> => {
    try {
      const fix = await getPosition();
      dispatch({ type: "setLocation", ...fix, low: fix.accuracy > LOW_ACCURACY_M });
      // 주소 조회는 기다리지 않는다. 실패하면 좌표 문자열이 그대로 남는다
      reverseGeocode(fix.lat, fix.lng).then((name) => name && dispatch({ type: "startName", name })).catch(() => {});
      return fix;
    } catch (e) {
      if (e === "denied") setView({ name: "denied" });
      else showToast("위치를 가져오지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
      return null;
    }
  };

  const run = async (start: { lat: number; lng: number }) => {
    const end = coordsOf(s.end);
    const goal: ResultGoal = { targetM: targetM(s), paceSecPerKm: activePace(s), start, end, startName: s.start.name, endName: s.end?.name ?? null };
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setView({ name: "loading" });
    try {
      const courses = await requestCourses({ start, end, targetM: goal.targetM, paceSecPerKm: goal.paceSecPerKm }, ac.signal);
      setView({ name: "result", courses, goal });
    } catch (e) {
      const kind = e instanceof CourseRequestError ? e.kind : "fail";
      if (kind !== "aborted") setView({ name: kind });
    }
  };

  const make = async () => {
    if (!navigator.onLine) return setView({ name: "offline" });
    const known = coordsOf(s.start);
    if (known) return run(known);
    // 위치를 한 번도 재지 않았다면 권한 상태부터 본다 (처음이면 안내 화면을 먼저 보여준다)
    const perm = await permissionState();
    if (perm === "denied") return setView({ name: "denied" });
    if (perm === "prompt") return setView({ name: "perm" });
    const fix = await locate();
    if (fix) await run(fix);
  };

  const refresh = async () => {
    if (await locate()) showToast("현재 위치로 다시 측정했어요");
  };

  const onStateAction = async (a: StateAction) => {
    if (a === "home" || a === "later") return setView({ name: "home" });
    if (a === "retry") return make();
    if (a === "recheck") return navigator.onLine ? make() : showToast("아직 연결되지 않았어요");
    const fix = await locate(); // allow
    if (fix) await run(fix);
  };

  const cancel = () => {
    abortRef.current?.abort();
    setView({ name: "home" });
  };

  const openSaved = (v: SavedCourse) => setView({ name: "result", courses: [v.course], goal: v.goal, fromSaved: true });

  return (
    <div className="stage">
      <div className="phone">
        {view.name === "home" && <Home s={s} dispatch={dispatch} onRefresh={refresh} onMake={make} onOpenSaved={() => setView({ name: "saved" })} />}
        {view.name === "saved" && <SavedList onBack={() => setView({ name: "home" })} onOpen={openSaved} onToast={showToast} />}
        {view.name === "loading" && <Loading onCancel={cancel} />}
        {view.name === "result" && <Result courses={view.courses} goal={view.goal} fromSaved={view.fromSaved} onToast={showToast} onBack={() => setView(view.fromSaved ? { name: "saved" } : { name: "home" })} />}
        {(view.name === "perm" || view.name === "denied" || view.name === "fail" || view.name === "quota" || view.name === "offline") && (
          <StateScreen name={view.name} onAction={onStateAction} />
        )}
        {toast && (
          <div key={toast.id} className={toast.action ? "toast act" : "toast"} role="status">
            <span>{toast.msg}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-btn"
                onClick={() => {
                  toast.action!.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
