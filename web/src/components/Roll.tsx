"use client";

import { useState } from "react";

type Item = { key: number; text: string; cls: string };

/**
 * 값이 바뀌면 위/아래로 굴러가며 바뀌는 숫자.
 * n 이 줄어들면 아래로, 늘어나면 위로 굴린다 (페이스처럼 작을수록 좋은 값은 -n 을 넘긴다).
 */
export function Roll({ text, n, className = "" }: { text: string; n?: number; className?: string }) {
  const [state, setState] = useState<{ text: string; n?: number; seq: number; items: Item[] }>({
    text,
    n,
    seq: 0,
    items: [{ key: 0, text, cls: "" }],
  });

  // 렌더 중 이전 값과 비교해 상태를 갱신 (effect 없이 prop 변화에 반응)
  if (state.text !== text) {
    const up = n == null || state.n == null || n >= state.n;
    const seq = state.seq + 1;
    setState({
      text,
      n,
      seq,
      items: [
        ...state.items.map((it) => ({ ...it, cls: up ? "out-up" : "out-dn" })),
        { key: seq, text, cls: up ? "in-up" : "in-dn" },
      ],
    });
  }

  const drop = (key: number) =>
    setState((s) => ({ ...s, items: s.items.filter((it) => it.key !== key || !it.cls.startsWith("out")) }));

  return (
    <span className={`roll ${className}`}>
      {state.items.map((it) => (
        <span key={it.key} className={it.cls} onAnimationEnd={() => drop(it.key)}>
          {it.text}
        </span>
      ))}
    </span>
  );
}
