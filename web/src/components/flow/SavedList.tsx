"use client";

import { Icon } from "@/components/Icon";
import { removeCourse, restoreCourse, useSavedCourses, type SavedCourse } from "@/lib/course/saved";
import { GRADE, PATTERN, type ToastFn } from "./Result";

const fmtAgo = (ts: number) => {
  const d = Math.floor((Date.now() - ts) / 864e5);
  if (d <= 0) return "오늘";
  if (d === 1) return "어제";
  const t = new Date(ts);
  return `${t.getMonth() + 1}월 ${t.getDate()}일`;
};

function Item({ s, i, onOpen, onToast }: { s: SavedCourse; i: number; onOpen: () => void; onToast: ToastFn }) {
  const { course: c, goal: g } = s;
  const idx = ["BEST", "MIN_GAIN", "MIN_CROSSINGS"].indexOf(c.role);
  const km = (c.distanceM / 1000).toFixed(2);
  const del = () => {
    const r = removeCourse(s.id);
    if (r) onToast("코스를 지웠어요", { label: "되돌리기", onClick: () => restoreCourse(r.item, r.idx) });
  };
  return (
    <li className="sv" style={{ "--i": i } as React.CSSProperties}>
      <button type="button" className="sv-open" onClick={onOpen} aria-label={`${c.label} ${km}킬로미터 열기`}>
        <span className="sv-top">
          <span className="num">{idx < 0 ? i + 1 : idx + 1}</span>
          {c.label}
          <svg className="pat" viewBox="0 0 34 10" aria-hidden="true">
            <path d="M2 5h30" stroke="currentColor" strokeWidth={4} fill="none" strokeDasharray={PATTERN[idx] || undefined} strokeLinecap={idx === 2 ? "round" : undefined} />
          </svg>
        </span>
        <span className="sv-dist">
          {km}
          <small>km</small>
        </span>
        <span className="sv-meta">
          {g.startName ?? "출발지"}
          {g.end ? ` → ${g.endName ?? "도착지"}` : " · 왕복"}
          {c.slope ? ` · ${GRADE[c.slope].text}` : ""} · 횡단보도 {c.crossings}개
          <br />
          {fmtAgo(s.savedAt)} 저장
        </span>
      </button>
      <button type="button" className="icon-btn" onClick={del} aria-label={`${c.label} 코스 지우기`}>
        <Icon name="trash" />
      </button>
    </li>
  );
}

/** 내 코스: 저장해 둔 코스 목록. 열면 저장된 경로를 그대로 결과 화면에 보여준다 */
export function SavedList({ onBack, onOpen, onToast }: { onBack: () => void; onOpen: (s: SavedCourse) => void; onToast: ToastFn }) {
  const list = useSavedCourses();
  return (
    <section className="screen saved">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="홈으로">
          <Icon name="chevL" />
        </button>
        <h1 className="sv-title">내 코스</h1>
        <span className="sv-gap" aria-hidden="true" />
      </header>
      <div className="scroll">
        {list.length === 0 ? (
          <div className="sv-empty">
            <div className="state-ic" data-tone="neutral">
              <Icon name="bookmark" />
            </div>
            <h2>저장한 코스가 없어요</h2>
            <p>
              마음에 드는 코스의 북마크를 눌러 두면
              <br />
              다음에도 바로 열어볼 수 있어요.
            </p>
            <button type="button" className="cta" onClick={onBack}>
              코스 만들러 가기
            </button>
          </div>
        ) : (
          <ul className="saved-list" aria-label="저장한 코스">
            {list.map((s, i) => (
              <Item key={s.id} s={s} i={i} onOpen={() => onOpen(s)} onToast={onToast} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
