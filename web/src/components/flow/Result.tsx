"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icon";
import { Alert } from "@/components/home/controls";
import { fmtDur, fmtPace } from "@/lib/format";
import type { CourseResult, Slope } from "@/lib/course/build";
import { projectCourses } from "@/lib/course/project";
import { analyzeSlope, slopeSummary, type CourseSlope } from "@/lib/course/slope";
import { KakaoCourseMap } from "./KakaoMap";
import { ElevChart } from "./ElevChart";
import { CountUp } from "@/components/CountUp";
import { SAVED_MAX, SAVE_FAIL, removeCourse, restoreCourse, saveCourse, savedId, useSavedCourses } from "@/lib/course/saved";
import { RouteMap } from "./MapSvg";

export const GRADE: Record<Slope, { text: string; icon: "flat" | "gentle" | "hill" }> = {
  flat: { text: "평지", icon: "flat" },
  gentle: { text: "완만", icon: "gentle" },
  hill: { text: "언덕", icon: "hill" },
};

export const PATTERN = ["", "8 5", ".1 7"]; // ① 실선 ② 파선 ③ 점선 — 색만으로 구분하지 않는다

export type ResultGoal = {
  targetM: number;
  paceSecPerKm: number | null;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number } | null;
  /** 저장 목록에 보여줄 이름 (없으면 일반 문구) */
  startName?: string;
  endName?: string | null;
};

export type ToastFn = (msg: string, action?: { label: string; onClick: () => void }) => void;

function Card({ c, a, i, sel, targetM, saved, onSelect, onSave }: { c: CourseResult; a: CourseSlope | null; i: number; sel: boolean; targetM: number; saved: boolean; onSelect: () => void; onSave: () => void }) {
  const grade = c.slope ? GRADE[c.slope] : null; // 고도 조회 실패 시 경사 칩을 숨긴다
  const pct = Math.round(((c.distanceM - targetM) / targetM) * 100);
  const far = Math.abs(pct) >= 10;
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return; // 안쪽 버튼의 키 입력은 가로채지 않는다
    e.preventDefault();
    onSelect();
  };

  return (
    <article
      className={`card i${i}`}
      data-sel={sel}
      style={{ "--i": i } as React.CSSProperties}
      role="option"
      aria-selected={sel}
      tabIndex={0}
      aria-label={`${i + 1}번 ${c.label}`}
      onClick={onSelect}
      onKeyDown={onKey}
    >
      <div className="card-head">
        <span className="num">{i + 1}</span>
        <h3>{c.label}</h3>
        <svg className="pat" viewBox="0 0 34 10" aria-hidden="true">
          <path d="M2 5h30" stroke="currentColor" strokeWidth={4} fill="none" strokeDasharray={PATTERN[i] || undefined} strokeLinecap={i === 2 ? "round" : undefined} />
        </svg>
        <button
          type="button"
          className="save-btn"
          aria-pressed={saved}
          aria-label={`${c.label} 코스 저장`}
          onClick={(e) => {
            e.stopPropagation();
            onSave();
          }}
        >
          <Icon name="bookmark" />
        </button>
        <span className="check">
          <Icon name="check" />
        </span>
      </div>
      <div className="card-main">
        <div className="dist">
          <div className="dist-v">
            <b>
              <CountUp to={c.distanceM / 1000} animate={sel} delay={i ? 120 : 350} />
            </b>
            <small>km</small>
          </div>
          {far ? (
            <span className="badge warn">
              <Icon name="warn" />
              목표보다 {Math.abs(pct)}% {pct > 0 ? "길어요" : "짧아요"}
            </span>
          ) : (
            <span className="dev">목표 대비 {pct > 0 ? "+" : pct < 0 ? "−" : "±"}{Math.abs(pct)}%</span>
          )}
        </div>
        {c.estSec != null && (
          <div className="time">
            <b>약 {fmtDur(c.estSec)}</b>
            <small>예상 시간</small>
          </div>
        )}
      </div>
      <div className="chips">
        {grade && (
          <span className="chip" aria-label={`경사 ${grade.text}`}>
            <Icon name={grade.icon} />
            {grade.text}
          </span>
        )}
        <span className="chip">
          <Icon name="cross" />
          횡단보도 <b>{c.crossings}</b>개
        </span>
        {a && a.overlapPct >= 10 && (
          <span className="chip ov-chip" aria-label={`같은 길을 오가는 구간 ${a.overlapPct}퍼센트`}>
            <Icon name="swap" />
            같은 길 왕복 <b>{a.overlapPct}</b>%
          </span>
        )}
        {c.stairs > 0 && (
          <span className="chip">
            <Icon name="stairs" />
            계단 <b>{c.stairs}</b>개
          </span>
        )}
      </div>
      {a && <p className="sum">{slopeSummary(a)}</p>}
      <div className="card-more">
        <div>
          {c.note && <p className="note">{c.note}</p>}
          <div className="card-reserve" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

export function Result({ courses, goal, onBack, onToast, fromSaved = false }: { courses: CourseResult[]; goal: ResultGoal; onBack: () => void; onToast: ToastFn; fromSaved?: boolean }) {
  const [sel, setSel] = useState(0);
  // 고도 차트를 긁는 위치 (코스 전체 거리에 대한 비율). 지도의 위치 점과 연결된다
  const [scrub, setScrub] = useState<number | null>(null);
  // 카카오 SDK 를 못 불러오면(도메인 미등록·오프라인) 임시 SVG 지도로 대체한다
  const [svgMap, setSvgMap] = useState(false);
  const proj = useMemo(() => projectCourses(courses, goal.start, goal.end), [courses, goal.start, goal.end]);
  const slopes = useMemo(() => courses.map((c) => (c.profile ? analyzeSlope(c.profile) : null)), [courses]);
  const select = (i: number) => {
    setSel(i);
    setScrub(null);
  };
  const savedList = useSavedCourses();
  const toggleSave = (c: CourseResult) => {
    const id = savedId(c, goal);
    if (savedList.some((s) => s.id === id)) {
      const r = removeCourse(id);
      if (!r) return onToast(SAVE_FAIL);
      return onToast("저장을 해제했어요", { label: "되돌리기", onClick: () => restoreCourse(r.item, r.idx) });
    }
    const res = saveCourse({ id, course: c, goal });
    if (res === "full") return onToast(`코스는 ${SAVED_MAX}개까지 저장할 수 있어요. 안 쓰는 코스를 지워 주세요.`);
    if (res === "error") return onToast(SAVE_FAIL);
    onToast("내 코스에 저장했어요", { label: "되돌리기", onClick: () => removeCourse(id) });
  };
  const km = goal.targetM / 1000;
  const chip = `목표 ${km.toFixed(goal.targetM % 1000 ? 1 : 0)}km${goal.paceSecPerKm ? ` · ${fmtPace(goal.paceSecPerKm)}/km` : ""}${goal.end ? " · 편도" : ""}`;

  return (
    <section className="screen result" data-n={courses.length}>
      <div className="map">
        {svgMap ? (
          <RouteMap proj={proj} sel={sel} onSelect={select} />
        ) : (
          <KakaoCourseMap courses={courses} slopes={slopes} scrub={scrub} start={goal.start} end={goal.end} sel={sel} onSelect={select} onFail={() => setSvgMap(true)} />
        )}
        <button type="button" className="fab" onClick={onBack}>
          <Icon name="chevL" />
          {fromSaved ? "내 코스" : "목표 바꾸기"}
        </button>
        <span className="map-chip">{chip}</span>
        {!svgMap && slopes[sel] && (
          <div className="map-legend" aria-label="경사 색 범례: 초록은 평지, 노랑은 완만, 빨강은 언덕. 화살표는 진행 방향">
            <span><i className="sw" style={{ background: "var(--g-flat)" }} />평지</span>
            <span><i className="sw" style={{ background: "var(--g-gentle)" }} />완만</span>
            <span><i className="sw" style={{ background: "var(--g-hill)" }} />언덕</span>
            <span className="lg-dir">› 진행 방향</span>
          </div>
        )}
        {svgMap && <span className="map-tag">지도를 불러오지 못해 임시 지도로 보여줘요</span>}
      </div>
      <div className="sheet">
        <div className="grab" />
        <div className="sheet-head">
          <div>
            <h2>{fromSaved ? "저장한 코스예요" : `코스 ${courses.length}개를 찾았어요`}</h2>
            <p>{fromSaved ? "다시 계산하지 않고 저장해 둔 경로를 보여줘요" : "카드를 누르면 지도에서 강조돼요"}</p>
          </div>
        </div>
        {!fromSaved && courses.length < 3 && (
          <Alert
            tone="info"
            title={`조건에 맞는 코스가 ${courses.length}개예요`}
            body="목표를 조금 바꾸면 다른 코스를 볼 수 있어요."
            action={{ label: "목표 바꾸기", onClick: onBack }}
          />
        )}
        {!svgMap && slopes[sel] && <ElevChart key={sel} a={slopes[sel]!} scrub={scrub} onScrub={setScrub} />}
        <div className="cards" role="listbox" aria-label="러닝 코스 후보">
          {courses.map((c, i) => (
            <Card key={c.role} c={c} a={slopes[i]} i={i} sel={i === sel} targetM={goal.targetM} saved={savedList.some((s) => s.id === savedId(c, goal))} onSelect={() => select(i)} onSave={() => toggleSave(c)} />
          ))}
        </div>
        <p className="source">
          <b>출처</b> 고도 데이터 · <span className="ph">출처 문구가 들어갈 자리</span> · 지도 카카오맵
        </p>
      </div>
    </section>
  );
}
