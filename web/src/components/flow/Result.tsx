"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icon";
import { Alert } from "@/components/home/controls";
import { fmtDur, fmtPace } from "@/lib/format";
import type { CourseResult, Slope } from "@/lib/course/build";
import { projectCourses } from "@/lib/course/project";
import { KakaoCourseMap } from "./KakaoMap";
import { RouteMap } from "./MapSvg";

const GRADE: Record<Slope, { text: string; icon: "flat" | "gentle" | "hill" }> = {
  flat: { text: "평지", icon: "flat" },
  gentle: { text: "완만", icon: "gentle" },
  hill: { text: "언덕", icon: "hill" },
};

const PATTERN = ["", "8 5", ".1 7"]; // ① 실선 ② 파선 ③ 점선 — 색만으로 구분하지 않는다

export type ResultGoal = {
  targetM: number;
  paceSecPerKm: number | null;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number } | null;
};

function Card({ c, i, sel, targetM, onSelect }: { c: CourseResult; i: number; sel: boolean; targetM: number; onSelect: () => void }) {
  const grade = GRADE[c.slope];
  const pct = Math.round(((c.distanceM - targetM) / targetM) * 100);
  const far = Math.abs(pct) >= 10;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
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
        <span className="check">
          <Icon name="check" />
        </span>
      </div>
      <div className="card-main">
        <div className="dist">
          <div className="dist-v">
            <b>{(c.distanceM / 1000).toFixed(2)}</b>
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
        <span className="chip" aria-label={`경사 ${grade.text}`}>
          <Icon name={grade.icon} />
          {grade.text}
        </span>
        <span className="chip">
          <Icon name="cross" />
          횡단보도 <b>{c.crossings}</b>개
        </span>
        {c.stairs > 0 && (
          <span className="chip">
            <Icon name="stairs" />
            계단 <b>{c.stairs}</b>개
          </span>
        )}
      </div>
      <div className="card-more">
        <div>
          {c.note && <p className="note">{c.note}</p>}
          <div className="card-reserve" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

export function Result({ courses, goal, onBack }: { courses: CourseResult[]; goal: ResultGoal; onBack: () => void }) {
  const [sel, setSel] = useState(0);
  // 카카오 SDK 를 못 불러오면(도메인 미등록·오프라인) 임시 SVG 지도로 대체한다
  const [svgMap, setSvgMap] = useState(false);
  const proj = useMemo(() => projectCourses(courses, goal.start, goal.end), [courses, goal.start, goal.end]);
  const km = goal.targetM / 1000;
  const chip = `목표 ${km.toFixed(goal.targetM % 1000 ? 1 : 0)}km${goal.paceSecPerKm ? ` · ${fmtPace(goal.paceSecPerKm)}/km` : ""}${goal.end ? " · 편도" : ""}`;

  return (
    <section className="screen result" data-n={courses.length}>
      <div className="map">
        {svgMap ? (
          <RouteMap proj={proj} sel={sel} onSelect={setSel} />
        ) : (
          <KakaoCourseMap courses={courses} start={goal.start} end={goal.end} sel={sel} onSelect={setSel} onFail={() => setSvgMap(true)} />
        )}
        <button type="button" className="fab" onClick={onBack}>
          <Icon name="chevL" />
          목표 바꾸기
        </button>
        <span className="map-chip">{chip}</span>
        {svgMap && <span className="map-tag">지도를 불러오지 못해 임시 지도로 보여줘요</span>}
      </div>
      <div className="sheet">
        <div className="grab" />
        <div className="sheet-head">
          <div>
            <h2>코스 {courses.length}개를 찾았어요</h2>
            <p>카드를 누르면 지도에서 강조돼요</p>
          </div>
        </div>
        {courses.length < 3 && (
          <Alert
            tone="info"
            title={`조건에 맞는 코스가 ${courses.length}개예요`}
            body="목표를 조금 바꾸면 다른 코스를 볼 수 있어요."
            action={{ label: "목표 바꾸기", onClick: onBack }}
          />
        )}
        <div className="cards" role="listbox" aria-label="러닝 코스 후보">
          {courses.map((c, i) => (
            <Card key={c.role} c={c} i={i} sel={i === sel} targetM={goal.targetM} onSelect={() => setSel(i)} />
          ))}
        </div>
        <p className="source">
          <b>출처</b> 고도 데이터 · <span className="ph">출처 문구가 들어갈 자리</span> · 지도 카카오맵
        </p>
      </div>
    </section>
  );
}
