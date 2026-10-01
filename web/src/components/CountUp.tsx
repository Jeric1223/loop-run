"use client";

import { useEffect, useState } from "react";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 0 에서 목표값까지 올라가는 숫자. animate 가 false 이면 그냥 값을 보여준다 */
export function CountUp({ to, animate, delay = 0, dur = 600 }: { to: number; animate: boolean; delay?: number; dur?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!animate || reduced()) return;
    const t0 = performance.now() + delay;
    let raf = requestAnimationFrame(function f(t) {
      const p = Math.min(1, Math.max(0, (t - t0) / dur));
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(f);
    });
    return () => cancelAnimationFrame(raf);
  }, [to, animate, delay, dur]);
  return <>{(animate && !reduced() ? v : to).toFixed(2)}</>;
}
