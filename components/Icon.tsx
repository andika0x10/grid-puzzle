import type { CSSProperties } from "react";
type Name = "play" | "pause" | "lock" | "flag" | "reset" | "step-back" | "step-next" | "info" | "close" | "grid" | "help";
const paths: Record<Name, string> = {
  play: "m9 5 11 7-11 7Z",
  pause: "M8 5v14M16 5v14",
  lock: "M6 10h12v10H6ZM8 10V7a4 4 0 0 1 8 0v3",
  flag: "M5 21V3m0 1h14l-3 5 3 5H5",
  reset: "M4 10a8 8 0 1 1 1 7M4 4v6h6",
  "step-back": "M5 5v14m14-14L8 12l11 7Z",
  "step-next": "M19 5v14M5 5l11 7-11 7Z",
  info: "M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  close: "m6 6 12 12M18 6 6 18",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
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
