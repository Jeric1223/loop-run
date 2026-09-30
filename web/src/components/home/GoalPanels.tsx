"use client";

import type { Dispatch } from "react";
import { Icon } from "@/components/Icon";
import { Roll } from "@/components/Roll";
import { fmtDur, fmtPace, range } from "@/lib/format";
import { PickerButton, PickerList, StepButton } from "./controls";
import { KM_MAX, KM_MIN, type HomeAction, type HomeState } from "./state";

const PACE_VALUES = range(180, 600, 15);
const MIN_VALUES = range(10, 180, 5);
const QUICK_KM = [3, 5, 10];
const fmtMin = (v: number) => `${v}분`;

type Props = { s: HomeState; dispatch: Dispatch<HomeAction> };

/** 거리 모드: 큰 숫자 + 스테퍼, 슬라이더, 빠른 칩, 선택 페이스 → 예상 시간 */
export function DistanceGoal({ s, dispatch }: Props) {
  const hasPace = s.pace != null;
  const progress = ((s.km - KM_MIN) / (KM_MAX - KM_MIN)) * 100;

  return (
    <div className="goal-card">
      <span className="lbl">목표 거리</span>
      <div className="big-row">
        <StepButton dir="-" label="0.5km 줄이기" onStep={() => dispatch({ type: "km", delta: -0.5 })} />
        <div className="big">
          <Roll text={s.km.toFixed(1)} n={s.km} />
          <small>km</small>
        </div>
        <StepButton dir="+" label="0.5km 늘리기" onStep={() => dispatch({ type: "km", delta: 0.5 })} />
      </div>
      <input
        className="range"
        type="range"
        min={KM_MIN}
        max={KM_MAX}
        step={0.5}
        value={s.km}
        aria-label="목표 거리 슬라이더"
        style={{ "--p": `${progress}%` } as React.CSSProperties}
        onChange={(e) => dispatch({ type: "setKm", km: Number(e.target.value) })}
      />
      <div className="range-scale">
        <span>{KM_MIN}km</span>
        <span>{KM_MAX}km</span>
      </div>
      <div className="chips-row">
        {QUICK_KM.map((k) => (
          <button
            key={k}
            type="button"
            className="chip-btn"
            aria-pressed={s.km === k}
            onClick={() => dispatch({ type: "setKm", km: k })}
          >
            {k}km
          </button>
        ))}
      </div>
      <div className="opt-row">
        <span className="lbl">
          내 페이스
          {!hasPace && <em>선택</em>}
        </span>
        {s.pace == null ? (
          <button type="button" className="ghost-btn" onClick={() => dispatch({ type: "paceOn" })}>
            <Icon name="plus" />
            페이스 입력
          </button>
        ) : (
          <div className="mini-step">
            <StepButton small dir="-" label="페이스 5초 빠르게" onStep={() => dispatch({ type: "pace", delta: -5 })} />
            <PickerButton
              id="pk-pace"
              className="mono"
              open={s.pk === "pace"}
              label="페이스 목록에서 고르기"
              onToggle={() => dispatch({ type: "togglePk", pk: "pace" })}
            >
              <Roll text={fmtPace(s.pace)} n={-s.pace} />
              <small>/km</small>
            </PickerButton>
            <StepButton small dir="+" label="페이스 5초 느리게" onStep={() => dispatch({ type: "pace", delta: 5 })} />
            <button type="button" className="icon-btn" aria-label="페이스 지우기" onClick={() => dispatch({ type: "paceOff" })}>
              <Icon name="x" />
            </button>
          </div>
        )}
        <PickerList
          id="pk-pace"
          open={s.pk === "pace"}
          label="페이스 목록"
          values={PACE_VALUES}
          current={s.pace ?? -1}
          format={fmtPace}
          onPick={(value) => dispatch({ type: "pickValue", pk: "pace", value })}
        />
      </div>
      <div className="collapse" data-open={hasPace}>
        <div>
          <div className="eta">
            <Icon name="clock" />
            <span>
              예상 시간 약{" "}
              <b>{s.pace != null && <Roll text={fmtDur(s.km * s.pace)} n={s.km * s.pace} />}</b>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 페이스·시간 모드: 페이스 × 시간 → 거리 환산, 0.5~30km 밖이면 CTA 비활성 */
export function PaceGoal({ s, dispatch }: Props) {
  const km = (s.min * 60) / s.pPace;
  const bad = km < KM_MIN || km > KM_MAX;

  return (
    <div className="goal-card">
      <div className="field">
        <span className="lbl">페이스</span>
        <div className="mini-step">
          <StepButton small dir="-" label="페이스 5초 빠르게" onStep={() => dispatch({ type: "pPace", delta: -5 })} />
          <PickerButton
            id="pk-pp"
            className="val"
            open={s.pk === "pp"}
            label="페이스 목록에서 고르기"
            onToggle={() => dispatch({ type: "togglePk", pk: "pp" })}
          >
            <Roll text={fmtPace(s.pPace)} n={-s.pPace} />
            <small>/km</small>
          </PickerButton>
          <StepButton small dir="+" label="페이스 5초 느리게" onStep={() => dispatch({ type: "pPace", delta: 5 })} />
        </div>
        <PickerList
          id="pk-pp"
          open={s.pk === "pp"}
          label="페이스 목록"
          values={PACE_VALUES}
          current={s.pPace}
          format={fmtPace}
          onPick={(value) => dispatch({ type: "pickValue", pk: "pp", value })}
        />
      </div>
      <div className="field">
        <span className="lbl">시간</span>
        <div className="mini-step">
          <StepButton small dir="-" label="시간 5분 줄이기" onStep={() => dispatch({ type: "min", delta: -5 })} />
          <PickerButton
            id="pk-min"
            className="val"
            open={s.pk === "min"}
            label="시간 목록에서 고르기"
            onToggle={() => dispatch({ type: "togglePk", pk: "min" })}
          >
            <Roll text={String(s.min)} n={s.min} />
            <small>분</small>
          </PickerButton>
          <StepButton small dir="+" label="시간 5분 늘리기" onStep={() => dispatch({ type: "min", delta: 5 })} />
        </div>
        <PickerList
          id="pk-min"
          open={s.pk === "min"}
          label="시간 목록"
          values={MIN_VALUES}
          current={s.min}
          format={fmtMin}
          onPick={(value) => dispatch({ type: "pickValue", pk: "min", value })}
        />
      </div>
      <div className="conv" data-bad={bad}>
        <span>= 약</span>
        <b>
          <Roll text={km.toFixed(2)} n={km} />
        </b>
        <span>km</span>
      </div>
      <p className="hint" data-bad={bad}>
        {bad
          ? "0.5~30km 안에서 만들 수 있어요. 페이스나 시간을 조절해 주세요."
          : "페이스 2:30~20:00 /km, 시간은 5분 단위로 바꿔요."}
      </p>
    </div>
  );
}
