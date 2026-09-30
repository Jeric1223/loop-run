"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { useHoldRepeat } from "@/hooks/useHoldRepeat";

/** +/− 원형 버튼. 누르고 있으면 반복 */
export function StepButton({
  dir,
  small = false,
  label,
  onStep,
}: {
  dir: "-" | "+";
  small?: boolean;
  label: string;
  onStep: () => void;
}) {
  const hold = useHoldRepeat(onStep);
  return (
    <button type="button" className={small ? "step sm" : "step"} aria-label={label} {...hold}>
      <Icon name={dir === "-" ? "minus" : "plus"} />
    </button>
  );
}

/** 숫자를 누르면 아래 목록을 여닫는 버튼 */
export function PickerButton({
  id,
  open,
  className,
  label,
  onToggle,
  children,
}: {
  id: string;
  open: boolean;
  className: string;
  label: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`numbtn ${className}`}
      aria-expanded={open}
      aria-controls={id}
      aria-label={label}
      data-pk-btn={id}
      onClick={onToggle}
    >
      {children}
      <Icon name="chevD" />
    </button>
  );
}

/** 펼쳐지는 숫자 목록. 열릴 때 현재 값이 가운데 오도록 스크롤 */
export function PickerList({
  id,
  open,
  label,
  values,
  current,
  format,
  onPick,
}: {
  id: string;
  open: boolean;
  label: string;
  values: number[];
  current: number;
  format: (v: number) => string;
  onPick: (v: number) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const grid = gridRef.current;
    const on = grid?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!grid || !on) return;
    grid.scrollLeft = on.offsetLeft - grid.clientWidth / 2 + on.offsetWidth / 2;
    // 현재 값이 바뀔 때마다 다시 맞추지 않도록 열릴 때만 실행
  }, [open]);

  return (
    <div className="collapse pk" id={id} data-open={open}>
      <div>
        <div className="pk-in" ref={gridRef} role="listbox" aria-label={label}>
          {values.map((v) => (
            <button key={v} type="button" role="option" aria-selected={v === current} onClick={() => onPick(v)}>
              {format(v)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Alert({
  tone,
  title,
  body,
  action,
}: {
  tone: "info" | "ok" | "warn" | "danger";
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`alert ${tone}`} role="status">
      <span className="alert-ic">
        <Icon name={tone === "info" ? "info" : tone === "ok" ? "check" : "warn"} />
      </span>
      <div className="alert-tx">
        <b>{title}</b>
        {body && <p>{body}</p>}
      </div>
      {action && (
        <button type="button" className="alert-act" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
