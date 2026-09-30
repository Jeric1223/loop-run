"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Roll } from "@/components/Roll";
import { MAP_H, MAP_W } from "@/lib/course/project";
import { Roads } from "./MapSvg";

// 서버가 진행률을 주지 않아 시간으로 단계를 넘긴다 (실제 진행과 일치하지 않음). 마지막 단계는 응답이 올 때까지 머문다
const STEPS = ["길을 찾는 중", "고도를 계산하는 중", "코스를 고르는 중"];
const STEP_SEC = [3, 3, 40];
const LOOP = "M195 214C120 190 90 120 150 100S280 110 290 170 250 260 195 214Z";

export function Loading({ onCancel }: { onCancel: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= STEPS.length - 1) return;
    const t = setTimeout(() => setStep(step + 1), STEP_SEC[step] * 1000);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <section className="screen loading">
      <div className="map skeleton">
        <svg className="map-svg" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <Roads />
        </svg>
        <svg className="ld-route" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <path pathLength={1} d={LOOP} />
          <circle cx={195} cy={214} r={8} fill="var(--fg)" />
        </svg>
        <button type="button" className="fab" onClick={onCancel}>
          <Icon name="chevL" />
          취소
        </button>
        <span className="map-tag">카카오맵 SDK 영역</span>
      </div>
      <div className="sheet">
        <div className="grab" />
        <div className="ld-head">
          <h2 className="ld-title" role="status" aria-live="polite">
            <Roll text={STEPS[step]} n={step} />
            <span className="ld-dots" aria-hidden="true">
              <i>.</i>
              <i>.</i>
              <i>.</i>
            </span>
          </h2>
          <div className="ld-bar">
            {STEPS.map((_, i) => (
              <i
                key={i}
                className={i < step ? "done" : i === step ? "active" : ""}
                style={{ "--dur": `${STEP_SEC[i]}s` } as React.CSSProperties}
              />
            ))}
          </div>
          <p className="ld-sub">보통 2~10초 걸려요. 잠시만 기다려 주세요.</p>
        </div>
        <div className="cards" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card sk">
              <div className="skel-box" style={{ width: "46%", height: 22 }} />
              <div className="skel-box" style={{ width: "64%", height: 36 }} />
              <div className="skel-box" style={{ width: "82%", height: 22 }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
