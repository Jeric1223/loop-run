"use client";

import { useCallback, useEffect, useRef } from "react";

const HOLD_DELAY_MS = 420;
const REPEAT_MS = 85;

/**
 * +/− 스테퍼용: 누르면 한 번, 계속 누르고 있으면 반복 실행.
 * 키보드(Enter/Space)는 click 으로 한 번씩 실행한다.
 */
export function useHoldRepeat(action: () => void) {
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    actionRef.current();
    let iv: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      iv = setInterval(() => actionRef.current(), REPEAT_MS);
    }, HOLD_DELAY_MS);
    const stop = () => {
      clearTimeout(t);
      clearInterval(iv);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      stopRef.current = null;
    };
    stopRef.current?.();
    stopRef.current = stop;
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, []);

  const onClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    // 포인터로 누른 건 pointerdown 에서 처리했으므로 키보드 click(detail 0)만 실행
    if (e.detail === 0) actionRef.current();
  }, []);

  return { onPointerDown, onClick };
}
