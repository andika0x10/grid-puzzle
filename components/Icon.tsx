import type { CSSProperties } from "react";
type Name =
  | "arrow-left"
  | "arrow-right"
  | "play"
  | "pause"
  | "check"
  | "lock"
  | "flag"
  | "leaf"
  | "spark"
  | "star"
  | "reset"
  | "step-back"
  | "step-next"
  | "info"
  | "close"
  | "grid"
  | "chevron"
  | "help";
const paths: Record<Name, string> = {
  "arrow-left": "M19 12H5m6-6-6 6 6 6",
  "arrow-right": "M5 12h14m-6-6 6 6-6 6",
  play: "m9 5 11 7-11 7Z",
  pause: "M8 5v14M16 5v14",
  check: "m5 12 4 4L19 6",
  lock: "M6 10h12v10H6ZM8 10V7a4 4 0 0 1 8 0v3",
  flag: "M5 21V3m0 1h14l-3 5 3 5H5",
  leaf: "M20 4c-10-2-17 5-12 11 6 5 13-2 12-11ZM4 21 16 9",
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
  reset: "M4 10a8 8 0 1 1 1 7M4 4v6h6",
  "step-back": "M5 5v14m14-14L8 12l11 7Z",
  "step-next": "M19 5v14M5 5l11 7-11 7Z",
  info: "M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  close: "m6 6 12 12M18 6 6 18",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
  chevron: "m9 5 7 7-7 7",
  help: "M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 4v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
};
export default function Icon({ name, size = 20, style }: { name: Name; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
