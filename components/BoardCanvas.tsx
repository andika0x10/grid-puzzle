"use client";
import { useEffect, useRef, useState } from "react";
import type { BoardState, LevelDefinition } from "../game/schema";
import type { ReplayController } from "../game/replay";
import type { BoardRenderer } from "../game/renderer";
import { mechanics } from "../game/mechanics";
export default function BoardCanvas({ level, frame, controller }: { level: LevelDefinition; frame: BoardState; controller: ReplayController }) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<BoardRenderer | null>(null),
    frameRef = useRef(frame);
  frameRef.current = frame;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false,
      instance: BoardRenderer | null = null;
    setStatus("loading");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void import("../game/renderer")
      .then(({ BoardRenderer }) => {
        if (cancelled || !host.current) return;
        instance = new BoardRenderer(
          host.current,
          level,
          frameRef.current,
          (ms) => controller.tick(ms),
          () => controller.getSnapshot().phase,
          reduced
        );
        renderer.current = instance;
        return instance.ready().then(() => {
          if (!cancelled) {
            instance?.setFrame(frameRef.current);
            setStatus("ready");
          }
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    const hide = () => {
      if (document.hidden) controller.pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      cancelled = true;
      instance?.destroy();
      renderer.current = null;
      document.removeEventListener("visibilitychange", hide);
    };
  }, [level, controller, retry]);
  useEffect(() => {
    renderer.current?.setFrame(frame);
  }, [frame]);
  return (
    <div className="board-wrap">
      <div className="board-scroll" tabIndex={0} aria-label="Papan permainan. Geser untuk melihat bagian papan yang lebih besar.">
        <div ref={host} className="canvas-host" />
      </div>
      {status === "loading" && (
        <div className="board-cover" role="status">
          <span className="loader" />
          Menyiapkan medan…
        </div>
      )}
      {status === "error" && (
        <div className="board-cover" role="alert">
          <p>Medan belum dapat ditampilkan.</p>
          <button className="button secondary" onClick={() => setRetry((n) => n + 1)}>
            Muat ulang aset
          </button>
        </div>
      )}
      <p className="sr-only">{mechanics[level.mechanic].describe(level, frame)}</p>
    </div>
  );
}
