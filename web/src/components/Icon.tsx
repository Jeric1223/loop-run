import type { ReactNode } from "react";

/* 1.8px 모노라인 아이콘 (currentColor) — docs/design/shared/core.js 의 P 에서 홈 화면에 쓰는 것만 */
const PATHS = {
  loop: (
    <>
      <path d="M12 4a8 8 0 1 0 8 8" />
      <path d="M20 3.5V9h-5.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.5V9h-5.5" />
    </>
  ),
  bookmark: <path d="M7 3.5h10a1 1 0 0 1 1 1V20.5l-6-4-6 4V4.5a1 1 0 0 1 1-1Z" />,
  trash: <path d="M4 7h16M10 3.5h4M6.5 7l.8 12.5a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L17.5 7M10 11v5M14 11v5" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3.5 22 20.5H2Z" />
      <path d="M12 10v4.5M12 17.6v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.1" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  arrowR: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevR: <path d="m9 5 7 7-7 7" />,
  chevD: <path d="m5 9 7 7 7-7" />,
  chevL: <path d="m15 5-7 7 7 7" />,
  flat: (
    <>
      <path d="M3 13h18" />
      <path d="M3 18h18" opacity=".35" />
    </>
  ),
  gentle: (
    <>
      <path d="M3 16.5 21 9.5" />
      <path d="M3 20h18" opacity=".35" />
    </>
  ),
  hill: <path d="M2.5 19.5 9 7l4 7 3-4 5.5 9.5Z" />,
  swap: <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" />,
  cross: <path d="M4 5.5h16M4 9.5h16M4 13.5h16M4 17.5h16" strokeWidth={2.6} />,
  stairs: <path d="M3 20h5v-5h5v-5h5V5h3" />,
  pin: (
    <>
      <path d="M12 21.5s-7-6.2-7-11.5a7 7 0 0 1 14 0c0 5.3-7 11.5-7 11.5Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  pinoff: (
    <>
      <path d="M12 21.5s-7-6.2-7-11.5a7 7 0 0 1 14 0c0 5.3-7 11.5-7 11.5Z" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M3 3l18 18" />
    </>
  ),
  wifi: (
    <>
      <path className="wf" d="M2.5 8.8a15 15 0 0 1 19 0" />
      <path className="wf" d="M5.5 12.6a10 10 0 0 1 13 0" />
      <path className="wf" d="M8.6 16.2a5 5 0 0 1 6.8 0" />
      <path d="M12 20v.1" />
      <path d="M3 3l18 18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
